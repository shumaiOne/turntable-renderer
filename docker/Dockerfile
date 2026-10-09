# ==============================================================================
# Stage 1: Build standalone single-file binary using Bun
# ==============================================================================
FROM --platform=linux/amd64 oven/bun:1.4.2 AS builder

WORKDIR /build

# Copy dependencies manifest and install dependencies
COPY package.json bunfig.toml bun.lock ./
RUN bun install --frozen-lockfile

# Copy tsconfig and source code
COPY tsconfig.json ./
COPY src/ ./src/

# Compile single-file executable with bytecode and minification
RUN bun build --compile --minify --bytecode --sourcemap \
    src/turntable-renderer/index.ts --outfile /build/turntable-renderer

# ==============================================================================
# Stage 2: Download and install Blender LTS
# ==============================================================================
FROM --platform=linux/amd64 debian:bookworm-slim AS blender-installer

ARG BLENDER_VERSION=5.2.2
ARG BLENDER_SHA256=84098912789dc450e95697c4184fb8a90acbe5111c2ba4aede3fecb57806a168

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    xz-utils \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL -o /tmp/blender.tar.xz \
    "https://download.blender.org/release/Blender5.2/blender-${BLENDER_VERSION}-linux-x64.tar.xz" && \
    echo "${BLENDER_SHA256}  /tmp/blender.tar.xz" | sha256sum -c - && \
    mkdir -p /opt/blender && \
    tar -xJf /tmp/blender.tar.xz -C /opt/blender --strip-components=1 && \
    rm /tmp/blender.tar.xz && \
    chmod -R 755 /opt/blender

# ==============================================================================
# Stage 3: Minimal runner image (Debian Bookworm Slim)
# ==============================================================================
FROM --platform=linux/amd64 debian:bookworm-slim AS runner

ENV DEBIAN_FRONTEND=noninteractive \
    PATH="/opt/blender:${PATH}" \
    DATA_DIR=/app/data \
    PORT=3000 \
    HOST=0.0.0.0

# Install runtime dependencies for Blender and curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    procps \
    libxkbcommon0 \
    libxi6 \
    libxxf86vm1 \
    libxfixes3 \
    libxrender1 \
    libgl1 \
    libegl1 \
    libsm6 \
    libgl1-mesa-dri \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Create non-root appuser
RUN groupadd -g 1001 appgroup && \
    useradd -u 1001 -g appgroup -m -s /bin/bash appuser

WORKDIR /app

# Copy Blender installation from blender-installer stage
COPY --from=blender-installer --chown=root:root /opt/blender /opt/blender

# Copy compiled standalone executable from builder stage
COPY --from=builder --chown=appuser:appgroup /build/turntable-renderer /app/turntable-renderer

# Copy Blender Python scripts and environment assets
COPY --chown=appuser:appgroup src/turntable-renderer/blender /app/src/turntable-renderer/blender
COPY --chown=appuser:appgroup src/turntable-renderer/assets /app/src/turntable-renderer/assets

# Prepare data storage directory
RUN mkdir -p /app/data && \
    chown -R appuser:appgroup /app

USER appuser

EXPOSE 3000

VOLUME ["/app/data"]

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

CMD ["/app/turntable-renderer"]
