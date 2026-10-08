import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import type { FileStore } from '../files/file-store.js';
import { defaultFileStore } from '../files/local-disk-store.js';
import { settings } from '../settings.js';
import { runBlenderScript } from './blender-runner.js';
import { AppError } from './errors.js';
import type { RenderRequestInput, RenderSyncResponse } from './options.js';
import { RenderRequestSchema } from './options.js';
import { type TaskManager, defaultTaskManager } from './task-manager.js';

interface PosterQueueItem {
  id: string;
  resolve: () => void;
  reject: (err: Error) => void;
  timer: Timer;
}

export class RenderManager {
  private fileStore: FileStore;
  private taskManager: TaskManager;
  private maxConcurrentPosters: number;
  private posterTimeoutSeconds: number;
  private activePosters = 0;
  private posterWaitQueue: PosterQueueItem[] = [];

  constructor(options?: {
    fileStore?: FileStore;
    taskManager?: TaskManager;
    maxConcurrentPosters?: number;
    posterTimeoutSeconds?: number;
  }) {
    this.fileStore = options?.fileStore ?? defaultFileStore;
    this.taskManager = options?.taskManager ?? defaultTaskManager;
    this.maxConcurrentPosters =
      options?.maxConcurrentPosters ?? settings.MAX_CONCURRENT_POSTER_RENDERS;
    this.posterTimeoutSeconds = options?.posterTimeoutSeconds ?? settings.POSTER_TIMEOUT_SECONDS;
  }

  private async acquirePosterSlot(abortSignal?: AbortSignal): Promise<void> {
    if (this.activePosters < this.maxConcurrentPosters) {
      this.activePosters++;
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const id = crypto.randomUUID();

      const timer = setTimeout(() => {
        const idx = this.posterWaitQueue.findIndex((item) => item.id === id);
        if (idx !== -1) {
          this.posterWaitQueue.splice(idx, 1);
        }
        reject(
          new AppError(
            'queue_full',
            'Wait time expired while queued for poster render execution',
            503,
            {
              retryAfter: 5,
            },
          ),
        );
      }, 30 * 1000);

      const onAbort = () => {
        clearTimeout(timer);
        const idx = this.posterWaitQueue.findIndex((item) => item.id === id);
        if (idx !== -1) {
          this.posterWaitQueue.splice(idx, 1);
        }
        reject(new AppError('bad_request', 'Request aborted by client', 400));
      };

      if (abortSignal) {
        if (abortSignal.aborted) {
          clearTimeout(timer);
          reject(new AppError('bad_request', 'Request aborted by client', 400));
          return;
        }
        abortSignal.addEventListener('abort', onAbort, { once: true });
      }

      const queueItem: PosterQueueItem = {
        id,
        resolve: () => {
          clearTimeout(timer);
          if (abortSignal) {
            abortSignal.removeEventListener('abort', onAbort);
          }
          resolve();
        },
        reject,
        timer,
      };

      this.posterWaitQueue.push(queueItem);
    });
  }

  private releasePosterSlot(): void {
    if (this.posterWaitQueue.length > 0) {
      const next = this.posterWaitQueue.shift();
      if (next) {
        clearTimeout(next.timer);
        next.resolve();
      }
    } else {
      this.activePosters = Math.max(0, this.activePosters - 1);
    }
  }

  async render(
    rawRequest: RenderRequestInput,
    abortSignal?: AbortSignal,
  ): Promise<RenderSyncResponse> {
    const request = RenderRequestSchema.parse(rawRequest);
    const fileId = request.input.fileId;
    const inputFileMeta = await this.fileStore.getFileMetadata(fileId);
    if (!inputFileMeta) {
      throw new AppError('input_not_found', `Input file '${fileId}' not found`, 404);
    }

    const ext = extname(inputFileMeta.name).toLowerCase().replace('.', '');
    if (ext === 'blend') {
      throw new AppError(
        'unsupported_format',
        'Direct .blend files are forbidden for security',
        422,
      );
    }

    // Pin input file while queued and rendering
    await this.fileStore.pinFile(fileId);

    let posterRendered = false;
    await this.acquirePosterSlot(abortSignal);

    const workingDir = mkdtempSync(join(tmpdir(), 'render_poster_'));

    try {
      const inputBlobPath = join(settings.DATA_DIR, `${fileId}.bin`);
      if (!existsSync(inputBlobPath)) {
        throw new AppError('input_not_found', `Input blob for '${fileId}' not found on disk`, 404);
      }

      const taskJsonPath = join(workingDir, 'task.json');
      const taskConfig = {
        inputFile: inputBlobPath,
        format: ext,
        outputDir: workingDir,
        outputs: ['poster'],
        options: request.options,
      };

      await Bun.write(taskJsonPath, JSON.stringify(taskConfig, null, 2));

      const scriptPath = join(import.meta.dir, '../blender/render.py');

      let renderResultRaw: { exitCode: number; stdout: string; stderr: string; durationMs: number };
      try {
        renderResultRaw = await runBlenderScript({
          scriptPath,
          args: [taskJsonPath],
          abortSignal,
          timeoutMs: this.posterTimeoutSeconds * 1000,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('timed out')) {
          throw new AppError(
            'render_timeout',
            `Poster render execution timed out after ${this.posterTimeoutSeconds}s`,
            504,
          );
        }
        if (message.includes('aborted by client')) {
          throw new AppError('bad_request', 'Render was canceled due to client disconnect', 400);
        }
        throw new AppError('render_failed', `Blender execution error: ${message}`, 500);
      }

      if (renderResultRaw.exitCode !== 0) {
        const errorOutput = renderResultRaw.stderr || renderResultRaw.stdout;
        if (
          errorOutput.includes('Unsupported file format') ||
          errorOutput.includes('not supported')
        ) {
          throw new AppError('unsupported_format', errorOutput.trim(), 422);
        }
        if (
          errorOutput.includes('External reference rejected') ||
          errorOutput.includes('Invalid .gltf') ||
          errorOutput.includes('Path traversal')
        ) {
          throw new AppError('import_failed', errorOutput.trim(), 422);
        }
        throw new AppError(
          'render_failed',
          errorOutput.trim() || 'Blender render process exited with non-zero code',
          500,
        );
      }

      // Read metadata.json and render_result.json
      const metadataPath = join(workingDir, 'metadata.json');
      if (!existsSync(metadataPath)) {
        throw new AppError('render_failed', 'Metadata JSON was not generated by Blender', 500);
      }
      const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));

      const resultPath = join(workingDir, 'render_result.json');
      const blenderResult = existsSync(resultPath)
        ? JSON.parse(readFileSync(resultPath, 'utf8'))
        : { artifacts: [] };

      const posterArtifact = (blenderResult.artifacts || []).find(
        (a: { name: string }) => a.name === 'poster',
      );

      if (!posterArtifact) {
        throw new AppError('render_failed', 'Poster artifact was not produced by Blender', 500);
      }

      const posterPath = join(workingDir, posterArtifact.filename);
      if (!existsSync(posterPath)) {
        throw new AppError(
          'render_failed',
          `Poster output file '${posterArtifact.filename}' not found`,
          500,
        );
      }

      const fileData = readFileSync(posterPath);
      const savedPoster = await this.fileStore.saveBuffer(
        fileData,
        posterArtifact.filename,
        posterArtifact.contentType,
        'output',
      );

      // Create and enqueue async video render task (file stays pinned until video task finishes)
      const task = await this.taskManager.createTask(fileId, request.options, savedPoster.id);
      posterRendered = true;

      const positionInQueue = this.taskManager.getQueuePosition(task.id);

      return {
        taskId: task.id,
        status: task.status as 'queued' | 'rendering',
        positionInQueue,
        metadata,
        poster: {
          fileId: savedPoster.id,
          size: savedPoster.size,
          contentType: posterArtifact.contentType,
          width: posterArtifact.width,
          height: posterArtifact.height,
        },
      };
    } finally {
      this.releasePosterSlot();
      try {
        rmSync(workingDir, { recursive: true, force: true });
      } catch {
        // Ignore working dir cleanup error
      }
      // If poster rendering failed before enqueuing task, unpin input file
      if (!posterRendered) {
        await this.fileStore.unpinFile(fileId).catch(() => {});
      }
    }
  }
}

export const defaultRenderManager = new RenderManager();
