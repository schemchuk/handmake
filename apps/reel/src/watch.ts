import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { processReel, UnreadableInputError } from './media.ts';
import { selectMusic } from './music.ts';
import { parseOptions } from './plan.ts';

type FileState = {
  name: string;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  ino: number;
  dev: number;
};
type Observation = { unchangedSince: number; closedSince?: number };
type CheckOpen = (file: string) => Promise<boolean | undefined>;
class LiveWatcherError extends Error {}
const fallbackStabilityMs = 60_000;
const unreadableGraceMs = 600_000;
type Scan = { names: Set<string>; files: Map<string, FileState> };
const exec = promisify(execFile);

function reelPaths(name: string) {
  const stem = name.slice(0, -extname(name).length);
  return { output: `${stem}-reel.mp4`, error: `${stem}.reel-error.txt` };
}

function sameFile(a: Omit<FileState, 'name'> | undefined, b: FileState) {
  return (
    a?.size === b.size &&
    a.mtimeMs === b.mtimeMs &&
    a.ctimeMs === b.ctimeMs &&
    a.ino === b.ino &&
    a.dev === b.dev
  );
}

export function selectReady(previous: Scan, current: Scan, skipSibling = false) {
  return [...current.files.values()]
    .filter((file) => {
      const { name } = file;
      if (name.startsWith('.') || !/\.(mp4|mov)$/i.test(name) || /-reel(?:-\d+)?\.mp4$/i.test(name))
        return false;
      const paths = reelPaths(name);
      if ((!skipSibling && current.names.has(paths.output)) || current.names.has(paths.error))
        return false;
      return sameFile(previous.files.get(name), file);
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
      if (!isMissing(error)) console.error(`${entry.name}: ${errorMessage(error)}`);
    });
    if (state?.isFile()) {
      const { size, mtimeMs, ctimeMs, ino, dev } = state;
      files.set(entry.name, { name: entry.name, size, mtimeMs, ctimeMs, ino, dev });
    }
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

async function removeLock(lock: string) {
  await unlink(lock).catch((error: unknown) => {
    if (!isMissing(error)) throw error;
  });
}

async function claimLock(lock: string, claim: string, dir: string, recovery = false) {
  for (;;) {
    try {
      // Publish a complete PID atomically, even when two watchers start together.
      await link(claim, lock);
      return async () => removeLock(lock);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }

    const pid = await lockOwner(lock);
    if (pid === undefined) continue;
    if (isLive(pid)) {
      if (!recovery)
        throw new LiveWatcherError(`Reel watcher already running for ${dir} (PID ${pid})`);
      await setTimeout(10);
      continue;
    }

    // Serialize stale-lock removal and recheck under the guard so it cannot
    // unlink a live replacement. A guard left by a dead process is recoverable too.
    const releaseGuard = await claimLock(`${lock}.recovery`, claim, dir, true);
    try {
      const owner = await lockOwner(lock);
      if (owner !== undefined && !isLive(owner)) await removeLock(lock);
    } finally {
      await releaseGuard();
    }
  }
}

function stateDirectory() {
  return resolve(
    process.env.XDG_RUNTIME_DIR || join(homedir(), '.local', 'state'),
    'handmake-reel',
  );
}

export function lockPath(dir: string) {
  const hash = createHash('sha256').update(resolve(dir)).digest('hex');
  return join(stateDirectory(), `${hash}.lock`);
}

export function acquireLock(dir: string) {
  return acquireFileLock(lockPath(dir), dir);
}

export async function acquireFileLock(lock: string, dir: string, wait = false) {
  const stateDir = resolve(lock, '..');
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const temp = await mkdtemp(join(stateDir, '.claim-'));
  const claim = join(temp, 'pid');
  try {
    await writeFile(claim, `${process.pid}\n`);
    return await claimLock(lock, claim, dir, wait);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

export async function notify(message: string) {
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

export async function checkFileOpen(
  file: string,
  execute: (binary: string, args: string[]) => Promise<unknown> = exec,
): ReturnType<CheckOpen> {
  try {
    await execute('fuser', ['-s', file]);
    return true;
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (Number(code) === 1) return false;
    if (code === 'ENOENT') return undefined;
    throw error;
  }
}

type WatchOptions = {
  outDir?: string;
  trashSource?: boolean;
  musicDir?: string;
};

function isCollision(error: unknown) {
  return (error as NodeJS.ErrnoException).code === 'EEXIST';
}

async function nextOutput(dir: string, name: string, start: number) {
  const stem = name.slice(0, -extname(name).length);
  for (let number = start; ; number++) {
    const suffix = number === 1 ? '' : `-${number}`;
    const path = join(dir, `${stem}-reel${suffix}.mp4`);
    if (!(await exists(path))) return { path, number };
  }
}

export async function trashSource(
  input: string,
  dir: string,
  execute: (binary: string, args: string[]) => Promise<unknown> = exec,
) {
  try {
    await execute('gio', ['trash', '--', input]);
  } catch (error) {
    if (isMissing(error) && !(await exists(input))) return;
    const archive = join(dir, 'оброблені');
    await mkdir(archive, { recursive: true });
    if (!(await lstat(archive)).isDirectory()) throw new Error(`Invalid archive: ${archive}`);
    const extension = extname(input);
    const stem = basename(input, extension);
    for (let number = 1; ; number++) {
      const suffix = number === 1 ? '' : `-${number}`;
      try {
        await link(input, join(archive, `${stem}${suffix}${extension}`));
      } catch (error) {
        if (isCollision(error)) continue;
        throw error;
      }
      await unlink(input);
      return;
    }
  }
}

export async function watchDirectory(
  dir: string,
  intervalMs: number,
  signal: AbortSignal,
  processor: (
    options: Parameters<typeof processReel>[0],
    chooseLength: typeof watchLength,
    scratchDir: string,
  ) => Promise<{ size: number; duration: number }> = processReel,
  sendNotification = notify,
  {
    checkOpen = checkFileOpen,
    now = () => performance.now(),
    outDir,
    trashSource: shouldTrash = false,
    musicDir,
    musicStateDir = join(homedir(), '.local', 'state', 'handmake-reel'),
    moveSource = trashSource,
  }: WatchOptions & {
    checkOpen?: CheckOpen;
    now?: () => number;
    musicStateDir?: string;
    moveSource?: typeof trashSource;
  } = {},
) {
  dir = resolve(dir);
  const outputDir = resolve(outDir ?? dir);
  const useSuffixes = outDir !== undefined || shouldTrash;
  const completed = new Map<string, FileState>();
  const warned = new Set<string>();
  let release: (() => Promise<void>) | undefined;
  let previous: Scan = { names: new Set(), files: new Map() };
  let observations = new Map<string, Observation>();
  let missing = false;
  let missingFuser = false;

  async function processCandidate(file: FileState, observation: Observation) {
    const { name } = file;
    const input = join(dir, name);
    const paths = reelPaths(name);
    const out = join(dir, paths.output);
    const errorFile = join(dir, paths.error);
    if (
      sameFile(completed.get(name), file) ||
      (!useSuffixes && (await exists(out))) ||
      (await exists(errorFile))
    )
      return;

    const open = missingFuser ? undefined : await checkOpen(input);
    if (open === undefined && !missingFuser) {
      missingFuser = true;
      console.error('fuser missing, using a 60-second stability window');
    }
    if (!sameFile(await lstat(input), file)) {
      observations.delete(name);
      return;
    }
    if (open) {
      delete observation.closedSince;
      return;
    }
    const checkedAt = now();
    observation.closedSince ??= checkedAt;
    if (missingFuser && checkedAt - observation.unchangedSince < fallbackStabilityMs) return;
    if (signal.aborted) return;

    let result;
    let music;
    let releaseMusic: (() => Promise<void>) | undefined;
    try {
      if (musicDir) {
        releaseMusic = await acquireFileLock(join(musicStateDir, 'music.lock'), musicDir, true);
        if (signal.aborted || !sameFile(await lstat(input), file)) return;
        music = await selectMusic(musicDir, musicStateDir, warned);
      }
      if (outDir !== undefined) await mkdir(outputDir, { recursive: true });
      let start = 1;
      for (;;) {
        const output = useSuffixes
          ? await nextOutput(outputDir, name, start)
          : { path: out, number: 1 };
        const args = [input, '--out', output.path];
        if (music) args.push('--music', music.path, '--music-only', '--music-volume', '1');
        try {
          result = await processor(parseOptions(args), watchLength, stateDirectory());
        } catch (error) {
          if (!useSuffixes || !isCollision(error)) throw error;
          start = output.number + 1;
          continue;
        }
        await music?.record(input, output.path);
        break;
      }
      if (shouldTrash) {
        if (!sameFile(await lstat(input), file)) throw new Error('Source changed during rendering');
        await moveSource(input, dir);
      } else if (useSuffixes) completed.set(name, file);
    } catch (error) {
      const message = errorMessage(error);
      if (error instanceof UnreadableInputError) {
        if (checkedAt - observation.closedSince < unreadableGraceMs) return;
        if (!missingFuser && (await checkOpen(input)) !== false) {
          delete observation.closedSince;
          return;
        }
        if (!sameFile(await lstat(input), file)) {
          observations.delete(name);
          return;
        }
      }
      delete observation.closedSince;
      await writeFile(errorFile, `${message}\n`);
      console.error(`${name}: ${message}`);
      await sendNotification(`Не вдалося обробити ${name}: ${message}`);
      return;
    } finally {
      await releaseMusic?.();
    }
    console.log(`${name}: ${result.size} bytes, ${result.duration.toFixed(2)} s`);
    const credit = music ? `, музика: ${music.track.title}` : '';
    await sendNotification(`Рілс готовий: ${name}${credit}. Прослухайте перед надсиланням.`);
  }

  try {
    while (!signal.aborted) {
      try {
        release ??= await acquireLock(dir);
        const current = await scan(dir)
          .then((snapshot) => {
            missing = false;
            return snapshot;
          })
          .catch((error: unknown) => {
            if (!isMissing(error)) throw error;
            if (!missing) console.error(`${dir}: folder missing, waiting`);
            missing = true;
            return { names: new Set<string>(), files: new Map<string, FileState>() };
          });
        const scannedAt = now();
        observations = new Map(
          [...current.files].map(([name, file]) => [
            name,
            (sameFile(previous.files.get(name), file) && observations.get(name)) || {
              unchangedSince: scannedAt,
            },
          ]),
        );
        for (const name of completed.keys()) {
          if (!current.files.has(name)) completed.delete(name);
        }
        for (const file of selectReady(previous, current, useSuffixes)) {
          if (signal.aborted) break;
          const observation = observations.get(file.name);
          if (!observation) continue;
          try {
            await processCandidate(file, observation);
          } catch (error) {
            observations.delete(file.name);
            console.error(`${file.name}: ${errorMessage(error)}`);
          }
        }
        previous = current;
      } catch (error) {
        if (error instanceof LiveWatcherError) throw error;
        previous = { names: new Set(), files: new Map() };
        observations.clear();
        console.error(`${dir}: ${errorMessage(error)}`);
      }
      await setTimeout(intervalMs, undefined, { signal }).catch((error: unknown) => {
        if (!signal.aborted) throw error;
      });
    }
  } finally {
    await release?.().catch((error: unknown) => console.error(errorMessage(error)));
  }
}

export function parseWatchOptions(args: string[]) {
  const [dir, ...flags] = args;
  const usage =
    'Usage: pnpm reel:watch <dir> [--interval <seconds>] [--out-dir <dir>] [--trash-source] [--music-dir <dir>]';
  if (!dir || dir.startsWith('--')) throw new Error(usage);
  const options: WatchOptions = {};
  const seen = new Set<string>();
  let interval = 10;
  const remaining = flags.values();
  for (const flag of remaining) {
    if (seen.has(flag)) throw new Error(usage);
    seen.add(flag);
    if (flag === '--trash-source') {
      options.trashSource = true;
      continue;
    }
    const value = remaining.next().value;
    if (!value || value.startsWith('--')) throw new Error(usage);
    switch (flag) {
      case '--interval':
        interval = Number(value);
        break;
      case '--out-dir':
        options.outDir = value;
        break;
      case '--music-dir':
        options.musicDir = value;
        break;
      default:
        throw new Error(usage);
    }
  }
  if (!Number.isFinite(interval) || interval <= 0 || interval * 1000 > 2 ** 31 - 1)
    throw new Error(usage);
  return { dir, intervalMs: interval * 1000, options };
}

async function main(args: string[]) {
  const { dir, intervalMs, options } = parseWatchOptions(args);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    await watchDirectory(dir, intervalMs, controller.signal, undefined, undefined, options);
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
