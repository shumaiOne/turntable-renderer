import { describe, expect, it } from 'bun:test';
import { createApp } from '../../src/turntable-renderer/index.js';
import { loadSettings } from '../../src/turntable-renderer/settings.js';

describe('Basic Auth Integration & Error Handling', () => {
  const authSettings = loadSettings({
    TURNTABLE_RENDERER_API_BASIC_AUTH_USERNAME: 'admin',
    TURNTABLE_RENDERER_API_BASIC_AUTH_PASSWORD: 'secretpassword',
  });

  const appWithAuth = createApp(authSettings);

  it('allows unauthenticated access to /health and /version even when auth is enabled', async () => {
    const healthRes = await appWithAuth.request('/health');
    expect(healthRes.status).toBe(200);
    const healthBody = (await healthRes.json()) as { status: string };
    expect(healthBody.status).toBe('ok');

    const versionRes = await appWithAuth.request('/version');
    expect(versionRes.status).toBe(200);
    const versionBody = (await versionRes.json()) as { app: string };
    expect(versionBody.app).toBe('turntable-renderer');
  });

  it('returns 401 unauthorized (not 500) when request to /v1/* lacks credentials', async () => {
    const res = await appWithAuth.request('/v1/files');
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('Basic realm="Secure Area"');

    const body = (await res.json()) as {
      code: string;
      message: string;
      details: Record<string, unknown>;
    };
    expect(body.code).toBe('unauthorized');
    expect(body.message).toBe('Unauthorized');
  });

  it('returns 401 unauthorized when request to /v1/* has invalid credentials', async () => {
    const invalidAuth = `Basic ${Buffer.from('admin:wrongpass').toString('base64')}`;
    const res = await appWithAuth.request('/v1/files', {
      headers: { Authorization: invalidAuth },
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('Basic realm="Secure Area"');

    const body = (await res.json()) as {
      code: string;
      message: string;
      details: Record<string, unknown>;
    };
    expect(body.code).toBe('unauthorized');
    expect(body.message).toBe('Unauthorized');
  });

  it('allows access to /v1/* when valid credentials are provided', async () => {
    const validAuth = `Basic ${Buffer.from('admin:secretpassword').toString('base64')}`;
    // Testing /v1/render/tasks/t_unknown which should pass auth and return 404 (not 401)
    const res = await appWithAuth.request('/v1/render/tasks/t_unknown', {
      headers: { Authorization: validAuth },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('task_not_found');
  });
});
