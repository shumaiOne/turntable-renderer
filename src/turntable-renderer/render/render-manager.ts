import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import type { FileStore } from '../files/file-store.js';
import { defaultFileStore } from '../files/local-disk-store.js';
import { settings } from '../settings.js';
import { runBlenderScript } from './blender-runner.js';
import { AppError } from './errors.js';
import type { RenderRequest, RenderRequestInput } from './options.js';
import { RenderRequestSchema } from './options.js';

interface QueueItem {
  id: string;
  resolve: () => void;
  reject: (err: Error) => void;
  timer: Timer;
}

export interface RenderArtifactOutput {
  name: string;
  fileId: string;
  size: number;
  contentType: string;
  width?: number;
  height?: number;
}

export interface RenderResponse {
  metadata: Record<string, unknown>;
  render?: {
    width: number;
    height: number;
    frames: number;
    fps: number;
    durationSeconds: number;
    degreesPerFrame: number;
    startAngle: number;
    direction: string;
    includeEndFrame: boolean;
    engine: string;
    elapsedMs: number;
  };
  outputs: RenderArtifactOutput[];
}

export class RenderManager {
  private fileStore: FileStore;
  private maxConcurrent: number;
  private queueSize: number;
  private queueWaitSeconds: number;

  private activeRenders = 0;
  private waitQueue: QueueItem[] = [];

  constructor(options?: {
    fileStore?: FileStore;
    maxConcurrentRenders?: number;
    queueSize?: number;
    queueWaitSeconds?: number;
  }) {
    this.fileStore = options?.fileStore ?? defaultFileStore;
    this.maxConcurrent = options?.maxConcurrentRenders ?? settings.MAX_CONCURRENT_RENDERS;
    this.queueSize = options?.queueSize ?? settings.QUEUE_SIZE;
    this.queueWaitSeconds = options?.queueWaitSeconds ?? settings.QUEUE_WAIT_SECONDS;
  }

  private async acquireSlot(abortSignal?: AbortSignal): Promise<void> {
    if (this.activeRenders < this.maxConcurrent) {
      this.activeRenders++;
      return;
    }

    if (this.waitQueue.length >= this.queueSize) {
      throw new AppError('queue_full', 'Render queue is full. Try again later.', 503, {
        retryAfter: 30,
        queueSize: this.queueSize,
      });
    }

    return new Promise<void>((resolve, reject) => {
      const id = crypto.randomUUID();

      const timer = setTimeout(() => {
        const idx = this.waitQueue.findIndex((item) => item.id === id);
        if (idx !== -1) {
          this.waitQueue.splice(idx, 1);
        }
        reject(
          new AppError('queue_full', 'Wait time expired while queued for render execution', 503, {
            retryAfter: 30,
            waitSeconds: this.queueWaitSeconds,
          }),
        );
      }, this.queueWaitSeconds * 1000);

      const onAbort = () => {
        clearTimeout(timer);
        const idx = this.waitQueue.findIndex((item) => item.id === id);
        if (idx !== -1) {
          this.waitQueue.splice(idx, 1);
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

      const queueItem: QueueItem = {
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

      this.waitQueue.push(queueItem);
    });
  }

  private releaseSlot(): void {
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift();
      if (next) {
        clearTimeout(next.timer);
        next.resolve();
      }
    } else {
      this.activeRenders = Math.max(0, this.activeRenders - 1);
    }
  }

  async render(rawRequest: RenderRequestInput, abortSignal?: AbortSignal): Promise<RenderResponse> {
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

    await this.acquireSlot(abortSignal);
    await this.fileStore.pinFile(fileId);

    const workingDir = mkdtempSync(join(tmpdir(), 'render_'));
    const startTime = Date.now();

    try {
      // Find actual disk path to the blob
      const inputBlobPath = join(settings.DATA_DIR, `${fileId}.bin`);
      if (!existsSync(inputBlobPath)) {
        throw new AppError('input_not_found', `Input blob for '${fileId}' not found on disk`, 404);
      }

      const taskJsonPath = join(workingDir, 'task.json');
      const taskConfig = {
        inputFile: inputBlobPath,
        format: ext,
        outputDir: workingDir,
        outputs: request.outputs,
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
          timeoutMs: settings.RENDER_TIMEOUT_SECONDS * 1000,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('timed out')) {
          throw new AppError(
            'render_timeout',
            `Render execution timed out after ${settings.RENDER_TIMEOUT_SECONDS}s`,
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

      // Store output artifacts into file store
      const outputArtifacts: RenderArtifactOutput[] = [];

      for (const artifact of blenderResult.artifacts || []) {
        const artifactPath = join(workingDir, artifact.filename);
        if (existsSync(artifactPath)) {
          const fileData = readFileSync(artifactPath);
          const savedFile = await this.fileStore.saveBuffer(
            fileData,
            artifact.filename,
            artifact.contentType,
            'output',
          );

          outputArtifacts.push({
            name: artifact.name,
            fileId: savedFile.id,
            size: savedFile.size,
            contentType: artifact.contentType,
            width: artifact.width,
            height: artifact.height,
          });
        }
      }

      const hasVisualRender =
        request.outputs.includes('video') || request.outputs.includes('poster');

      const response: RenderResponse = {
        metadata,
        outputs: outputArtifacts,
      };

      if (hasVisualRender) {
        const opts = request.options;
        const frames = opts.frames ?? 24;
        const totalDegrees = opts.totalDegrees ?? 360;
        const nPrime = (opts.includeEndFrame ?? false) ? Math.max(1, frames - 1) : frames;

        response.render = {
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
      }

      return response;
    } finally {
      await this.fileStore.unpinFile(fileId);
      try {
        rmSync(workingDir, { recursive: true, force: true });
      } catch {
        // Ignore working dir cleanup error
      }
      this.releaseSlot();
    }
  }
}

export const defaultRenderManager = new RenderManager();
