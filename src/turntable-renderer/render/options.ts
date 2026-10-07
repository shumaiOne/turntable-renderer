import { z } from 'zod';
import { RENDER_DEFAULTS } from '../defaults.js';
import { settings } from '../settings.js';

export const BackgroundColorSchema = z.object({
  type: z.literal('color'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$|^#[0-9a-fA-F]{3}$/, 'Must be a valid hex color code'),
});

export const BackgroundTransparentSchema = z.object({
  type: z.literal('transparent'),
});

export const BackgroundSchema = z.discriminatedUnion('type', [
  BackgroundColorSchema,
  BackgroundTransparentSchema,
]);

export const PosterOptionsSchema = z.object({
  angle: z.number().default(0),
});

export const RenderOptionsSchema = z
  .object({
    width: z.number().int().min(128).max(settings.MAX_WIDTH).default(RENDER_DEFAULTS.width),
    height: z.number().int().min(128).max(settings.MAX_HEIGHT).default(RENDER_DEFAULTS.height),
    frames: z.number().int().min(1).max(settings.MAX_FRAMES).default(RENDER_DEFAULTS.frames),
    fps: z.number().int().min(1).max(60).default(RENDER_DEFAULTS.fps),
    totalDegrees: z.number().default(RENDER_DEFAULTS.totalDegrees),
    startAngle: z.number().default(RENDER_DEFAULTS.startAngle),
    direction: z.enum(['cw', 'ccw']).default(RENDER_DEFAULTS.direction),
    includeEndFrame: z.boolean().default(RENDER_DEFAULTS.includeEndFrame),
    elevationDegrees: z.number().min(-89).max(89).default(RENDER_DEFAULTS.elevationDegrees),
    fovDegrees: z.number().min(1).max(120).default(RENDER_DEFAULTS.fovDegrees),
    framingMode: z.enum(['fixed', 'perFrame']).default(RENDER_DEFAULTS.framingMode),
    framingMargin: z.number().min(0.5).max(5.0).default(RENDER_DEFAULTS.framingMargin),
    lighting: z.enum(['studio-dark', 'studio', 'flat']).default(RENDER_DEFAULTS.lighting),
    lightingIntensity: z.number().min(0).max(10).default(RENDER_DEFAULTS.lightingIntensity),
    background: BackgroundSchema.default(RENDER_DEFAULTS.background),
    shading: z.enum(['material', 'rendered', 'solid']).default(RENDER_DEFAULTS.shading),
    groundShadow: z.boolean().default(RENDER_DEFAULTS.groundShadow),
    engine: z.literal('cycles').default(RENDER_DEFAULTS.engine),
    samples: z.number().int().min(1).max(settings.MAX_SAMPLES).default(RENDER_DEFAULTS.samples),
    format: z.enum(['mp4', 'webm', 'png-sequence']).default(RENDER_DEFAULTS.format),
    crf: z.number().int().min(0).max(51).optional(),
    pixFmt: z.literal('yuv420p').default(RENDER_DEFAULTS.pixFmt),
    keyframeInterval: z.number().int().min(1).optional(),
    poster: PosterOptionsSchema.optional(),
  })
  .strict();

export type RenderOptions = z.infer<typeof RenderOptionsSchema>;

export const RenderOutputEnum = z.enum(['video', 'poster', 'glb', 'usdz']);
export type RenderOutput = z.infer<typeof RenderOutputEnum>;

export const RenderRequestSchema = z
  .object({
    input: z.object({
      fileId: z.string().min(1, 'input.fileId is required'),
    }),
    outputs: z.array(RenderOutputEnum).default(['video']),
    options: RenderOptionsSchema.default({}),
  })
  .strict()
  .refine(
    (req) => {
      // Reject transparent MP4
      const isTransparent = req.options?.background?.type === 'transparent';
      const isMp4 = (req.options?.format || 'mp4') === 'mp4';
      const rendersVideo = req.outputs?.includes('video');
      return !(isTransparent && isMp4 && rendersVideo);
    },
    {
      message:
        'Transparent background is not supported with MP4 video output. Use WebM or PNG sequence.',
      path: ['options', 'background'],
    },
  );

export type RenderRequest = z.infer<typeof RenderRequestSchema>;
export type RenderRequestInput = z.input<typeof RenderRequestSchema>;
