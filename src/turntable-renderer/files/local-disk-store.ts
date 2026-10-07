import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { extname, join } from 'node:path';
import { AppError } from '../render/errors.js';
import { settings } from '../settings.js';
import type { FileMetadata, FileStore, StoreFileInput } from './file-store.js';

export function generateFileId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  let result = 'f_';
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    result += alphabet[(value << (5 - bits)) & 31];
  }
  return result;
}

export function sanitizeFilename(name: string): string {
  const base = name.trim().replace(/^.*[\\/]/, '');
  return base.replace(/[^a-zA-Z0-9._-]/g, '_') || 'file.bin';
}

export function detectContentType(filename: string): string {
  const ext = extname(filename).toLowerCase();
  switch (ext) {
    case '.glb':
      return 'model/gltf-binary';
    case '.gltf':
      return 'model/gltf+json';
    case '.usdz':
      return 'model/vnd.usdz+zip';
    case '.usd':
    case '.usda':
    case '.usdc':
      return 'model/vnd.usd';
    case '.obj':
      return 'model/obj';
    case '.stl':
      return 'model/stl';
    case '.dae':
      return 'model/vnd.collada+xml';
    case '.fbx':
      return 'application/octet-stream';
    case '.mp4':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.zip':
      return 'application/zip';
    case '.json':
      return 'application/json';
    default:
      return 'application/octet-stream';
  }
}

export class LocalDiskStore implements FileStore {
  private dataDir: string;
  private maxUploadBytes: number;
  private fileTtlSeconds: number;
  private maxStorageBytes: number;

  constructor(options?: {
    dataDir?: string;
    maxUploadMb?: number;
    fileTtlSeconds?: number;
    maxStorageGb?: number;
  }) {
    this.dataDir = options?.dataDir ?? settings.DATA_DIR;
    this.maxUploadBytes = (options?.maxUploadMb ?? settings.MAX_UPLOAD_MB) * 1024 * 1024;
    this.fileTtlSeconds = options?.fileTtlSeconds ?? settings.FILE_TTL_SECONDS;
    this.maxStorageBytes = (options?.maxStorageGb ?? settings.MAX_STORAGE_GB) * 1024 * 1024 * 1024;

    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
  }

  private getBlobPath(id: string): string {
    return join(this.dataDir, `${id}.bin`);
  }

  private getMetaPath(id: string): string {
    return join(this.dataDir, `${id}.json`);
  }

  async storeFile(input: StoreFileInput): Promise<FileMetadata> {
    const id = generateFileId();
    const tempPath = join(this.dataDir, `tmp_${crypto.randomUUID()}.tmp`);
    const sanitizedName = sanitizeFilename(input.name);
    const contentType = input.contentType || detectContentType(sanitizedName);
    const kind = input.kind || 'input';

    const hash = createHash('sha256');
    let size = 0;

    const fileWriter = Bun.file(tempPath).writer();

    try {
      const reader = input.stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        size += value.byteLength;
        if (size > this.maxUploadBytes) {
          throw new AppError(
            'upload_too_large',
            `Upload exceeds maximum allowed size of ${this.maxUploadBytes / (1024 * 1024)}MB`,
            413,
            { maxUploadMb: this.maxUploadBytes / (1024 * 1024), currentBytes: size },
          );
        }

        hash.update(value);
        fileWriter.write(value);
      }
      await fileWriter.end();

      const calculatedSha256 = hash.digest('hex');

      if (
        input.expectedSha256 &&
        input.expectedSha256.toLowerCase() !== calculatedSha256.toLowerCase()
      ) {
        throw new AppError(
          'checksum_mismatch',
          'Calculated SHA-256 does not match expected checksum',
          422,
          {
            expected: input.expectedSha256,
            actual: calculatedSha256,
          },
        );
      }

      // Check storage capacity
      let totalStorage = await this.getTotalStorageBytes();
      if (totalStorage + size > this.maxStorageBytes) {
        // Run janitor cleanup first
        await this.cleanExpiredFiles();
        totalStorage = await this.getTotalStorageBytes();
        if (totalStorage + size > this.maxStorageBytes) {
          throw new AppError('storage_full', 'Insufficient storage space available', 507, {
            maxStorageGb: this.maxStorageBytes / (1024 * 1024 * 1024),
            currentBytes: totalStorage,
            requiredBytes: size,
          });
        }
      }

      const finalBlobPath = this.getBlobPath(id);
      renameSync(tempPath, finalBlobPath);

      const now = new Date();
      const expiresAt = new Date(now.getTime() + this.fileTtlSeconds * 1000);

      const metadata: FileMetadata = {
        id,
        name: sanitizedName,
        size,
        sha256: calculatedSha256,
        contentType,
        kind,
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        pinned: false,
      };

      writeFileSync(this.getMetaPath(id), JSON.stringify(metadata, null, 2));
      return metadata;
    } catch (error) {
      try {
        fileWriter.end();
      } catch {
        // Ignore writer close error
      }
      if (existsSync(tempPath)) {
        try {
          unlinkSync(tempPath);
        } catch {
          // Ignore temp cleanup error
        }
      }
      throw error;
    }
  }

  async saveBuffer(
    buffer: Uint8Array,
    name: string,
    contentType: string,
    kind: 'input' | 'output' = 'output',
  ): Promise<FileMetadata> {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(buffer);
        controller.close();
      },
    });

    return this.storeFile({
      stream,
      name,
      contentType,
      kind,
    });
  }

  async getFileMetadata(id: string): Promise<FileMetadata | null> {
    const metaPath = this.getMetaPath(id);
    if (!existsSync(metaPath)) {
      return null;
    }
    try {
      const data = readFileSync(metaPath, 'utf8');
      return JSON.parse(data) as FileMetadata;
    } catch {
      return null;
    }
  }

  async getFileStream(
    id: string,
    range?: { start: number; end: number },
  ): Promise<{ stream: ReadableStream<Uint8Array>; metadata: FileMetadata }> {
    const metadata = await this.getFileMetadata(id);
    if (!metadata) {
      throw new AppError('input_not_found', `File '${id}' not found`, 404);
    }

    const blobPath = this.getBlobPath(id);
    if (!existsSync(blobPath)) {
      throw new AppError('input_not_found', `File blob for '${id}' not found`, 404);
    }

    const file = Bun.file(blobPath);

    if (range) {
      const { start, end } = range;
      if (start >= metadata.size || end >= metadata.size || start > end || start < 0) {
        throw new AppError('bad_request', 'Requested Range Not Satisfiable', 416, {
          fileSize: metadata.size,
          requestedRange: `${start}-${end}`,
        });
      }
      return {
        stream: file.slice(start, end + 1).stream(),
        metadata,
      };
    }

    return {
      stream: file.stream(),
      metadata,
    };
  }

  async deleteFile(id: string): Promise<boolean> {
    const metadata = await this.getFileMetadata(id);
    if (!metadata) {
      return false;
    }

    if (metadata.pinned) {
      throw new AppError(
        'file_in_use',
        `File '${id}' is currently pinned and in use by a render task`,
        409,
      );
    }

    const blobPath = this.getBlobPath(id);
    const metaPath = this.getMetaPath(id);

    if (existsSync(blobPath)) unlinkSync(blobPath);
    if (existsSync(metaPath)) unlinkSync(metaPath);
    return true;
  }

  async pinFile(id: string): Promise<void> {
    const metadata = await this.getFileMetadata(id);
    if (!metadata) {
      throw new AppError('input_not_found', `File '${id}' not found`, 404);
    }
    metadata.pinned = true;
    writeFileSync(this.getMetaPath(id), JSON.stringify(metadata, null, 2));
  }

  async unpinFile(id: string): Promise<void> {
    const metadata = await this.getFileMetadata(id);
    if (!metadata) return;
    metadata.pinned = false;
    writeFileSync(this.getMetaPath(id), JSON.stringify(metadata, null, 2));
  }

  async isPinned(id: string): Promise<boolean> {
    const metadata = await this.getFileMetadata(id);
    return metadata ? metadata.pinned : false;
  }

  async cleanExpiredFiles(): Promise<number> {
    let cleaned = 0;
    const now = Date.now();
    const files = readdirSync(this.dataDir);

    for (const file of files) {
      if (file.startsWith('f_') && file.endsWith('.json')) {
        const id = file.slice(0, -5);
        try {
          const meta = JSON.parse(readFileSync(join(this.dataDir, file), 'utf8')) as FileMetadata;
          if (new Date(meta.expiresAt).getTime() < now && !meta.pinned) {
            const blobPath = this.getBlobPath(id);
            if (existsSync(blobPath)) unlinkSync(blobPath);
            unlinkSync(join(this.dataDir, file));
            cleaned++;
          }
        } catch {
          // Ignore parse errors on corrupt metadata
        }
      }
    }
    return cleaned;
  }

  async cleanOrphanedTempFiles(): Promise<number> {
    let cleaned = 0;
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    const files = readdirSync(this.dataDir);

    for (const file of files) {
      if (file.startsWith('tmp_') && file.endsWith('.tmp')) {
        const filePath = join(this.dataDir, file);
        try {
          const stat = statSync(filePath);
          if (stat.mtimeMs < tenMinutesAgo) {
            unlinkSync(filePath);
            cleaned++;
          }
        } catch {
          // Ignore errors
        }
      }
    }
    return cleaned;
  }

  async getTotalStorageBytes(): Promise<number> {
    let total = 0;
    const files = readdirSync(this.dataDir);
    for (const file of files) {
      if (file.endsWith('.bin') || file.endsWith('.tmp')) {
        try {
          const stat = statSync(join(this.dataDir, file));
          total += stat.size;
        } catch {
          // Ignore stat errors
        }
      }
    }
    return total;
  }
}

export const defaultFileStore = new LocalDiskStore();
