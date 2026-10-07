FROM oven/bun:1.4.2

ARG BLENDER_VERSION=5.2.2
ARG BLENDER_SHA256=84098912789dc450e95697c4184fb8a90acbe5111c2ba4aede3fecb57806a168

ENV DEBIAN_FRONTEND=noninteractive \
    PATH="/opt/blender:${PATH}" \
    DATA_DIR=/app/data \
    PORT=3000 \
    HOST=0.0.0.0

# Install runtime dependencies for Blender
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    xz-utils \
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

# Download and install Blender 5.2.x LTS
RUN curl -fsSL -o /tmp/blender.tar.xz \
    "https://download.blender.org/release/Blender5.2/blender-${BLENDER_VERSION}-linux-x64.tar.xz" && \
    echo "${BLENDER_SHA256}  /tmp/blender.tar.xz" | sha256sum -c - && \
    mkdir -p /opt/blender && \
    tar -xJf /tmp/blender.tar.xz -C /opt/blender --strip-components=1 && \
    rm /tmp/blender.tar.xz && \
    chmod -R 755 /opt/blender

# Create non-root appuser
RUN groupadd -g 1001 appgroup && \
    useradd -u 1001 -g appgroup -m -s /bin/bash appuser

WORKDIR /app

# Copy application configuration and lockfile
COPY package.json bunfig.toml bun.lock ./
RUN bun install --frozen-lockfile

# Copy application source code
COPY biome.json tsconfig.json ./
COPY src/ ./src/

# Prepare data storage directory
RUN mkdir -p /app/data && \
    chown -R appuser:appgroup /app

USER appuser

EXPOSE 3000

VOLUME ["/app/data"]

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

CMD ["bun", "run", "src/turntable-renderer/index.ts"]
