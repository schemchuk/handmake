import { execFile } from 'node:child_process';
import {
  lstat,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs as parseArgsNative, promisify } from 'node:util';
import { acquireFileLock, notify } from './watch.ts';

const api = 'https://api.github.com/repos/schemchuk/handmake';
const site = 'https://fadenundstimmung.de';
const dayMs = 24 * 60 * 60 * 1000;
const execute = promisify(execFile);
const safeSegment = /^[a-z0-9][a-z0-9._-]*$/i;
const commitSha = /^[a-f0-9]{40}$/;

type Work = { id: string; date: number; video?: string };
type CleanupRetry = Work & { firstSkippedAt: number };
type State = {
  sha: string;
  etag?: string;
  handled: string[];
  waitingForSite: Work[];
  waitingForCleanup?: CleanupRetry[];
};
type Options = { inbox: string; reels: string; statePath?: string };
type Dependencies = {
  fetch?: typeof fetch;
  now?: () => number;
  checkOpen?: (path: string) => Promise<boolean | undefined>;
  trash?: (path: string) => Promise<unknown>;
  notify?: typeof notify;
  log?: (message: string) => void;
};

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isSegment(value: unknown): value is string {
  return typeof value === 'string' && safeSegment.test(value);
}

function isSha(value: unknown): value is string {
  return typeof value === 'string' && commitSha.test(value);
}

function isWork(value: unknown): value is Work {
  return (
    record(value) &&
    isSegment(value.id) &&
    typeof value.date === 'number' &&
    Number.isFinite(value.date) &&
    (value.video === undefined || isSegment(value.video))
  );
}

function missing(error: unknown) {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function isCleanupRetry(value: unknown): value is CleanupRetry {
  return (
    record(value) &&
    typeof value.firstSkippedAt === 'number' &&
    Number.isFinite(value.firstSkippedAt) &&
    isWork(value)
  );
}

async function loadState(path: string): Promise<State | undefined> {
  const raw = await readFile(path, 'utf8').catch((error: unknown) => {
    if (!missing(error)) throw error;
  });
  if (raw === undefined) return;
  const state: unknown = JSON.parse(raw);
  if (
    !record(state) ||
    !isSha(state.sha) ||
    (state.etag !== undefined && typeof state.etag !== 'string') ||
    !Array.isArray(state.handled) ||
    !state.handled.every(isSegment) ||
    !Array.isArray(state.waitingForSite) ||
    !state.waitingForSite.every(isWork) ||
    (state.waitingForCleanup !== undefined &&
      (!Array.isArray(state.waitingForCleanup) || !state.waitingForCleanup.every(isCleanupRetry)))
  ) {
    throw new Error('Invalid cleanup state');
  }
  return state as State;
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

// Read only the fields emitted by the work front matter serializer.
function readWork(id: string, markdown: string): Work {
  const front = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(markdown)?.[1];
  const dateField = /^date:[ \t]*(.+)$/m.exec(front ?? '')?.[1]?.trim();
  const date = Date.parse(dateField?.replace(/^(['"])(.*)\1$/, '$2') ?? '');
  if (!front || !Number.isFinite(date)) throw new Error(`Invalid front matter for ${id}`);
  const videoField = /^video:([^\r\n]*)(?:\r?\n)((?:[ \t]+[^\r\n]*\r?\n?)*)/m.exec(front + '\n');
  if (!videoField) return { id, date };
  const video = /^[ \t]+fileName:[ \t]*(.+)$/m
    .exec(videoField[2] ?? '')?.[1]
    ?.trim()
    .replace(/^(['"])(.*)\1$/, '$2');
  if (videoField[1]?.trim() || !isSegment(video)) throw new Error(`Invalid video for ${id}`);
  return { id, date, video };
}

function ledgerStatus(value: unknown, path: string) {
  if (!record(value) || !record(value.channels)) throw new Error(`Invalid ledger: ${path}`);
  const statuses = Object.values(value.channels).map((channel) =>
    record(channel) ? channel.status : undefined,
  );
  if (!statuses.length || !statuses.every((status) => typeof status === 'string')) {
    throw new Error(`Invalid ledger channels: ${path}`);
  }
  if (statuses.some((status) => status !== 'done' && status !== 'pending')) return 'failed';
  return statuses.every((status) => status === 'done') ? 'done' : 'pending';
}

async function requireOk(response: Response, target: string) {
  if (response.ok) return;
  await response.body?.cancel();
  throw new Error(`${target}: HTTP ${response.status}`);
}

async function discover(
  request: typeof fetch,
  sha: string,
  handled: Set<string>,
  baseline: number | undefined,
  retries: CleanupRetry[],
) {
  const get = async (path: string, accept: string, optional = false) => {
    const response = await request(`${api}/contents/${path}?ref=${sha}`, {
      headers: { Accept: accept },
    });
    if (optional && response.status === 404) {
      await response.body?.cancel();
      return;
    }
    await requireOk(response, path);
    return response;
  };
  const jsonType = 'application/vnd.github+json';
  const rawType = 'application/vnd.github.raw+json';
  const listing = await get('content/works', jsonType);
  const entries: unknown = await listing?.json();
  if (
    !Array.isArray(entries) ||
    !entries.every(
      (entry) => record(entry) && typeof entry.type === 'string' && isSegment(entry.name),
    )
  ) {
    throw new Error('Invalid works directory listing');
  }

  const candidates: Work[] = [];
  const failed: string[] = [];
  const retryIds = new Set(retries.map(({ id }) => id));
  for (const { name: id, type } of entries) {
    if (type !== 'dir' || handled.has(id) || retryIds.has(id)) continue;
    const index = await get(`content/works/${id}/index.md`, rawType, true);
    if (!index) continue;
    const work = readWork(id, await index.text());
    if (baseline !== undefined && work.date < baseline) {
      handled.add(id);
      continue;
    }
    const paths = [`content/ledger/${id}.json`];
    if (work.video) paths.push(`content/ledger/${id}-video.json`);
    const statuses = [];
    for (const path of paths) {
      const ledger = await get(path, rawType, true);
      statuses.push(ledger ? ledgerStatus(await ledger.json(), path) : 'pending');
    }
    if (statuses.includes('failed')) failed.push(id);
    else if (statuses.every((status) => status === 'done')) candidates.push(work);
  }
  return { candidates, failed };
}

async function siteReady(request: typeof fetch, { id, video }: Work) {
  const key = id.toLowerCase();
  const path = video ? `/work-media/${key}/${encodeURIComponent(video)}` : `/works/${key}/`;
  const response = await request(site + path, {
    redirect: 'error',
    headers: video ? { Range: 'bytes=0-0' } : {},
  });
  if (response.status !== 404) await requireOk(response, path);
  await response.body?.cancel();
  return response.ok;
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

async function trashOlder(
  folders: string[],
  date: number,
  checkOpen: NonNullable<Dependencies['checkOpen']>,
  trash: (path: string) => Promise<unknown>,
) {
  let count = 0;
  let skipped = false;
  for (const folder of folders) {
    const entries = await readdir(folder, { withFileTypes: true }).catch((error: unknown) => {
      if (!missing(error)) throw error;
      return [];
    });
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith('.')) continue;
      const path = join(folder, entry.name);
      const stat = () =>
        lstat(path).catch((error: unknown) => {
          if (!missing(error)) throw error;
        });
      const before = await stat();
      if (!before?.isFile() || before.mtimeMs >= date) continue;
      if ((await checkOpen(path)) !== false) {
        skipped = true;
        continue;
      }
      const after = await stat();
      if (!after?.isFile() || after.mtimeMs >= date) continue;
      if (
        after.dev !== before.dev ||
        after.ino !== before.ino ||
        after.ctimeMs !== before.ctimeMs ||
        after.mtimeMs !== before.mtimeMs
      ) {
        skipped = true;
        continue;
      }
      await trash(path);
      count++;
    }
  }
  return { count, skipped };
}

export async function runCleanup(
  { inbox, reels, statePath = join(homedir(), '.local/state/handmake-reel/cleanup.json') }: Options,
  {
    fetch: fetchImpl = fetch,
    now = Date.now,
    checkOpen = checkCleanupFileOpen,
    trash = (path) => execute('gio', ['trash', '--', path], { timeout: 15_000 }),
    notify: sendNotification = notify,
    log = console.error,
  }: Dependencies = {},
) {
  const request: typeof fetch = (url, init) =>
    fetchImpl(url, { ...init, signal: AbortSignal.timeout(15_000) });
  let release: (() => Promise<void>) | undefined;
  try {
    release = await acquireFileLock(`${statePath}.lock`, statePath);
    const previous = await loadState(statePath);
    const main = await request(`${api}/commits/main`, {
      headers: {
        Accept: 'application/vnd.github+json',
        ...(previous?.etag ? { 'If-None-Match': previous.etag } : {}),
      },
    });
    let sha: string;
    let etag = previous?.etag;
    if (main.status === 304 && previous) {
      sha = previous.sha;
    } else {
      await requireOk(main, 'main commit');
      const commit: unknown = await main.json();
      if (!record(commit) || !isSha(commit.sha)) throw new Error('Invalid main commit SHA');
      sha = commit.sha;
      etag = main.headers.get('etag') ?? undefined;
    }
    const changed = sha !== previous?.sha;
    const retries = previous?.waitingForCleanup ?? [];
    if (!changed && !previous?.waitingForSite.length && !retries.length && etag === previous?.etag)
      return;
    const handled = new Set(previous?.handled);
    const runAt = now();
    const { candidates, failed } = changed
      ? await discover(request, sha, handled, previous ? undefined : runAt - dayMs, retries)
      : { candidates: previous!.waitingForSite, failed: [] };

    // Complete all remote checks before touching either folder.
    const waitingForSite: Work[] = [];
    const ready: (Work & { firstSkippedAt?: number })[] = [...retries];
    for (const work of candidates) {
      if (await siteReady(request, work)) ready.push(work);
      else waitingForSite.push(work);
    }

    const messages = [];
    const waitingForCleanup: CleanupRetry[] = [];
    const expired: string[] = [];
    const folders = [...new Set([resolve(inbox), resolve(reels)])];
    for (const work of ready.sort((a, b) => a.date - b.date)) {
      const firstSkippedAt = work.firstSkippedAt ?? runAt;
      if (runAt - firstSkippedAt >= dayMs) {
        handled.add(work.id);
        expired.push(work.id);
        continue;
      }
      const { count, skipped } = await trashOlder(folders, work.date, checkOpen, trash);
      if (skipped) waitingForCleanup.push({ ...work, firstSkippedAt });
      else handled.add(work.id);
      if (count) messages.push(`Робота ${work.id} опублікована: прибрано ${fileCount(count)}.`);
    }
    for (const id of failed) {
      handled.add(id);
      messages.push(`Публікація ${id} з помилкою, папки не чищу`);
    }
    await saveState(statePath, {
      sha,
      etag,
      handled: [...handled],
      waitingForSite,
      waitingForCleanup,
    });
    for (const id of expired) log(`Reel cleanup: gave up on ${id} after 24 hours`);
    for (const message of messages) await sendNotification(message);
  } catch (error) {
    log(`Reel cleanup: ${String(error).replace(/\s+/g, ' ')}`);
  } finally {
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
