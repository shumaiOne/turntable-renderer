# Architecture Decision Records (ADRs)

## ADR 001: Subprocess Isolation for 3D Rendering
- **Status**: Accepted
- **Context**: The server needs to import arbitrary untrusted 3D models and render them into video and image sequences. 3D parsers and rendering engines can crash or consume unbounded memory.
- **Decision**: Run Blender strictly as an isolated subprocess per request (`blender -b --factory-startup --disable-autoexec -noaudio -P <script> -- <args>`). Never import `bpy` or embed Blender inside the Bun server process.
- **Consequences**: Memory leaks, crashes, or timeouts in Blender are confined to the subprocess. The server can terminate the entire subprocess group via `SIGKILL` without affecting other requests.

## ADR 002: Pinning Blender 4.5 LTS (4.5.14)
- **Status**: Accepted
- **Context**: Need a modern LTS version of Blender that supports standard 3D formats (glTF, USD, FBX, OBJ, STL, DAE) with stable CLI automation.
- **Decision**: Pin Blender `4.5.14` LTS (Linux x64 SHA-256: `9ba871ff2ecd36526b77432745980b7e6664ecd0c7ca11c48849073dcfe06da3`).
- **Consequences**: Deterministic builds inside Docker with verified checksums.

## ADR 003: Video Encoding via Blender Built-in FFmpeg
- **Status**: Accepted
- **Context**: Need to generate MP4 (`H.264`, `yuv420p`) matching Frame.io turntable specifications.
- **Decision**: Utilize Blender's internal FFmpeg output system directly (`FFMPEG` format, `MPEG4` container, `H264` codec, single GOP, no B-frames). Do not bundle external FFmpeg binaries into the v1 runtime image.
- **Consequences**: Minimizes Docker image size and operational complexity.

## ADR 004: In-Process Concurrency & Queuing for v1
- **Status**: Accepted
- **Context**: 3D rendering is CPU/GPU intensive. Concurrent renders must be controlled to prevent server exhaustion.
- **Decision**: Manage concurrency with an in-process Promise-based FIFO queue (`MAX_CONCURRENT_RENDERS=1` default, `QUEUE_SIZE`, `QUEUE_WAIT_SECONDS`). Excess requests return `503 Service Unavailable` with `Retry-After`.
- **Consequences**: Simple, zero-external-dependency queueing model suitable for single-replica deployments.

## ADR 005: Zero-Database File Storage with Sidecar Metadata
- **Status**: Accepted
- **Context**: Need persistent file storage for uploaded inputs and generated render outputs without introducing an external database.
- **Decision**: Implement `LocalDiskStore` where binary blobs are saved to `${DATA_DIR}/f_${id}.bin` and metadata is saved to `${DATA_DIR}/f_${id}.json`.
- **Consequences**: Completely self-contained, crash-resilient, and inspectable on disk.

## ADR 006: 3DS (.3ds) Format Status in Blender 4.5 LTS
- **Status**: Accepted
- **Context**: Plan requested investigating whether the legacy Autodesk 3DS (.3ds) importer is present in the pinned Blender 4.5.14 LTS build.
- **Decision**: The 3DS importer was removed from Blender core and is not shipped in standard 4.5 LTS builds. Requests with `.3ds` will be rejected with `unsupported_format` (or `422`).
- **Consequences**: Avoids bundling untrusted external addons; aligns with modern industry standards favoring glTF, USD, and FBX.

## ADR 007: Cycles CPU Engine Hardcoding for v1
- **Status**: Accepted
- **Context**: In headless CPU environments (e.g. Docker on Linux without GPU passthrough using Mesa llvmpipe), Eevee Next takes ~3.8 min/frame due to heavy software OpenGL/Vulkan shader compilation and rasterization, while Workbench only produces flat unshaded CAD previews without realistic materials or lighting. Cycles on CPU with path tracing (16 samples default) delivers photorealistic PBR materials, shadows, and studio lighting in ~14.8s/frame (and ~0.5s for small models/fixtures).
- **Decision**: For v1, hardcode Cycles engine on CPU. Do not expose or allow Eevee or Workbench in v1 options; reject non-cycles engine requests with `422 invalid_options`.
- **Consequences**: Simplifies codebase, removes unnecessary environment variables and engine branch detection, and ensures consistent, deterministic, high-quality PBR renders across all platforms.

## ADR 008: Support and Pin Blender 5.2.2 LTS
- **Status**: Accepted
- **Context**: Local host environments and updated deployments use Blender 5.2.2 LTS. Blender 5.x introduces layered/slotted action animation systems, splits `media_type` into `VIDEO` and `IMAGE` for FFmpeg render configurations, and removes the deprecated legacy Collada (.dae) operator.
- **Decision**: Pin Blender `5.2.2` LTS (Linux x64 SHA-256: `84098912789dc450e95697c4184fb8a90acbe5111c2ba4aede3fecb57806a168`) in Dockerfile and update python helper scripts to support Blender 5.x animation and video encoding while maintaining backwards compatibility.
- **Consequences**: Enables local development and production Docker runs using Blender 5.2.2 LTS without deprecation errors or animation curve lookup failures.
