# turntable-renderer

Standalone 3D model turntable rendering HTTP server built with Bun, TypeScript, Hono, and isolated Blender 4.5 LTS subprocesses.

---

## Features
- **Isolated Rendering**: Every model is rendered inside an ephemeral, sandboxed Blender subprocess.
- **Deterministic Look**: Replicates Frame.io 3D turntable standards (1080×1080, 6 fps, 24 frames, single GOP, dark studio lighting, black background).
- **Zero Database**: Disk storage with JSON sidecars and automated TTL janitor cleanup.
- **Synchronous Queue**: In-process FIFO queue and semaphore preventing GPU/CPU exhaustion.

---

## Quickstart

### Running with Docker

```bash
# Build the Docker image
docker build -t turntable-renderer -f docker/Dockerfile .

# Run the container
docker run -p 3000:3000 -v $(pwd)/data:/app/data turntable-renderer
```

### Health Check

```bash
curl http://localhost:3000/health
# {"status":"ok"}

curl http://localhost:3000/version
# {"app":"turntable-renderer","version":"0.1.0","blender":"4.5.14","runtime":"bun"}
```

---

## Local Development

Requirements:
- [Bun 1.4+](https://bun.sh)
- Blender 4.5 LTS (optional for local testing; Docker is recommended)

```bash
# Install dependencies
bun install

# Verify format and lint
bun run check

# Typecheck
bun run typecheck

# Run unit tests
bun test

# Start development server
bun run dev
```

---

## License & Attribution
- Licensed under the [GNU General Public License v3.0](LICENSE).
- Includes attributions for Blender, Bun, Hono, and other open-source dependencies in [NOTICE](NOTICE).
