import { Hono } from 'hono';
import { AppError } from '../render/errors.js';
import { RenderRequestSchema } from '../render/options.js';
import { defaultRenderManager } from '../render/render-manager.js';
import { defaultTaskManager } from '../render/task-manager.js';

export const renderApi = new Hono();

// POST /v1/render - Synchronous metadata + poster render and enqueue async video render task
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

// GET /v1/render/tasks/:id - Retrieve async video render task status
renderApi.get('/tasks/:id', async (c) => {
  const id = c.req.param('id');
  const task = await defaultTaskManager.getTask(id);
  if (!task) {
    throw new AppError('task_not_found', `Render task '${id}' not found`, 404);
  }
  return c.json(task, 200);
});

// DELETE /v1/render/tasks/:id - Delete render task and clean up associated files
renderApi.delete('/tasks/:id', async (c) => {
  const id = c.req.param('id');
  const deleted = await defaultTaskManager.deleteTask(id);
  if (!deleted) {
    throw new AppError('task_not_found', `Render task '${id}' not found`, 404);
  }
  return c.json({ status: 'deleted', id }, 200);
});
