import { Hono } from 'hono';
import { getBlenderVersion } from '../render/blender-runner.js';

export const versionApi = new Hono();

versionApi.get('/', async (c) => {
  const blenderVersion = await getBlenderVersion();
  return c.json(
    {
      app: 'turntable-renderer',
      version: '0.1.0',
      blender: blenderVersion,
      runtime: 'bun',
    },
    200,
  );
});
