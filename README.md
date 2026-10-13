# turntable-renderer

Standalone 3D model turntable rendering HTTP server built with Bun, TypeScript, Hono, and isolated Blender 5.2 LTS subprocesses.

---

## Features
- **Isolated Rendering**: Every model is rendered inside an ephemeral, sandboxed Blender subprocess.
- **Deterministic Look**: Replicates Frame.io 3D turntable standards (1080×1080, 6 fps, 24 frames, single GOP, dark studio lighting, black background).
- **Zero Database**: Disk storage with JSON sidecars and automated TTL janitor cleanup.
- **Synchronous Queue**: In-process FIFO queue and semaphore preventing GPU/CPU exhaustion.

---

## Quickstart

### Running with Docker (Recommended)

The easiest way to run `turntable-renderer` is using the prebuilt Docker image from Docker Hub.

```bash
docker run -d --rm \
  --name turntable-renderer \
  -p 3003:3000 \
  -e TURNTABLE_RENDERER_API_BASIC_AUTH_USERNAME=admin \
  -e TURNTABLE_RENDERER_API_BASIC_AUTH_PASSWORD=your_password \
  shumaione/turntable-renderer:latest
```

> **Note**: Host port `3003` maps to internal container port `3000`.

#### Verification

```bash
# Health check (unauthenticated)
curl http://localhost:3003/health
# {"status":"ok"}

# Version information (unauthenticated)
curl http://localhost:3003/version
# {"app":"turntable-renderer","version":"0.1.0","blender":"5.2.2","runtime":"bun"}

# Authenticated API access (e.g. file listing/upload)
curl -u admin:your_password http://localhost:3003/v1/files
```

---

## GPU Acceleration

A GPU is optional, the CPU pipeline is fast enough for smooth sessions on modest hardware. When a GPU is mounted into the container it is automatically detected and configured for hardware rendering.

### Intel / AMD (open source drivers)

One flag is all it takes:

```bash
docker run -d --rm \
  --name turntable-renderer \
  --shm-size=1gb \
  -p 3003:3000 \
  --device /dev/dri \
  -e TURNTABLE_RENDERER_API_BASIC_AUTH_USERNAME=admin \
  -e TURNTABLE_RENDERER_API_BASIC_AUTH_PASSWORD=your_password \
  shumaione/turntable-renderer:latest
```

### Nvidia (proprietary drivers)

Requires host driver 580 or newer installed with the NVIDIA Container Toolkit (`--runtime nvidia`):

```bash
docker run -d --rm \
  --name turntable-renderer \
  --shm-size=1gb \
  -p 3003:3000 \
  --runtime nvidia \
  --gpus all \
  --device /dev/nvidia-modeset \
  -e TURNTABLE_RENDERER_API_BASIC_AUTH_USERNAME=admin \
  -e TURNTABLE_RENDERER_API_BASIC_AUTH_PASSWORD=your_password \
  shumaione/turntable-renderer:latest
```

---

## Building from Source

To build and run the Docker image locally from source:

```bash
# Build the Docker image
docker build -t turntable-renderer -f docker/Dockerfile .

# Run the container
docker run -d --rm \
  -p 3003:3000 \
  -e TURNTABLE_RENDERER_API_BASIC_AUTH_USERNAME=admin \
  -e TURNTABLE_RENDERER_API_BASIC_AUTH_PASSWORD=your_password \
  turntable-renderer
```

---

## Local Development

Requirements:
- [Bun 1.4+](https://bun.sh)
- Blender 5.2 LTS (optional for local testing; Docker is recommended)

```bash
# Install dependencies
bun install

# Verify format and lint
bun run check

# Typecheck
bun run typecheck

# Run unit and integration tests
bun test

# Start development server
bun run dev
```

---

## License & Attribution
- Licensed under the [GNU General Public License v3.0](LICENSE).
- Includes attributions for Blender, Bun, Hono, and other open-source dependencies in [NOTICE](NOTICE).
