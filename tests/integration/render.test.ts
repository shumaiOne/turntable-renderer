import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { defaultFileStore } from '../../src/turntable-renderer/files/local-disk-store.js';
import { app } from '../../src/turntable-renderer/index.js';
import { getBlenderVersion } from '../../src/turntable-renderer/render/blender-runner.js';
import { RenderManager } from '../../src/turntable-renderer/render/render-manager.js';
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
        outputs: ['video'],
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
        outputs: ['video'],
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
          outputs: ['poster'],
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
        outputs: ['video'],
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
        outputs: ['video'],
      }),
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('unsupported_format');
  });

  it('end-to-end: upload -> render -> download outputs (video and poster)', async () => {
    if (!blenderAvailable) {
      console.warn('Skipping end-to-end render test: Blender is not installed on this host.');
      return;
    }

    const renderRes = await app.request('/v1/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { fileId: testInputFileId },
        outputs: ['video', 'poster'],
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
    const renderBody = (await renderRes.json()) as {
      metadata: { format: string; meshCount: number; polygonCount: number; dimensions: number[] };
      render?: { width: number; height: number; frames: number; fps: number; engine: string };
      outputs: Array<{ name: string; fileId: string; size: number; contentType: string }>;
    };

    // Verify metadata
    expect(renderBody.metadata.format).toBe('obj');
    expect(renderBody.metadata.meshCount).toBeGreaterThan(0);
    expect(renderBody.metadata.polygonCount).toBeGreaterThan(0);

    // Verify render settings returned
    expect(renderBody.render).toBeDefined();
    expect(renderBody.render?.width).toBe(256);
    expect(renderBody.render?.frames).toBe(2);
    expect(renderBody.render?.engine).toBe('cycles');

    // Verify outputs
    expect(renderBody.outputs.length).toBe(2);

    const videoOutput = renderBody.outputs.find((o) => o.name === 'video');
    expect(videoOutput).toBeDefined();
    expect(videoOutput?.contentType).toBe('video/mp4');

    const posterOutput = renderBody.outputs.find((o) => o.name === 'poster');
    expect(posterOutput).toBeDefined();
    expect(posterOutput?.contentType).toBe('image/png');

    // Download generated video output via Files API
    const downloadRes = await app.request(`/v1/files/${videoOutput?.fileId}`);
    expect(downloadRes.status).toBe(200);
    expect(downloadRes.headers.get('Content-Type')).toBe('video/mp4');
    const videoBytes = await downloadRes.arrayBuffer();
    expect(videoBytes.byteLength).toBeGreaterThan(0);
  }, 60000);

  it('metadata-only and conversion-only requests skip animation rendering', async () => {
    if (!blenderAvailable) {
      return;
    }

    const convRes = await app.request('/v1/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { fileId: testInputFileId },
        outputs: ['glb'],
      }),
    });

    expect(convRes.status).toBe(200);
    const body = (await convRes.json()) as {
      metadata: Record<string, unknown>;
      render?: unknown;
      outputs: Array<{ name: string; contentType: string; fileId: string }>;
    };

    expect(body.metadata).toBeDefined();
    expect(body.render).toBeUndefined(); // Animation render skipped
    expect(body.outputs.length).toBe(1);
    expect(body.outputs[0].name).toBe('glb');
    expect(body.outputs[0].contentType).toBe('model/gltf-binary');
  });

  it('enforces queue limits and rejects excess requests with 503', async () => {
    const queueManager = new RenderManager({
      maxConcurrentRenders: 1,
      queueSize: 1,
      queueWaitSeconds: 1,
    });

    // Simulate busy queue by blocking the single slot
    const slowTask = queueManager.render({
      input: { fileId: testInputFileId },
      outputs: ['glb'],
      options: {},
    });

    // Second task enters the queue (queue size 1)
    const queuedTask = queueManager.render({
      input: { fileId: testInputFileId },
      outputs: ['glb'],
      options: {},
    });

    // Third task exceeds queue capacity and must reject with 503
    let errorCaught = false;
    try {
      await queueManager.render({
        input: { fileId: testInputFileId },
        outputs: ['glb'],
        options: {},
      });
    } catch (err: unknown) {
      errorCaught = true;
      const appErr = err as { code: string; status: number };
      expect(appErr.code).toBe('queue_full');
      expect(appErr.status).toBe(503);
    }
    expect(errorCaught).toBe(true);

    // Clean up
    await Promise.allSettled([slowTask, queuedTask]);
  });
});
