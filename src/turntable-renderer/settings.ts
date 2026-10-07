import { z } from 'zod';

const SettingsSchema = z.object({
  // Server
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),

  // Storage
  DATA_DIR: z.string().default('./data'),
  MAX_UPLOAD_MB: z.coerce.number().default(500),
  FILE_TTL_SECONDS: z.coerce.number().default(86400),
  MAX_STORAGE_GB: z.coerce.number().default(50),
  MAX_CONCURRENT_UPLOADS: z.coerce.number().default(10),

  // Render Constraints & Timeouts
  MAX_FRAMES: z.coerce.number().default(240),
  MAX_WIDTH: z.coerce.number().default(3840),
  MAX_HEIGHT: z.coerce.number().default(3840),
  MAX_SAMPLES: z.coerce.number().default(256),
  RENDER_TIMEOUT_SECONDS: z.coerce.number().default(120),

  // Concurrency & Queue
  MAX_CONCURRENT_RENDERS: z.coerce.number().default(1),
  QUEUE_SIZE: z.coerce.number().default(10),
  QUEUE_WAIT_SECONDS: z.coerce.number().default(60),

  // Blender Subprocess
  BLENDER_PATH: z.string().default('blender'),
  RENDER_ENGINE: z.enum(['eevee', 'cycles', 'workbench']).default('eevee'),

  // Auth (Optional Basic Auth)
  BASIC_AUTH_USERNAME: z.string().optional(),
  BASIC_AUTH_PASSWORD: z.string().optional(),
});

export type Settings = z.infer<typeof SettingsSchema>;

export function loadSettings(env: Record<string, string | undefined> = process.env): Settings {
  return SettingsSchema.parse(env);
}

export const settings = loadSettings();
