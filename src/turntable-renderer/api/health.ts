import { Hono } from 'hono';

export const healthApi = new Hono();

healthApi.get('/', (c) => {
  return c.json({ status: 'ok' }, 200);
});
