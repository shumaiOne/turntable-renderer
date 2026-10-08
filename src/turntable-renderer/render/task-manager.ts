import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import type { FileStore } from '../files/file-store.js';
import { defaultFileStore } from '../files/local-disk-store.js';
import { settings } from '../settings.js';
import { runBlenderScript } from './blender-runner.js';
import type {
  RenderOptions,
  RenderStats,
  RenderTaskResponse,
  RenderVideoOutput,
  TaskRecord,
} from './options.js';

export function generateTaskId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  let result = 't_';
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    result += alphabet[(value << (5 - bits)) & 31];
  }
  return result;
}

export class TaskManager {
  private dataDir: string;
  private fileStore: FileStore;
  private maxConcurrentVideoRenders: number;
  private taskTtlSeconds: number;
  private renderTimeoutSeconds: number;

  private queue: string[] = [];
  private activeCount = 0;

  constructor(options?: {
    dataDir?: string;
    fileStore?: FileStore;
    maxConcurrentVideoRenders?: number;
    taskTtlSeconds?: number;
    renderTimeoutSeconds?: number;
  }) {
    this.dataDir = options?.dataDir ?? settings.DATA_DIR;
    this.fileStore = options?.fileStore ?? defaultFileStore;
    this.maxConcurrentVideoRenders =
      options?.maxConcurrentVideoRenders ?? settings.MAX_CONCURRENT_VIDEO_RENDERS;
    this.taskTtlSeconds = options?.taskTtlSeconds ?? settings.TASK_TTL_SECONDS;
    this.renderTimeoutSeconds = options?.renderTimeoutSeconds ?? settings.RENDER_TIMEOUT_SECONDS;

    mkdirSync(this.dataDir, { recursive: true });
    this.recoverExistingTasks();
  }

  private getTaskFilePath(id: string): string {
    return join(this.dataDir, `${id}.json`);
  }

  private async saveTask(task: TaskRecord): Promise<void> {
    const filePath = this.getTaskFilePath(task.id);
    writeFileSync(filePath, JSON.stringify(task, null, 2));
  }

  private async loadTask(id: string): Promise<TaskRecord | null> {
    const filePath = this.getTaskFilePath(id);
    if (!existsSync(filePath)) {
      return null;
    }
    try {
      const data = readFileSync(filePath, 'utf8');
      return JSON.parse(data) as TaskRecord;
    } catch {
      return null;
    }
  }

  private recoverExistingTasks(): void {
    try {
      const files = readdirSync(this.dataDir);
      for (const file of files) {
        if (file.startsWith('t_') && file.endsWith('.json')) {
          const filePath = join(this.dataDir, file);
          try {
            const task = JSON.parse(readFileSync(filePath, 'utf8')) as TaskRecord;
            if (task.status === 'queued') {
              if (!this.queue.includes(task.id)) {
                this.queue.push(task.id);
              }
            } else if (task.status === 'rendering') {
              // Server was restarted while task was actively running
              task.status = 'failed';
              task.failedAt = new Date().toISOString();
              task.expiresAt = new Date(Date.now() + this.taskTtlSeconds * 1000).toISOString();
              task.error = {
                code: 'render_failed',
                message: 'Server restarted while render execution was in progress',
              };
              writeFileSync(filePath, JSON.stringify(task, null, 2));
              this.fileStore.unpinFile(task.fileId).catch(() => {});
            }
          } catch {
            // Ignore parse errors on corrupt task files
          }
        }
      }
    } catch {
      // Ignore directory scan errors
    }

    this.processNext();
  }

  async createTask(fileId: string, options: RenderOptions): Promise<TaskRecord> {
    const id = generateTaskId();
    const now = new Date().toISOString();
    const task: TaskRecord = {
      id,
      fileId,
      status: 'queued',
      options,
      createdAt: now,
    };

    await this.saveTask(task);
    this.queue.push(id);
    this.processNext();
    return task;
  }

  getQueuePosition(id: string): number {
    const idx = this.queue.indexOf(id);
    return idx >= 0 ? idx + 1 : 1;
  }

  async getTask(id: string): Promise<RenderTaskResponse | null> {
    const task = await this.loadTask(id);
    if (!task) return null;

    const response: RenderTaskResponse = {
      taskId: task.id,
      status: task.status,
      createdAt: task.createdAt,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      failedAt: task.failedAt,
      render: task.render,
      video: task.video,
      error: task.error,
    };

    if (task.status === 'queued') {
      response.positionInQueue = this.getQueuePosition(task.id);
    }

    return response;
  }

  private processNext(): void {
    if (this.activeCount >= this.maxConcurrentVideoRenders) {
      return;
    }
    if (this.queue.length === 0) {
      return;
    }

    const taskId = this.queue.shift();
    if (!taskId) return;

    this.activeCount++;

    this.runTask(taskId).finally(() => {
      this.activeCount = Math.max(0, this.activeCount - 1);
      this.processNext();
    });
  }

  private async runTask(taskId: string): Promise<void> {
    const task = await this.loadTask(taskId);
    if (!task || task.status !== 'queued') {
      return;
    }

    task.status = 'rendering';
    task.startedAt = new Date().toISOString();
    await this.saveTask(task);

    const workingDir = mkdtempSync(join(tmpdir(), 'render_video_'));
    const startTime = Date.now();

    try {
      const inputBlobPath = join(this.dataDir, `${task.fileId}.bin`);
      if (!existsSync(inputBlobPath)) {
        task.status = 'failed';
        task.failedAt = new Date().toISOString();
        task.expiresAt = new Date(Date.now() + this.taskTtlSeconds * 1000).toISOString();
        task.error = {
          code: 'input_not_found',
          message: `Input blob for '${task.fileId}' not found on disk`,
        };
        await this.saveTask(task);
        return;
      }

      const inputFileMeta = await this.fileStore.getFileMetadata(task.fileId);
      const ext = inputFileMeta
        ? extname(inputFileMeta.name).toLowerCase().replace('.', '')
        : 'glb';

      const taskJsonPath = join(workingDir, 'task.json');
      const taskConfig = {
        inputFile: inputBlobPath,
        format: ext,
        outputDir: workingDir,
        outputs: ['video'],
        options: task.options,
      };

      await Bun.write(taskJsonPath, JSON.stringify(taskConfig, null, 2));

      const scriptPath = join(import.meta.dir, '../blender/render.py');

      let renderResultRaw: { exitCode: number; stdout: string; stderr: string; durationMs: number };
      try {
        renderResultRaw = await runBlenderScript({
          scriptPath,
          args: [taskJsonPath],
          timeoutMs: this.renderTimeoutSeconds * 1000,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const code = message.includes('timed out') ? 'render_timeout' : 'render_failed';
        task.status = 'failed';
        task.failedAt = new Date().toISOString();
        task.expiresAt = new Date(Date.now() + this.taskTtlSeconds * 1000).toISOString();
        task.error = {
          code,
          message: `Blender execution error: ${message}`,
        };
        await this.saveTask(task);
        return;
      }

      if (renderResultRaw.exitCode !== 0) {
        const errorOutput = renderResultRaw.stderr || renderResultRaw.stdout;
        let code = 'render_failed';
        if (
          errorOutput.includes('Unsupported file format') ||
          errorOutput.includes('not supported')
        ) {
          code = 'unsupported_format';
        } else if (
          errorOutput.includes('External reference rejected') ||
          errorOutput.includes('Invalid .gltf') ||
          errorOutput.includes('Path traversal')
        ) {
          code = 'import_failed';
        }
        task.status = 'failed';
        task.failedAt = new Date().toISOString();
        task.expiresAt = new Date(Date.now() + this.taskTtlSeconds * 1000).toISOString();
        task.error = {
          code,
          message: errorOutput.trim() || 'Blender render process exited with non-zero code',
        };
        await this.saveTask(task);
        return;
      }

      const resultPath = join(workingDir, 'render_result.json');
      const blenderResult = existsSync(resultPath)
        ? JSON.parse(readFileSync(resultPath, 'utf8'))
        : { artifacts: [] };

      const videoArtifact = (blenderResult.artifacts || []).find(
        (a: { name: string }) => a.name === 'video',
      );

      if (!videoArtifact) {
        task.status = 'failed';
        task.failedAt = new Date().toISOString();
        task.expiresAt = new Date(Date.now() + this.taskTtlSeconds * 1000).toISOString();
        task.error = {
          code: 'render_failed',
          message: 'Video artifact was not produced by Blender render process',
        };
        await this.saveTask(task);
        return;
      }

      const artifactPath = join(workingDir, videoArtifact.filename);
      if (!existsSync(artifactPath)) {
        task.status = 'failed';
        task.failedAt = new Date().toISOString();
        task.expiresAt = new Date(Date.now() + this.taskTtlSeconds * 1000).toISOString();
        task.error = {
          code: 'render_failed',
          message: `Video output file '${videoArtifact.filename}' not found`,
        };
        await this.saveTask(task);
        return;
      }

      const fileData = readFileSync(artifactPath);
      const savedFile = await this.fileStore.saveBuffer(
        fileData,
        videoArtifact.filename,
        videoArtifact.contentType,
        'output',
      );

      const opts = task.options;
      const frames = opts.frames ?? 24;
      const totalDegrees = opts.totalDegrees ?? 360;
      const nPrime = (opts.includeEndFrame ?? false) ? Math.max(1, frames - 1) : frames;

      const videoOutput: RenderVideoOutput = {
        fileId: savedFile.id,
        size: savedFile.size,
        contentType: videoArtifact.contentType,
        width: videoArtifact.width,
        height: videoArtifact.height,
      };

      const renderStats: RenderStats = {
        width: opts.width ?? 1080,
        height: opts.height ?? 1080,
        frames,
        fps: opts.fps ?? 6,
        durationSeconds: frames / (opts.fps ?? 6),
        degreesPerFrame: totalDegrees / nPrime,
        startAngle: opts.startAngle ?? 0,
        direction: opts.direction ?? 'cw',
        includeEndFrame: opts.includeEndFrame ?? false,
        engine: opts.engine ?? 'cycles',
        elapsedMs: Date.now() - startTime,
      };

      task.status = 'completed';
      task.completedAt = new Date().toISOString();
      task.expiresAt = new Date(Date.now() + this.taskTtlSeconds * 1000).toISOString();
      task.video = videoOutput;
      task.render = renderStats;
      await this.saveTask(task);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      task.status = 'failed';
      task.failedAt = new Date().toISOString();
      task.expiresAt = new Date(Date.now() + this.taskTtlSeconds * 1000).toISOString();
      task.error = {
        code: 'render_failed',
        message: `Unexpected error during video render: ${message}`,
      };
      await this.saveTask(task);
    } finally {
      await this.fileStore.unpinFile(task.fileId).catch(() => {});
      try {
        rmSync(workingDir, { recursive: true, force: true });
      } catch {
        // Ignore working directory cleanup error
      }
    }
  }

  async cleanExpiredTasks(ttlSeconds: number = this.taskTtlSeconds): Promise<number> {
    let cleaned = 0;
    const now = Date.now();
    try {
      const files = readdirSync(this.dataDir);
      for (const file of files) {
        if (file.startsWith('t_') && file.endsWith('.json')) {
          const filePath = join(this.dataDir, file);
          try {
            const task = JSON.parse(readFileSync(filePath, 'utf8')) as TaskRecord;
            if (task.status === 'completed' || task.status === 'failed') {
              const expireTimestamp = task.expiresAt
                ? new Date(task.expiresAt).getTime()
                : new Date(task.completedAt || task.failedAt || task.createdAt).getTime() +
                  ttlSeconds * 1000;
              if (expireTimestamp < now) {
                unlinkSync(filePath);
                cleaned++;
              }
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    } catch {
      // Ignore readdir errors
    }
    return cleaned;
  }
}

export const defaultTaskManager = new TaskManager();
