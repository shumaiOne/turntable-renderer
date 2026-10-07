import type { FileStore } from './file-store.js';
import { defaultFileStore } from './local-disk-store.js';

export class Janitor {
  private fileStore: FileStore;
  private intervalMs: number;
  private timer: Timer | null = null;

  constructor(fileStore: FileStore = defaultFileStore, intervalSeconds = 60) {
    this.fileStore = fileStore;
    this.intervalMs = intervalSeconds * 1000;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(async () => {
      try {
        await this.runCleanup();
      } catch (err) {
        console.error('Janitor cleanup error:', err);
      }
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runCleanup(): Promise<{ expiredFiles: number; tempFiles: number }> {
    const expiredFiles = await this.fileStore.cleanExpiredFiles();
    const tempFiles = await this.fileStore.cleanOrphanedTempFiles();
    return { expiredFiles, tempFiles };
  }
}

export const defaultJanitor = new Janitor();
