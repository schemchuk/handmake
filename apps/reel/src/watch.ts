import { execFile } from 'node:child_process';
import { link, lstat, mkdtemp, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { processReel } from './media.ts';
import { parseOptions } from './plan.ts';

type FileState = { name: string; size: number; mtimeMs: number };
type Scan = { names: Set<string>; files: Map<string, FileState> };
const exec = promisify(execFile);

function reelPaths(name: string) {
  const stem = name.slice(0, -extname(name).length);
  return { output: `${stem}-reel.mp4`, error: `${stem}.reel-error.txt` };
}

export function selectReady(previous: Scan, current: Scan) {
  return [...current.files.values()]
    .filter(({ name, size, mtimeMs }) => {
      if (name.startsWith('.') || !/\.(mp4|mov)$/i.test(name) || /-reel\.mp4$/i.test(name))
        return false;
      const paths = reelPaths(name);
      if (current.names.has(paths.output) || current.names.has(paths.error)) return false;
      const last = previous.files.get(name);
      return last?.size === size && last.mtimeMs === mtimeMs;
    })
    .sort((a, b) => a.mtimeMs - b.mtimeMs);
}

export function watchLength(duration: number) {
  if (!Number.isFinite(duration) || duration < 5)
    throw new Error('Input must have a valid duration of at least 5 seconds');
  return Math.min(30, Math.floor(duration));
}

function isMissing(error: unknown) {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

async function scan(dir: string): Promise<Scan> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = new Map<string, FileState>();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const state = await lstat(join(dir, entry.name)).catch((error: unknown) => {
      if (!isMissing(error)) throw error;
    });
    if (state?.isFile())
      files.set(entry.name, { name: entry.name, size: state.size, mtimeMs: state.mtimeMs });
  }
  return { names: new Set(entries.map(({ name }) => name)), files };
}

function isLive(pid: number) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid > 2 ** 31 - 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    if ((error as NodeJS.ErrnoException).code === 'EPERM') return true;
    throw error;
  }
}

async function lockOwner(lock: string) {
  try {
    const state = await lstat(lock);
    if (!state.isFile()) throw new Error(`Invalid watcher lock: ${lock}`);
    return Number(await readFile(lock, 'utf8'));
  } catch (error) {
    if (!isMissing(error)) throw error;
    return undefined;
  }
}

async function claimLock(lock: string, claim: string, dir: string, recovery = false) {
  for (;;) {
    try {
      // Publish a complete PID atomically, even when two watchers start together.
      await link(claim, lock);
      return async () => unlink(lock);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }

    const pid = await lockOwner(lock);
    if (pid === undefined) continue;
    if (isLive(pid)) {
      if (!recovery) throw new Error(`Reel watcher already running for ${dir} (PID ${pid})`);
      await setTimeout(10);
      continue;
    }

    // Serialize stale-lock removal and recheck under the guard so it cannot
    // unlink a live replacement. A guard left by a dead process is recoverable too.
    const releaseGuard = await claimLock(`${lock}.recovery`, claim, dir, true);
    try {
      const owner = await lockOwner(lock);
      if (owner !== undefined && !isLive(owner)) await unlink(lock);
    } finally {
      await releaseGuard();
    }
  }
}

export async function acquireLock(dir: string) {
  const lock = join(dir, '.reel-watch.lock');
  const temp = await mkdtemp(join(dir, '.reel-watch-'));
  const claim = join(temp, 'pid');
  try {
    await writeFile(claim, `${process.pid}\n`);
    return await claimLock(lock, claim, dir);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

async function notify(message: string) {
  try {
    await exec('notify-send', ['--', message], { timeout: 5000 });
  } catch {
    // The journal already has the result when desktop notifications are unavailable.
  }
}

async function exists(path: string) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function watchDirectory(
  dir: string,
  intervalMs: number,
  signal: AbortSignal,
  processor: (
    options: Parameters<typeof processReel>[0],
    chooseLength: typeof watchLength,
  ) => Promise<{ size: number; duration: number }> = processReel,
  sendNotification = notify,
) {
  const release = await acquireLock(dir);
  let previous: Scan = { names: new Set(), files: new Map() };
  try {
    while (!signal.aborted) {
      const current = await scan(dir);
      for (const file of selectReady(previous, current)) {
        if (signal.aborted) break;
        const name = file.name;
        const input = join(dir, name);
        const paths = reelPaths(name);
        const out = join(dir, paths.output);
        const errorFile = join(dir, paths.error);
        if ((await exists(out)) || (await exists(errorFile))) continue;
        const state = await lstat(input).catch((error: unknown) => {
          if (!isMissing(error)) throw error;
        });
        if (!state?.isFile() || state.size !== file.size || state.mtimeMs !== file.mtimeMs) {
          current.files.delete(name);
          continue;
        }
        if (signal.aborted) break;
        let result;
        try {
          result = await processor(parseOptions([input, '--out', out]), watchLength);
        } catch (error) {
          const message = errorMessage(error);
          await writeFile(errorFile, `${message}\n`);
          console.error(`${name}: ${message}`);
          await sendNotification(`Не вдалося обробити ${name}: ${message}`);
          continue;
        }
        console.log(`${name}: ${result.size} bytes, ${result.duration.toFixed(2)} s`);
        await sendNotification(`Рілс готовий: ${name}. Прослухайте перед надсиланням.`);
      }
      previous = current;
      await setTimeout(intervalMs, undefined, { signal }).catch((error: unknown) => {
        if (!signal.aborted) throw error;
      });
    }
  } finally {
    await release();
  }
}

async function main(args: string[]) {
  const [dir, flag, seconds] = args;
  const interval = Number(seconds ?? 10);
  if (
    !dir ||
    dir.startsWith('--') ||
    (args.length !== 1 && (args.length !== 3 || flag !== '--interval')) ||
    !Number.isFinite(interval) ||
    interval <= 0 ||
    interval * 1000 > 2 ** 31 - 1
  )
    throw new Error('Usage: pnpm reel:watch <dir> [--interval <seconds>]');

  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    await watchDirectory(resolve(dir), interval * 1000, controller.signal);
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(errorMessage(error));
    process.exitCode = 1;
  }
}
