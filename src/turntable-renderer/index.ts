import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { filesApi } from './api/files.js';
import { healthApi } from './api/health.js';
import { versionApi } from './api/version.js';
import { defaultJanitor } from './files/janitor.js';
import { AppError, createErrorResponse } from './render/errors.js';
import { settings } from './settings.js';

export const app = new Hono();

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

// Unauthenticated health & version endpoints
app.route('/health', healthApi);
app.route('/version', versionApi);

// Files API
app.route('/v1/files', filesApi);

// Optional Basic Auth for protected endpoints
if (settings.BASIC_AUTH_USERNAME && settings.BASIC_AUTH_PASSWORD) {
  app.use(
    '/v1/*',
    basicAuth({
      username: settings.BASIC_AUTH_USERNAME,
      password: settings.BASIC_AUTH_PASSWORD,
    }),
  );
}

// Global 404 handler
app.notFound((c) => {
  return createErrorResponse(c, 'bad_request', 'Resource not found', 404);
});

// Global error handler
app.onError((err, c) => {
  if (err instanceof AppError) {
    return createErrorResponse(c, err.code, err.message, err.status, err.details);
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

export default {
  port: settings.PORT,
  hostname: settings.HOST,
  fetch: app.fetch,
};

if (import.meta.main) {
  defaultJanitor.start();
  console.log(
    JSON.stringify({
      level: 'info',
      message: `Turntable renderer server listening on http://${settings.HOST}:${settings.PORT}`,
    }),
  );
}
