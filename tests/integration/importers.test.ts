import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  getBlenderVersion,
  runBlenderScript,
} from '../../src/turntable-renderer/render/blender-runner.js';
import { writeAllFixtures } from '../fixtures/generate-fixtures.js';

const TEST_SCRATCH_DIR = join(import.meta.dir, '../../scratch/integration_test');
const FIXTURES_DIR = join(import.meta.dir, '../fixtures/models');
const SCRIPT_PATH = join(import.meta.dir, '../../src/turntable-renderer/blender/render.py');

describe('Blender Native Importers Integration Tests', () => {
  let blenderAvailable = false;

  beforeAll(async () => {
    writeAllFixtures();
    mkdirSync(TEST_SCRATCH_DIR, { recursive: true });

    const version = await getBlenderVersion();
    blenderAvailable = !version.includes('unavailable');
  });

  afterAll(() => {
    try {
      rmSync(TEST_SCRATCH_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  const testFormats = [
    { ext: 'obj', file: 'cube.obj' },
    { ext: 'stl', file: 'cube.stl' },
    { ext: 'dae', file: 'cube.dae' },
    { ext: 'gltf', file: 'cube.gltf' },
    { ext: 'usda', file: 'cube.usda' },
    { ext: 'fbx', file: 'cube.fbx' },
    { ext: 'usdz', file: 'cube.usdz' },
  ];

  for (const { ext, file } of testFormats) {
    it(`imports .${ext} and generates valid metadata and poster`, async () => {
      if (!blenderAvailable) {
        console.warn(`Skipping .${ext} test: Blender is not installed on this host.`);
        return;
      }

      const outDir = join(TEST_SCRATCH_DIR, ext);
      mkdirSync(outDir, { recursive: true });

      const taskJsonPath = join(outDir, 'task.json');
      const task = {
        inputFile: join(FIXTURES_DIR, file),
        format: ext,
        outputDir: outDir,
        outputs: ['poster'],
        options: {
          width: 512,
          height: 512,
          frames: 1,
          fps: 6,
          samples: 1,
        },
      };

      await Bun.write(taskJsonPath, JSON.stringify(task));

      const result = await runBlenderScript({
        scriptPath: SCRIPT_PATH,
        args: [taskJsonPath],
      });

      if (ext === 'dae' && result.exitCode !== 0) {
        expect(result.stderr).toContain('not supported');
        return;
      }

      expect(result.exitCode).toBe(0);

      const metadataPath = join(outDir, 'metadata.json');
      expect(existsSync(metadataPath)).toBe(true);

      const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
      expect(metadata.format).toBe(ext);
      expect(metadata.meshCount).toBeGreaterThan(0);
      expect(metadata.polygonCount).toBeGreaterThan(0);
      expect(Array.isArray(metadata.dimensions)).toBe(true);
      expect(metadata.dimensions.length).toBe(3);

      const posterPath = join(outDir, 'poster.png');
      expect(existsSync(posterPath)).toBe(true);
      const posterBuf = readFileSync(posterPath);
      expect(posterBuf.readUInt32BE(16)).toBe(512);
      expect(posterBuf.readUInt32BE(20)).toBe(512);
    }, 30000);
  }

  it('rejects .gltf with external references', async () => {
    if (!blenderAvailable) {
      return;
    }

    const outDir = join(TEST_SCRATCH_DIR, 'external_ref');
    mkdirSync(outDir, { recursive: true });

    const taskJsonPath = join(outDir, 'task.json');
    const task = {
      inputFile: join(FIXTURES_DIR, 'external_ref.gltf'),
      format: 'gltf',
      outputDir: outDir,
      outputs: ['poster'],
    };

    await Bun.write(taskJsonPath, JSON.stringify(task));

    const result = await runBlenderScript({
      scriptPath: SCRIPT_PATH,
      args: [taskJsonPath],
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('External reference rejected');
  });

  it('rejects unsupported 3DS format', async () => {
    if (!blenderAvailable) {
      return;
    }

    const outDir = join(TEST_SCRATCH_DIR, 'unsupported_3ds');
    mkdirSync(outDir, { recursive: true });

    const taskJsonPath = join(outDir, 'task.json');
    const task = {
      inputFile: join(FIXTURES_DIR, 'cube.obj'),
      format: '3ds',
      outputDir: outDir,
      outputs: ['poster'],
    };

    await Bun.write(taskJsonPath, JSON.stringify(task));

    const result = await runBlenderScript({
      scriptPath: SCRIPT_PATH,
      args: [taskJsonPath],
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('not supported');
  });
});
