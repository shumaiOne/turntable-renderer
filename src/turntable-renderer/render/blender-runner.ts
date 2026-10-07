import { settings } from '../settings.js';

let cachedBlenderVersion: string | null = null;

/**
 * Inspects and returns the installed Blender version.
 */
export async function getBlenderVersion(
  blenderPath: string = settings.BLENDER_PATH,
): Promise<string> {
  if (cachedBlenderVersion) {
    return cachedBlenderVersion;
  }

  try {
    const proc = Bun.spawn([blenderPath, '--version'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      throw new Error(`Blender exited with code ${exitCode}`);
    }

    // Blender output format: "Blender 5.2.2 (hash ...)" or "Blender 4.5.14 (hash ...)"
    const match = stdout.match(/Blender\s+([0-9]+\.[0-9]+\.[0-9]+[a-z0-9-]*)/i);
    if (match?.[1]) {
      cachedBlenderVersion = match[1];
      return cachedBlenderVersion;
    }

    cachedBlenderVersion = stdout.split('\n')[0]?.trim() || 'unknown';
    return cachedBlenderVersion;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `unavailable (${message})`;
  }
}

export interface BlenderRunOptions {
  scriptPath: string;
  args?: string[];
  blenderPath?: string;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
  cwd?: string;
  env?: Record<string, string>;
}

export interface BlenderRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

/**
 * Spawns Blender in an isolated subprocess group with standard safety flags.
 *
 * blender -b --factory-startup --disable-autoexec -noaudio -P <script> -- <args>
 */
export async function runBlenderScript(options: BlenderRunOptions): Promise<BlenderRunResult> {
  const {
    scriptPath,
    args = [],
    blenderPath = settings.BLENDER_PATH,
    timeoutMs = settings.RENDER_TIMEOUT_SECONDS * 1000,
    abortSignal,
    cwd,
    env,
  } = options;

  const cmd = [
    blenderPath,
    '-b',
    '--factory-startup',
    '--disable-autoexec',
    '-noaudio',
    '-P',
    scriptPath,
    '--',
    ...args,
  ];

  const startTime = Date.now();

  const proc = Bun.spawn(cmd, {
    cwd,
    env: {
      ...process.env,
      ...env,
      // Ensure no GUI or interactive prompt attempts
      PYTHONUNBUFFERED: '1',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  let timedOut = false;
  let aborted = false;

  const killSubprocess = () => {
    try {
      // Send SIGKILL to the process group if possible or process itself
      if (proc.pid) {
        try {
          process.kill(-proc.pid, 'SIGKILL');
        } catch {
          proc.kill(9);
        }
      }
    } catch {
      // Process might already be dead
    }
  };

  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    killSubprocess();
  }, timeoutMs);

  const abortHandler = () => {
    aborted = true;
    killSubprocess();
  };

  if (abortSignal) {
    if (abortSignal.aborted) {
      abortHandler();
    } else {
      abortSignal.addEventListener('abort', abortHandler, { once: true });
    }
  }

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    clearTimeout(timeoutTimer);
    if (abortSignal) {
      abortSignal.removeEventListener('abort', abortHandler);
    }

    const durationMs = Date.now() - startTime;

    if (timedOut) {
      throw new Error(`Blender execution timed out after ${timeoutMs}ms`);
    }

    if (aborted) {
      throw new Error('Blender execution was aborted by client disconnect');
    }

    return {
      exitCode,
      stdout,
      stderr,
      durationMs,
    };
  } catch (error) {
    clearTimeout(timeoutTimer);
    if (abortSignal) {
      abortSignal.removeEventListener('abort', abortHandler);
    }
    throw error;
  }
}
