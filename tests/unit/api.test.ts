import { describe, expect, it } from 'bun:test';
import { RENDER_DEFAULTS } from '../../src/turntable-renderer/defaults.js';
import { app } from '../../src/turntable-renderer/index.js';

describe('API Health & Version Endpoints', () => {
  it('GET /health returns 200 and status ok', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);

    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ok');
  });

  it('GET /version returns app, version, runtime, and blender string', async () => {
    const res = await app.request('/version');
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      app: string;
      version: string;
      blender: string;
      runtime: string;
    };
    expect(body.app).toBe('turntable-renderer');
    expect(body.version).toBe('0.1.0');
    expect(body.runtime).toBe('bun');
    expect(typeof body.blender).toBe('string');
  });

  it('GET /unknown-route returns 404 with standard error body', async () => {
    const res = await app.request('/not-exists');
    expect(res.status).toBe(404);

    const body = (await res.json()) as {
      code: string;
      message: string;
      details: Record<string, unknown>;
    };
    expect(body.code).toBe('bad_request');
    expect(body.message).toBe('Resource not found');
  });
});

describe('Render Defaults', () => {
  it('matches Frame.io reference specifications', () => {
    expect(RENDER_DEFAULTS.width).toBe(1080);
    expect(RENDER_DEFAULTS.height).toBe(1080);
    expect(RENDER_DEFAULTS.frames).toBe(24);
    expect(RENDER_DEFAULTS.fps).toBe(6);
    expect(RENDER_DEFAULTS.durationSeconds).toBe(4.0);
    expect(RENDER_DEFAULTS.degreesPerFrame).toBe(15);
    expect(RENDER_DEFAULTS.direction).toBe('cw');
    expect(RENDER_DEFAULTS.includeEndFrame).toBe(false);
    expect(RENDER_DEFAULTS.framingMargin).toBe(1.2);
    expect(RENDER_DEFAULTS.elevationDegrees).toBe(0);
    expect(RENDER_DEFAULTS.fovDegrees).toBe(35);
    expect(RENDER_DEFAULTS.background.type).toBe('color');
    if (RENDER_DEFAULTS.background.type === 'color') {
      expect(RENDER_DEFAULTS.background.color).toBe('#000000');
    }
    expect(RENDER_DEFAULTS.pixFmt).toBe('yuv420p');
    expect(RENDER_DEFAULTS.engine).toBe('cycles');
    expect(RENDER_DEFAULTS.samples).toBe(16);
    expect(RENDER_DEFAULTS.envMap).toBe('studio_kontrast_04_1k');
    expect(RENDER_DEFAULTS.envIntensity).toBe(0.7);
    expect(RENDER_DEFAULTS.envRotation).toBe(0);
  });
});
