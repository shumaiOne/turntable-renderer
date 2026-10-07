# Phase 0 Spike & Engine Evaluation

## Objectives
1. Verify Blender 4.5.x LTS headless execution inside container.
2. Compare render engines:
   - `workbench`: Fast preview rendering.
   - `eevee`: Fast glossy rasterization.
   - `cycles`: High-fidelity path tracer (CPU fallback).
3. Test encoding at:
   - 24 frames × 1080×1080 (standard turntable).
   - 120 frames × 720p (extended animation test).
4. Measure render time, output file size, and visual match against `reference/frameio.mp4`.

## Test Setup
Input model: `reference/test.glb` (64 MB benchmark model)
Reference video: `reference/frameio.mp4`

## Commands
Build container:
```bash
docker build -t turntable-renderer:phase0 -f docker/Dockerfile .
```

Run test server:
```bash
docker run --rm -p 3000:3000 turntable-renderer:phase0
```
