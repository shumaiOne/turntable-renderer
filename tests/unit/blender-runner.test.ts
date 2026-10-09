import { describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import {
  getBlenderScriptPath,
  getBlenderVersion,
} from '../../src/turntable-renderer/render/blender-runner.js';
import { settings } from '../../src/turntable-renderer/settings.js';

describe('Blender Runner & Script Path Resolution', () => {
  it('resolves valid render.py script path', () => {
    const scriptPath = getBlenderScriptPath('render.py');
    expect(typeof scriptPath).toBe('string');
    expect(scriptPath.endsWith('render.py')).toBe(true);
    expect(existsSync(scriptPath)).toBe(true);
  });

  it('resolves valid metadata.py and importers.py script paths', () => {
    const metadataPath = getBlenderScriptPath('metadata.py');
    const importersPath = getBlenderScriptPath('importers.py');
    expect(existsSync(metadataPath)).toBe(true);
    expect(existsSync(importersPath)).toBe(true);
  });

  it('returns blender version string', async () => {
    const version = await getBlenderVersion();
    expect(typeof version).toBe('string');
    expect(version.length).toBeGreaterThan(0);
  });

  it('respects BLENDER_SCRIPT_PATH override when set and file exists', () => {
    const realScript = getBlenderScriptPath('render.py');
    const originalSetting = settings.BLENDER_SCRIPT_PATH;
    try {
      settings.BLENDER_SCRIPT_PATH = realScript;
      expect(getBlenderScriptPath('custom.py')).toBe(realScript);
    } finally {
      settings.BLENDER_SCRIPT_PATH = originalSetting;
    }
  });
});
