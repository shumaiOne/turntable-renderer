export type FileKind = 'input' | 'output';

export interface FileMetadata {
  id: string;
  name: string;
  size: number;
  sha256: string;
  contentType: string;
  kind: FileKind;
  createdAt: string;
  expiresAt: string;
  pinned: boolean;
}

export interface StoreFileInput {
  stream: ReadableStream<Uint8Array>;
  name: string;
  contentType?: string;
  kind?: FileKind;
  expectedSha256?: string;
}

export interface FileStore {
  storeFile(input: StoreFileInput): Promise<FileMetadata>;
  saveBuffer(
    buffer: Uint8Array,
    name: string,
    contentType: string,
    kind?: FileKind,
  ): Promise<FileMetadata>;
  getFileStream(
    id: string,
    range?: { start: number; end: number },
  ): Promise<{ stream: ReadableStream<Uint8Array>; metadata: FileMetadata }>;
  getFileMetadata(id: string): Promise<FileMetadata | null>;
  deleteFile(id: string): Promise<boolean>;
  pinFile(id: string): Promise<void>;
  unpinFile(id: string): Promise<void>;
  isPinned(id: string): Promise<boolean>;
  cleanExpiredFiles(): Promise<number>;
  cleanOrphanedTempFiles(): Promise<number>;
  getTotalStorageBytes(): Promise<number>;
}
