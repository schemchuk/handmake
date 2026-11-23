import { execFile } from 'node:child_process';
import { createHmac } from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs as parseArgsNative, promisify } from 'node:util';
import { acquireFileLock, notify } from './watch.ts';

const dayMs = 24 * 60 * 60 * 1000;
const execute = promisify(execFile);
const tenant = 'faden-und-stimmung';

type Identity = { dev: number; ino: number; ctimeMs: number };
type Retry = Identity & { path: string; firstSkippedAt: number };
type State = { last: string; retry?: Retry[] };
type Options = { inbox: string; reels: string; statePath?: string };
type Dependencies = {
  fetch?: typeof fetch;
  now?: () => number;
  checkOpen?: (path: string) => Promise<boolean | undefined>;
  trash?: (path: string) => Promise<unknown>;
  notify?: typeof notify;
  log?: (message: string) => void;
  env?: { REEL_HANDOFF_BOT_URL?: string; REEL_HANDOFF_SECRET?: string };
};

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function isRetry(value: unknown): value is Retry {
  return (
    record(value) &&
    typeof value.path === 'string' &&
    [value.dev, value.ino, value.ctimeMs, value.firstSkippedAt].every(Number.isFinite)
  );
}

function missing(error: unknown) {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

async function statIfPresent(path: string) {
  return lstat(path).catch((error: unknown) => {
    if (!missing(error)) throw error;
  });
}

async function checkFolder(folder: string, onMissing?: () => Promise<void>) {
  let stat = await statIfPresent(folder);
  if (!stat && onMissing) {
    await onMissing();
    stat = await statIfPresent(folder);
  }
  if (!stat?.isDirectory()) throw new Error(`Invalid cleanup folder: ${folder}`);
}

async function loadState(path: string): Promise<State | undefined> {
  const raw = await readFile(path, 'utf8').catch((error: unknown) => {
    if (!missing(error)) throw error;
  });
  if (raw === undefined) return;
  const state: unknown = JSON.parse(raw);
  if (
    record(state) &&
    !('last' in state) &&
    Array.isArray(state.handled) &&
    /^[a-f0-9]{40}$/.test(typeof state.sha === 'string' ? state.sha : '')
  )
    return;
  if (
    !record(state) ||
    !isTimestamp(state.last) ||
    (state.retry !== undefined && (!Array.isArray(state.retry) || !state.retry.every(isRetry)))
  ) {
    throw new Error('Invalid cleanup state');
  }
  return { last: state.last, retry: state.retry as Retry[] | undefined };
}

async function saveState(path: string, state: State) {
  const temp = await mkdtemp(join(dirname(path), '.cleanup-'));
  try {
    const file = join(temp, 'state.json');
    await writeFile(file, JSON.stringify(state) + '\n', { mode: 0o600 });
    await rename(file, path);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

async function fetchHandoffs(
  request: typeof fetch,
  { REEL_HANDOFF_BOT_URL: botUrl, REEL_HANDOFF_SECRET: secret }: NonNullable<Dependencies['env']>,
  last: string,
  now: number,
): Promise<string[]> {
  if (!botUrl || !secret) throw new Error('Missing reel hand-off configuration');
  let url: URL;
  try {
    url = new URL('/reel/handoffs', botUrl);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
  } catch {
    throw new Error('Invalid reel hand-off bot URL');
  }
  url.search = new URLSearchParams({ tenant, since: last }).toString();
  const timestamp = String(Math.floor(now / 1000));
  const signature = createHmac('sha256', secret)
    .update(`GET\n${url.pathname}${url.search}\n${timestamp}`)
    .digest('hex');
  let response: Response;
  try {
    response = await request(url, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      headers: {
        'X-Handmake-Timestamp': timestamp,
        'X-Handmake-Signature': signature,
      },
    });
  } catch {
    throw new Error('Reel hand-off request failed');
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Reel hand-off request returned HTTP ${response.status}`);
  }
  const body: unknown = await response.json().catch(() => undefined);
  if (
    !record(body) ||
    !Array.isArray(body.handoffs) ||
    !body.handoffs.every(isTimestamp) ||
    !body.handoffs.every(
      (time, index, times) => time > last && (index === 0 || time >= times[index - 1]!),
    )
  ) {
    throw new Error('Invalid reel hand-off response');
  }
  return body.handoffs;
}

export async function checkCleanupFileOpen(
  path: string,
  listHolders: (file: string) => Promise<{ stdout: string }> = (file) =>
    execute('fuser', ['-v', resolve(file)], { timeout: 15_000 }),
  readExecutable = (pid: string) => readlink(`/proc/${pid}/exe`),
): Promise<boolean | undefined> {
  let stdout: string;
  try {
    ({ stdout } = await listHolders(path));
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { code: string | number; stderr?: string };
    if (Number(failure.code) === 1 && failure.stderr === '') return false;
    return undefined;
  }
  // fuser prints PIDs to stdout. Its verbose command names can be truncated.
  const pids = stdout.trim().split(/\s+/);
  if (!pids.every((pid) => /^[1-9]\d*$/.test(pid))) return undefined;
  for (const pid of pids) {
    const executable = await readExecutable(pid).catch(() => undefined);
    if (executable === undefined || basename(executable) !== 'xdg-document-portal') return true;
  }
  return false;
}

function fileCount(count: number) {
  const lastDigit = count % 10;
  const lastTwo = count % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return `${count} файлів`;
  if (lastDigit === 1) return `${count} файл`;
  if (lastDigit >= 2 && lastDigit <= 4) return `${count} файли`;
  return `${count} файлів`;
}

async function regularNames(folder: string) {
  const entries = await readdir(folder, { withFileTypes: true });
  return new Set(
    entries
      .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
      .map((entry) => entry.name),
  );
}

async function regularStat(path: string) {
  const stat = await statIfPresent(path);
  if (stat?.isFile()) return stat;
}

function sameFile(before: Identity, after: Identity | undefined) {
  return after?.dev === before.dev && after.ino === before.ino && after.ctimeMs === before.ctimeMs;
}

async function cleanupCandidates(inbox: string, reels: string) {
  const [inputs, outputs] = await Promise.all([regularNames(inbox), regularNames(reels)]);
  const reelStems = new Set<string>();
  for (const name of outputs) {
    const match = /^(.*)-reel(?:-\d+)?\.mp4$/.exec(name);
    if (match) reelStems.add(match[1]!);
  }
  const eligibleInputs = [...inputs].filter((name) => {
    const stem = basename(name, extname(name));
    return (
      !/\.(mov|mp4)$/i.test(name) || reelStems.has(stem) || inputs.has(`${stem}.reel-error.txt`)
    );
  });
  // Process inbox files before removing their completion evidence.
  return [
    ...eligibleInputs.map((name) => join(inbox, name)),
    ...(inbox === reels ? [] : [...outputs].map((name) => join(reels, name))),
  ];
}

export async function runCleanup(
  { inbox, reels, statePath = join(homedir(), '.local/state/handmake-reel/cleanup.json') }: Options,
  {
    fetch: request = fetch,
    now = Date.now,
    checkOpen = checkCleanupFileOpen,
    trash = (path) => execute('gio', ['trash', '--', path], { timeout: 15_000 }),
    notify: sendNotification = notify,
    log = console.error,
    env = {
      REEL_HANDOFF_BOT_URL: process.env.REEL_HANDOFF_BOT_URL,
      REEL_HANDOFF_SECRET: process.env.REEL_HANDOFF_SECRET,
    },
  }: Dependencies = {},
) {
  let release: (() => Promise<void>) | undefined;
  let count = 0;
  try {
    const folders = new Set([resolve(inbox), resolve(reels)]);
    release = await acquireFileLock(`${statePath}.lock`, statePath);
    for (const folder of folders) {
      await checkFolder(folder, async () => {
        const created = await mkdir(folder, { recursive: true, mode: 0o755 });
        if (created !== undefined) log(`Reel cleanup: recreated folder ${folder}`);
      });
    }
    const previous = await loadState(statePath);
    const runAt = now();
    const last = previous?.last ?? new Date(runAt).toISOString();
    const handoffs = await fetchHandoffs(request, env, last, runAt);
    if (!previous) {
      await saveState(statePath, { last });
      return;
    }
    if (!handoffs.length && !previous.retry?.length) return;

    const retry: Retry[] = [];
    const attempted = new Map<string, Identity>();
    async function clean(path: string, before: Identity, firstSkippedAt: number) {
      if (!folders.has(dirname(path)) || path !== resolve(path)) return;
      attempted.set(path, before);
      if ((await checkOpen(path)) !== false) {
        const { dev, ino, ctimeMs } = before;
        retry.push({ path, dev, ino, ctimeMs, firstSkippedAt });
        return;
      }
      for (const folder of folders) await checkFolder(folder);
      if (!sameFile(before, await regularStat(path))) return;
      await trash(path);
      count++;
    }

    // Capture completion evidence before any of these files are moved.
    const candidates = new Set(
      handoffs.length ? await cleanupCandidates(resolve(inbox), resolve(reels)) : [],
    );
    for (const entry of previous.retry ?? []) {
      if (!folders.has(dirname(entry.path)) || basename(entry.path).startsWith('.')) continue;
      if (!sameFile(entry, await regularStat(entry.path))) continue;
      if (runAt - entry.firstSkippedAt >= dayMs) {
        attempted.set(entry.path, entry);
        log('Reel cleanup: left an open file after 24 hours');
        continue;
      }
      await clean(entry.path, entry, entry.firstSkippedAt);
    }

    for (const handoff of handoffs) {
      const cutoff = Date.parse(handoff);
      for (const path of candidates) {
        const stat = await regularStat(path);
        if (stat && stat.ctimeMs >= cutoff) continue;
        candidates.delete(path);
        if (!stat) continue;
        const prior = attempted.get(path);
        if (prior && sameFile(prior, stat)) continue;
        await clean(path, stat, runAt);
      }
    }
    await saveState(statePath, {
      last: handoffs.at(-1) ?? last,
      ...(retry.length ? { retry } : {}),
    });
  } catch (error) {
    log(`Reel cleanup: ${String(error).replace(/\s+/g, ' ')}`);
  } finally {
    if (count) {
      await sendNotification(`Робота в черзі: прибрано ${fileCount(count)}.`).catch(() =>
        log('Reel cleanup: desktop notification failed'),
      );
    }
    await release?.().catch((error: unknown) => log(`Reel cleanup lock: ${String(error)}`));
  }
}

function parseArgs(args: string[]): Options {
  const { values, positionals } = parseArgsNative({
    args,
    options: { inbox: { type: 'string' }, reels: { type: 'string' } },
  });
  if (positionals.length || !values.inbox || !values.reels)
    throw new Error('Usage: node apps/reel/src/cleanup.ts --inbox <dir> --reels <dir>');
  return { inbox: values.inbox, reels: values.reels };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await runCleanup(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(String(error));
    process.exitCode = 1;
  }
}
