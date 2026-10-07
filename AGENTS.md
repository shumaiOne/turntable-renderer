# Developer & Agent Guide — turntable-renderer

Standalone 3D model turntable rendering HTTP server built with Bun, TypeScript, Hono, and isolated Blender 4.5 LTS subprocesses.

---

## 1. Core Principles & Architecture Boundaries

1. **Standalone & Client-Agnostic**:
   - This service is completely independent. No Shumai-specific endpoints, packages, databases, or assumptions are permitted.
2. **Application Runtime**:
   - **Bun 1.4+**, **TypeScript**, **Hono**, **Zod**, **Biome**, and **`bun:test`**.
3. **Strict Subprocess Isolation**:
   - Blender runs **strictly** as an isolated subprocess spawned per render request:
     ```bash
     blender -b --factory-startup --disable-autoexec -noaudio -P <script> -- <args>
     ```
   - **Never import `bpy`** or embed Blender inside the Bun process. Python code exists solely inside Blender-executed scripts under `src/turntable-renderer/blender/`.
   - Blender subprocesses must not perform any outbound network requests.
   - On client disconnect or timeout, kill the **entire subprocess group** (`SIGKILL` to `-pid`) and clean up all temporary directories.
4. **Video Encoding**:
   - Blender encodes MP4/WebM directly using its built-in FFmpeg output pipeline. Do not introduce a standalone FFmpeg binary or external process in the runtime container for v1.
5. **Zero-Database File Storage**:
   - Files are stored as opaque binary blobs on local disk (`LocalDiskStore`) with sidecar metadata:
     - Blob: `${DATA_DIR}/f_${id}.bin`
     - Metadata: `${DATA_DIR}/f_${id}.json`
   - File IDs follow `f_` + base32(random 16 bytes).
   - Filenames are display metadata only and are never used in filesystem paths.
   - Background janitor handles TTL expiration, orphaned file cleanup, and quota enforcement (`507 Insufficient Storage`).
6. **In-Process Concurrency & Queuing**:
   - Rendering is synchronous in v1.
   - Concurrency is managed via an in-process semaphore (`MAX_CONCURRENT_RENDERS=1` default) and FIFO queue (`QUEUE_SIZE`, `QUEUE_WAIT_SECONDS`).
   - If the queue is full or wait time expires, return `503 Service Unavailable` with `Retry-After`.
7. **Deterministic Visual Defaults**:
   - All visual defaults (1080×1080, 6 fps, 24 frames, 15°/frame, clockwise, `framingMargin = 1.35`, `studio-dark` lighting, pure black `#000000` background) must reside in `src/turntable-renderer/defaults.ts`.

---

## 2. API Contract & Error Handling

### HTTP API Endpoints

- `GET /health`: Health check (unauthenticated).
- `GET /version`: App version, runtime (`bun`), Blender version (unauthenticated).
- `POST /v1/files`: Upload file (streaming directly to disk, sha256 calculation, raw octet-stream or multipart).
- `GET /v1/files/:id`: Download file (streaming, Range requests `206`/`416`, ETag, Content-Disposition).
- `HEAD /v1/files/:id`: Metadata headers only.
- `GET /v1/files/:id/info`: File metadata (`id`, `name`, `size`, `sha256`, `contentType`, `kind`, `createdAt`, `expiresAt`).
- `DELETE /v1/files/:id`: Delete file (`409 file_in_use` if currently pinned by a render).
- `POST /v1/render`: Synchronous render execution (`input.fileId`, `outputs`, `options`).

### Error Response Schema

All HTTP errors must strictly follow the format:

```json
{
  "code": "error_code",
  "message": "Human-readable message",
  "details": {}
}
```

Standard codes:
- `400 bad_request`
- `401 unauthorized`
- `404 input_not_found`
- `409 file_in_use`
- `413 upload_too_large`
- `422 unsupported_format` | `invalid_options` | `import_failed` | `checksum_mismatch`
- `500 render_failed`
- `503 queue_full`
- `504 render_timeout`
- `507 storage_full`

---

## 3. Repository Layout

```text
turntable-renderer/
├── src/
│   └── turntable-renderer/
│       ├── api/
│       │   ├── files.ts
│       │   ├── render.ts
│       │   ├── health.ts
│       │   └── version.ts
│       ├── files/
│       │   ├── file-store.ts
│       │   ├── local-disk-store.ts
│       │   └── janitor.ts
│       ├── render/
│       │   ├── render-manager.ts
│       │   ├── blender-runner.ts
│       │   ├── options.ts
│       │   └── errors.ts
│       ├── blender/
│       │   ├── render.py
│       │   ├── metadata.py
│       │   └── importers.py
│       ├── defaults.ts
│       ├── settings.ts
│       └── index.ts
├── tests/
│   ├── unit/
│   ├── integration/
│   └── fixtures/
├── reference/          # gitignored reference media
├── docker/
│   └── Dockerfile
├── docs/
│   ├── API.md
│   ├── FORMATS.md
│   ├── REFERENCE.md
│   ├── SPIKE.md
│   └── DECISIONS.md
├── package.json
├── tsconfig.json
├── biome.json
├── README.md
├── LICENSE
└── NOTICE
```

---

## 4. Coding & Tooling Standards

- **Runtime & Package Manager**: Bun (`bun`).
- **Linter & Formatter**: Biome. Use `bun run check` (or `bun x @biomejs/biome check --write`).
- **Type Checking**: `bun run typecheck` (`tsc --noEmit`).
- **Testing**: `bun test`. Test files live under `tests/` or alongside source (`*.test.ts`).
- **No Explicit `any`**: Use `unknown` or narrow typed shapes. Never bypass types without documented justification.
- **Structured Logging**: Use structured JSON log output with request correlation IDs (`requestId`).

---

## 5. Testing & Verification Rules

- **Strict Simultaneous Pass**: Any completed phase, feature, or PR must pass all checks simultaneously:
  ```bash
  bun run check
  bun run typecheck
  bun test
  ```
- **Bug Fix Rule**: Every bug fix MUST begin with a failing regression test reproducing the problem before the fix is applied.
- **Test Maintenance**: Do not delete tests unless the corresponding functionality is permanently removed. Refactor tests when implementations evolve.
- **Test Fixtures**: Generate small programmatic fixtures where possible. Never commit large binary models or private reference media to git.
- **Cleanup**: Verification scripts, temporary files, and render artifacts must be cleaned up before submission.

---

## 6. Commit & Workflow Guidelines

- **Branching**: Develop features and phases on dedicated branches.
- **Conventional Commits**: Format commit messages as:
  ```text
  <type>[optional scope]: <description>
  ```
  Types: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`. Imperative mood, concise and descriptive.
- **Decision Records**: When architectural decisions, pinned versions, or tradeoffs are made, document them promptly in `docs/DECISIONS.md`.
