import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { HTTPException } from 'hono/http-exception';
import { filesApi } from './api/files.js';
import { healthApi } from './api/health.js';
import { renderApi } from './api/render.js';
import { versionApi } from './api/version.js';
import { defaultJanitor } from './files/janitor.js';
import { AppError, createErrorResponse } from './render/errors.js';
import { type Settings, settings as defaultSettings } from './settings.js';

export function createApp(customSettings: Settings = defaultSettings): Hono {
  const app = new Hono();

  // Request logging & Correlation ID
  app.use('*', async (c, next) => {
    const requestId = c.req.header('x-request-id') || crypto.randomUUID();
    c.header('x-request-id', requestId);

    const start = Date.now();
    await next();
    const elapsed = Date.now() - start;

    // Structured JSON logging
    console.log(
      JSON.stringify({
        level: 'info',
        requestId,
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        elapsedMs: elapsed,
      }),
    );
  });

  // Optional Basic Auth for protected endpoints
  if (
    customSettings.TURNTABLE_RENDERER_API_BASIC_AUTH_USERNAME &&
    customSettings.TURNTABLE_RENDERER_API_BASIC_AUTH_PASSWORD
  ) {
    app.use(
      '/v1/*',
      basicAuth({
        username: customSettings.TURNTABLE_RENDERER_API_BASIC_AUTH_USERNAME,
        password: customSettings.TURNTABLE_RENDERER_API_BASIC_AUTH_PASSWORD,
      }),
    );
  }

  // Unauthenticated health & version endpoints
  app.route('/health', healthApi);
  app.route('/version', versionApi);

  // Files & Render APIs
  app.route('/v1/files', filesApi);
  app.route('/v1/render', renderApi);

  // Global 404 handler
  app.notFound((c) => {
    return createErrorResponse(c, 'bad_request', 'Resource not found', 404);
  });

  // Global error handler
  app.onError((err, c) => {
    if (err instanceof AppError) {
      return createErrorResponse(c, err.code, err.message, err.status, err.details);
    }

    if (err instanceof HTTPException) {
      if (err.status === 401) {
        const authHeader = err.res?.headers.get('WWW-Authenticate') ?? 'Basic realm="Secure Area"';
        c.header('WWW-Authenticate', authHeader);
        return createErrorResponse(c, 'unauthorized', 'Unauthorized', 401);
      }
      return createErrorResponse(c, 'bad_request', err.message, err.status);
    }

    console.error(
      JSON.stringify({
        level: 'error',
        message: err.message,
        stack: err.stack,
      }),
    );

    return createErrorResponse(c, 'render_failed', err.message || 'Internal server error', 500);
  });

  return app;
}

export const app = createApp();

export default {
  port: defaultSettings.PORT,
  hostname: defaultSettings.HOST,
  fetch: app.fetch,
  maxRequestBodySize: defaultSettings.MAX_UPLOAD_MB * 1024 * 1024,
};

if (import.meta.main) {
  defaultJanitor.start();
  console.log(
    JSON.stringify({
      level: 'info',
      message: `Turntable renderer server listening on http://${defaultSettings.HOST}:${defaultSettings.PORT}`,
    }),
  );
}
