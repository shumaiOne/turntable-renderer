import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { defaultFileStore } from '../../src/turntable-renderer/files/local-disk-store.js';
import { app } from '../../src/turntable-renderer/index.js';
import { getBlenderVersion } from '../../src/turntable-renderer/render/blender-runner.js';
import type {
  RenderSyncResponse,
  RenderTaskResponse,
} from '../../src/turntable-renderer/render/options.js';
import { generateObj } from '../fixtures/generate-fixtures.js';

const TEST_DATA_DIR = join(import.meta.dir, '../../data_render_test');

describe('Render API & Pipeline Integration Tests', () => {
  let blenderAvailable = false;
  let testInputFileId = '';

  beforeAll(async () => {
    mkdirSync(TEST_DATA_DIR, { recursive: true });

    const version = await getBlenderVersion();
    blenderAvailable = !version.includes('unavailable');

    // Upload a test model to the default file store
    const objData = new TextEncoder().encode(generateObj());
    const uploadRes = await app.request('/v1/files?filename=test_cube.obj', {
      method: 'POST',
      body: objData,
    });
    const body = (await uploadRes.json()) as { id: string };
    testInputFileId = body.id;
  });

  afterAll(() => {
    try {
      rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('rejects unknown file ID with 404', async () => {
    const res = await app.request('/v1/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { fileId: 'f_nonexistent' },
      }),
    });

    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('input_not_found');
  });

  it('rejects invalid or unknown options with 422', async () => {
    const res = await app.request('/v1/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { fileId: testInputFileId },
        options: {
          unknownOption: 123,
        },
      }),
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_options');
  });

  it('rejects non-Cycles render engines with 422 invalid_options', async () => {
    for (const invalidEngine of ['eevee', 'workbench', 'random']) {
      const res = await app.request('/v1/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { fileId: testInputFileId },
          options: {
            engine: invalidEngine,
          },
        }),
      });

      expect(res.status).toBe(422);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe('invalid_options');
    }
  });

  it('rejects transparent background with MP4 video output with 422', async () => {
    const res = await app.request('/v1/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { fileId: testInputFileId },
        options: {
          background: { type: 'transparent' },
          format: 'mp4',
        },
      }),
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_options');
  });

  it('rejects direct .blend input file with 422', async () => {
    const blendFile = await defaultFileStore.saveBuffer(
      new Uint8Array([1, 2, 3]),
      'scene.blend',
      'application/x-blender',
    );

    const res = await app.request('/v1/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { fileId: blendFile.id },
      }),
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('unsupported_format');
  });

  it('renders poster with default 300x300 resolution when width/height options are omitted', async () => {
    if (!blenderAvailable) return;

    const objData = new TextEncoder().encode(generateObj());
    const uploadRes = await app.request('/v1/files?filename=default_cube.obj', {
      method: 'POST',
      body: objData,
    });
    const { id: fileId } = (await uploadRes.json()) as { id: string };

    const renderRes = await app.request('/v1/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { fileId },
        options: {
          samples: 1,
          frames: 1,
        },
      }),
    });

    expect(renderRes.status).toBe(200);
    const body = (await renderRes.json()) as RenderSyncResponse;
    expect(body.poster.width).toBe(300);
    expect(body.poster.height).toBe(300);

    const posterDownload = await app.request(`/v1/files/${body.poster.fileId}`);
    expect(posterDownload.status).toBe(200);
    const posterBytes = await posterDownload.arrayBuffer();
    const posterBuffer = Buffer.from(posterBytes);
    expect(posterBuffer.readUInt32BE(16)).toBe(300);
    expect(posterBuffer.readUInt32BE(20)).toBe(300);

    // Wait for background task to finish before deleting
    for (let i = 0; i < 30; i++) {
      const taskRes = await app.request(`/v1/render/tasks/${body.taskId}`);
      const taskBody = (await taskRes.json()) as RenderTaskResponse;
      if (taskBody.status === 'completed' || taskBody.status === 'failed') {
        break;
      }
      await Bun.sleep(200);
    }
    const delRes = await app.request(`/v1/render/tasks/${body.taskId}`, { method: 'DELETE' });
    expect(delRes.status).toBe(200);
  });

  it('end-to-end: sync metadata + poster -> poll async task -> download video', async () => {
    if (!blenderAvailable) {
      console.warn('Skipping end-to-end render test: Blender is not installed on this host.');
      return;
    }

    const renderRes = await app.request('/v1/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { fileId: testInputFileId },
        options: {
          width: 256,
          height: 256,
          frames: 2,
          fps: 6,
          samples: 1,
        },
      }),
    });

    expect(renderRes.status).toBe(200);
    const syncBody = (await renderRes.json()) as RenderSyncResponse;

    // Verify sync response structure
    expect(syncBody.taskId).toBeDefined();
    expect(syncBody.taskId.startsWith('t_')).toBe(true);
    expect(['queued', 'rendering']).toContain(syncBody.status);
    expect(typeof syncBody.positionInQueue).toBe('number');

    // Verify metadata
    expect(syncBody.metadata).toBeDefined();
    expect(syncBody.metadata.format).toBe('obj');
    expect(syncBody.metadata.meshCount).toBeGreaterThan(0);
    expect(syncBody.metadata.polygonCount).toBeGreaterThan(0);

    // Verify poster
    expect(syncBody.poster).toBeDefined();
    expect(syncBody.poster.fileId).toBeDefined();
    expect(syncBody.poster.contentType).toBe('image/png');
    expect(syncBody.poster.width).toBe(256);
    expect(syncBody.poster.height).toBe(256);

    // Download generated poster output via Files API
    const posterDownload = await app.request(`/v1/files/${syncBody.poster.fileId}`);
    expect(posterDownload.status).toBe(200);
    expect(posterDownload.headers.get('Content-Type')).toBe('image/png');
    const posterBytes = await posterDownload.arrayBuffer();
    expect(posterBytes.byteLength).toBeGreaterThan(0);
    const posterBuffer = Buffer.from(posterBytes);
    expect(posterBuffer.readUInt32BE(16)).toBe(256);
    expect(posterBuffer.readUInt32BE(20)).toBe(256);

    // Poll task status until completed
    const taskId = syncBody.taskId;
    let completedTask: RenderTaskResponse | null = null;
    const maxAttempts = 60;

    for (let i = 0; i < maxAttempts; i++) {
      const taskRes = await app.request(`/v1/render/tasks/${taskId}`);
      expect(taskRes.status).toBe(200);
      const taskBody = (await taskRes.json()) as RenderTaskResponse;

      if (taskBody.status === 'completed') {
        completedTask = taskBody;
        break;
      }
      if (taskBody.status === 'failed') {
        throw new Error(`Task failed unexpectedly: ${JSON.stringify(taskBody.error)}`);
      }

      await Bun.sleep(1000);
    }

    expect(completedTask).not.toBeNull();
    if (!completedTask) return;

    expect(completedTask.status).toBe('completed');
    expect(completedTask.render).toBeDefined();
    expect(completedTask.render?.width).toBe(256);
    expect(completedTask.render?.frames).toBe(2);
    expect(completedTask.render?.engine).toBe('cycles');

    // Verify video output
    expect(completedTask.video).toBeDefined();
    expect(completedTask.video?.contentType).toBe('video/mp4');
    expect(completedTask.video?.fileId).toBeDefined();

    // Download generated video output via Files API
    const videoDownload = await app.request(`/v1/files/${completedTask.video?.fileId}`);
    expect(videoDownload.status).toBe(200);
    expect(videoDownload.headers.get('Content-Type')).toBe('video/mp4');
    const videoBytes = await videoDownload.arrayBuffer();
    expect(videoBytes.byteLength).toBeGreaterThan(0);

    // Verify input file is now unpinned
    const fileInfoRes = await app.request(`/v1/files/${testInputFileId}/info`);
    const fileInfo = (await fileInfoRes.json()) as { pinned: boolean };
    expect(fileInfo.pinned).toBe(false);

    // Delete render task via DELETE /v1/render/tasks/:id and verify cleanup
    const deleteRes = await app.request(`/v1/render/tasks/${syncBody.taskId}`, {
      method: 'DELETE',
    });
    expect(deleteRes.status).toBe(200);
    const deleteBody = (await deleteRes.json()) as { status: string; id: string };
    expect(deleteBody.status).toBe('deleted');
    expect(deleteBody.id).toBe(syncBody.taskId);

    // Verify task itself is now 404
    const deletedTaskRes = await app.request(`/v1/render/tasks/${syncBody.taskId}`);
    expect(deletedTaskRes.status).toBe(404);

    // Verify input file was deleted
    const deletedInputRes = await app.request(`/v1/files/${testInputFileId}/info`);
    expect(deletedInputRes.status).toBe(404);

    // Verify poster file was deleted
    const deletedPosterRes = await app.request(`/v1/files/${syncBody.poster.fileId}/info`);
    expect(deletedPosterRes.status).toBe(404);

    // Verify video file was deleted
    const deletedVideoRes = await app.request(`/v1/files/${completedTask.video?.fileId}/info`);
    expect(deletedVideoRes.status).toBe(404);
  }, 90000);

  it('GET /v1/render/tasks/:id returns 404 for unknown task ID', async () => {
    const res = await app.request('/v1/render/tasks/t_unknown999');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('task_not_found');
  });

  it('DELETE /v1/render/tasks/:id returns 404 for unknown task ID', async () => {
    const res = await app.request('/v1/render/tasks/t_unknown999', { method: 'DELETE' });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('task_not_found');
  });
});
