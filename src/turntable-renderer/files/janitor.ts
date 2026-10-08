import { type TaskManager, defaultTaskManager } from '../render/task-manager.js';
import type { FileStore } from './file-store.js';
import { defaultFileStore } from './local-disk-store.js';

export class Janitor {
  private fileStore: FileStore;
  private taskManager: TaskManager;
  private intervalMs: number;
  private timer: Timer | null = null;

  constructor(
    fileStore: FileStore = defaultFileStore,
    taskManagerOrInterval?: TaskManager | number,
    intervalSeconds = 60,
  ) {
    this.fileStore = fileStore;
    if (typeof taskManagerOrInterval === 'number') {
      this.taskManager = defaultTaskManager;
      this.intervalMs = taskManagerOrInterval * 1000;
    } else {
      this.taskManager = taskManagerOrInterval ?? defaultTaskManager;
      this.intervalMs = intervalSeconds * 1000;
    }
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

  async runCleanup(): Promise<{ expiredFiles: number; tempFiles: number; expiredTasks: number }> {
    const expiredFiles = await this.fileStore.cleanExpiredFiles();
    const tempFiles = await this.fileStore.cleanOrphanedTempFiles();
    const expiredTasks = await this.taskManager.cleanExpiredTasks();
    return { expiredFiles, tempFiles, expiredTasks };
  }
}

export const defaultJanitor = new Janitor();
