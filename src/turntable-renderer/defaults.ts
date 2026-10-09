/**
 * Deterministic visual defaults for turntable-renderer.
 * Measured and aligned with Frame.io turntable reference standards.
 *
 * DO NOT use environment variables for visual render defaults.
 */

export interface BackgroundColor {
  type: 'color';
  color: string;
}

export interface BackgroundTransparent {
  type: 'transparent';
}

export type BackgroundSetting = BackgroundColor | BackgroundTransparent;

export const RENDER_DEFAULTS = {
  // Dimensions & Frame Rate (Video)
  width: 1080,
  height: 1080,
  frames: 24,
  fps: 6,
  durationSeconds: 4.0,

  // Poster Defaults
  posterWidth: 300,
  posterHeight: 300,
  posterAngle: 0,

  // Rotation
  totalDegrees: 360,
  degreesPerFrame: 15,
  startAngle: 0,
  direction: 'cw' as const,
  includeEndFrame: false,

  // Camera & Framing
  framingMode: 'fixed' as const,
  framingMargin: 1.2,
  elevationDegrees: 0,
  fovDegrees: 35,

  // Lighting & Background
  lighting: 'studio-dark' as const,
  lightingIntensity: 0.7,
  envMap: 'studio_kontrast_04_1k',
  envIntensity: 0.7,
  envRotation: 0,
  background: {
    type: 'color',
    color: '#000000',
  } as BackgroundSetting,

  // Shading & Environment
  shading: 'material' as const,
  groundShadow: false,

  // Engine (Cycles CPU hardcoded for v1)
  engine: 'cycles' as const,
  samples: 16,

  // Video Encoding Defaults (mirrored from Frame.io reference)
  format: 'mp4' as const,
  pixFmt: 'yuv420p' as const,
  crf: 23,
  keyframeInterval: 24,
} as const;

export type RenderDefaults = typeof RENDER_DEFAULTS;
