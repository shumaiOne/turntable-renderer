import { Hono } from 'hono';
import { AppError } from '../render/errors.js';
import { RenderRequestSchema } from '../render/options.js';
import { defaultRenderManager } from '../render/render-manager.js';

export const renderApi = new Hono();

// POST /v1/render - Synchronous 3D model render
renderApi.post('/', async (c) => {
  let bodyJson: unknown;
  try {
    bodyJson = await c.req.json();
  } catch {
    throw new AppError('bad_request', 'Invalid JSON request body', 400);
  }

  const parseResult = RenderRequestSchema.safeParse(bodyJson);
  if (!parseResult.success) {
    throw new AppError('invalid_options', 'Invalid render request options', 422, {
      errors: parseResult.error.format(),
    });
  }

  const result = await defaultRenderManager.render(parseResult.data, c.req.raw.signal);
  return c.json(result, 200);
});
