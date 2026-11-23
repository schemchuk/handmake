import { createHmac } from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  unlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { checkCleanupFileOpen, runCleanup } from '../src/cleanup.ts';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>();
  const { promisify } = await import('node:util');
  return { ...original, execFile: Object.assign(vi.fn(), { [promisify.custom]: execute }) };
});

const dayMs = 86_400_000;
const iso = (time: number) => new Date(time).toISOString();
const env = { REEL_HANDOFF_BOT_URL: 'https://bot.example.test', REEL_HANDOFF_SECRET: 'test-only' };
let dir: string;
let inbox: string;
let reels: string;
let statePath: string;
let last: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'reel-cleanup-'));
  inbox = join(dir, 'inbox');
  reels = join(dir, 'reels');
  statePath = join(dir, 'cleanup.json');
  last = iso(Date.now() - dayMs);
  await Promise.all([mkdir(inbox), mkdir(reels), writeFile(statePath, JSON.stringify({ last }))]);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  vi.clearAllMocks();
});

async function put(folder: string, name: string) {
  const path = join(folder, name);
  await writeFile(path, 'test');
  return path;
}

async function state() {
  return JSON.parse(await readFile(statePath, 'utf8'));
}

function fixture(handoffs: string[] = []) {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async () => Response.json({ handoffs }));
  const now = vi.fn(() => Date.now() + 1000);
  const trash = vi.fn((path: string) => unlink(path));
  const checkOpen = vi.fn<(path: string) => Promise<boolean | undefined>>(async () => false);
  const notify = vi.fn(async () => {});
  const log = vi.fn();
  const run = () =>
    runCleanup({ inbox, reels, statePath }, { fetch, now, trash, checkOpen, notify, log, env });
  return { run, fetch, now, trash, checkOpen, notify, log };
}

it('uses ctime in both folders, skips hidden and non-regular entries, and notifies once for multiple hand-offs', async () => {
  const image = await put(inbox, 'photo.jpg');
  const reel = await put(reels, 'work-reel.mp4');
  await put(reels, '.hidden');
  await mkdir(join(reels, 'nested'));
  await put(join(reels, 'nested'), 'saved.mp4');
  await symlink(image, join(inbox, 'link.jpg'));
  const newer = await put(reels, 'new.mp4');
  await Promise.all([image, reel, newer].map((path) => utimes(path, 1, 1)));
  const cutoff = Math.ceil(Math.max((await lstat(image)).ctimeMs, (await lstat(reel)).ctimeMs)) + 2;
  await vi.waitFor(() => expect(Date.now()).toBeGreaterThan(cutoff + 1));
  await utimes(newer, 1, 1);
  const f = fixture([iso(cutoff), iso(cutoff + 1)]);
  await f.run();
  expect(f.trash.mock.calls).toEqual([[image], [reel]]);
  expect(f.trash.mock.calls.map(([path]) => dirname(path))).toEqual([inbox, reels]);
  expect((await lstat(join(reels, 'nested'))).isDirectory()).toBe(true);
  await expect(readFile(join(reels, 'nested', 'saved.mp4'), 'utf8')).resolves.toBe('test');
  expect((await lstat(join(inbox, 'link.jpg'))).isSymbolicLink()).toBe(true);
  expect((await lstat(newer)).mtimeMs).toBe(1000);
  expect(f.notify).toHaveBeenCalledExactlyOnceWith('Робота в черзі: прибрано 2 файли.');
  expect(await state()).toEqual({ last: iso(cutoff + 1) });
});

it('recreates a missing folder with its parents and logs it on an idle run', async () => {
  await rm(reels, { recursive: true });
  reels = join(reels, 'output');
  const f = fixture();
  await f.run();
  expect((await lstat(reels)).isDirectory()).toBe(true);
  expect(f.log).toHaveBeenCalledExactlyOnceWith(`Reel cleanup: recreated folder ${reels}`);
  expect(f.fetch).toHaveBeenCalledTimes(1);
  expect(f.trash).not.toHaveBeenCalled();
  await f.run();
  expect(f.log).toHaveBeenCalledTimes(1);
});

it.each(['symlink', 'file'])('trashes nothing when a configured folder is a %s', async (kind) => {
  const input = await put(inbox, 'photo.jpg');
  const outside = await put(dir, 'outside.mp4');
  await rm(reels, { recursive: true });
  if (kind === 'symlink') await symlink(dir, reels);
  else await writeFile(reels, 'keep');
  const f = fixture([iso(Date.now() + 100)]);
  await f.run();
  expect(f.trash).not.toHaveBeenCalled();
  expect(f.log).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('Invalid cleanup folder'));
  await expect(readFile(input, 'utf8')).resolves.toBe('test');
  await expect(readFile(outside, 'utf8')).resolves.toBe('test');
  expect(await state()).toEqual({ last });
});

it('retries only regular files with an exact configured parent', async () => {
  const nested = join(reels, 'nested');
  await mkdir(nested);
  const direct = await put(reels, 'direct.mp4');
  const paths = [direct, await put(nested, 'nested.mp4'), await put(dir, 'outside.mp4')];
  const firstSkippedAt = Date.now();
  const retry = await Promise.all(
    paths.map(async (path) => {
      const { dev, ino, ctimeMs } = await lstat(path);
      return { path, dev, ino, ctimeMs, firstSkippedAt };
    }),
  );
  await writeFile(statePath, JSON.stringify({ last, retry }));
  const f = fixture();
  await f.run();
  expect(f.trash.mock.calls).toEqual([[direct]]);
  expect(await state()).toEqual({ last });
});

it('stops if a folder becomes a symlink during the open-file check', async () => {
  const path = await put(inbox, 'photo.jpg');
  const moved = join(dir, 'moved');
  const f = fixture([iso(Date.now() + 100)]);
  f.checkOpen.mockImplementationOnce(async () => {
    await rename(inbox, moved);
    await symlink(moved, inbox);
    return false;
  });
  await f.run();
  expect(f.trash).not.toHaveBeenCalled();
  await expect(readFile(path, 'utf8')).resolves.toBe('test');
  expect(await state()).toEqual({ last });
});

it('keeps unprocessed videos and accepts numbered reels and watcher errors', async () => {
  await put(inbox, 'unfinished.MOV');
  await put(reels, 'unfinished-other-reel.mp4');
  const finished = await put(inbox, 'finished.MP4');
  const output = await put(reels, 'finished-reel-2.mp4');
  const failed = await put(inbox, 'failed.mov');
  const marker = await put(inbox, 'failed.reel-error.txt');
  const f = fixture([iso(Date.now() + 100)]);
  await f.run();
  expect(f.trash.mock.calls.flat().sort()).toEqual(
    [finished, output, failed, marker, join(reels, 'unfinished-other-reel.mp4')].sort(),
  );
  await expect(lstat(join(inbox, 'unfinished.MOV'))).resolves.toBeDefined();
});

it('signs the exact requested path and query and does no cleanup on an idle run', async () => {
  await put(reels, 'old.mp4');
  const f = fixture();
  await f.run();
  expect(f.fetch).toHaveBeenCalledTimes(1);
  const [target, init] = f.fetch.mock.calls[0]!;
  const url = new URL(String(target));
  expect(url.origin + url.pathname).toBe(env.REEL_HANDOFF_BOT_URL + '/reel/handoffs');
  expect(Object.fromEntries(url.searchParams)).toEqual({
    tenant: 'faden-und-stimmung',
    since: last,
  });
  expect(init?.method).toBe('GET');
  expect(init?.redirect).toBe('error');
  const headers = new Headers(init?.headers);
  const timestamp = String(Math.floor(f.now.mock.results[0]!.value / 1000));
  expect(headers.get('X-Handmake-Timestamp')).toBe(timestamp);
  expect(headers.get('X-Handmake-Signature')).toBe(
    createHmac('sha256', env.REEL_HANDOFF_SECRET)
      .update(`GET\n${url.pathname}${url.search}\n${timestamp}`)
      .digest('hex'),
  );
  expect(f.checkOpen).not.toHaveBeenCalled();
  expect(f.trash).not.toHaveBeenCalled();
  expect(f.notify).not.toHaveBeenCalled();
  expect(await state()).toEqual({ last });
});

it.each(['missing', 'legacy'])('establishes a baseline for %s state', async (kind) => {
  if (kind === 'missing') await unlink(statePath);
  else
    await writeFile(
      statePath,
      JSON.stringify({ sha: 'a'.repeat(40), handled: [], waitingForSite: [] }),
    );
  await put(reels, 'old.mp4');
  const baseline = Date.now() + 100;
  const f = fixture([iso(baseline + 1)]);
  f.now.mockReturnValue(baseline);
  await f.run();
  expect(f.fetch).toHaveBeenCalledTimes(1);
  expect(f.trash).not.toHaveBeenCalled();
  expect(await state()).toEqual({ last: iso(baseline) });
});

it.each(['network', '401', '503', 'bad JSON', 'invalid times'])(
  'leaves state and files alone on %s',
  async (failure) => {
    const path = await put(reels, 'old.mp4');
    const f = fixture([iso(Date.now() + 100)]);
    f.checkOpen.mockResolvedValueOnce(true);
    await f.run();
    const before = await readFile(statePath, 'utf8');
    if (failure === 'network') f.fetch.mockRejectedValueOnce(new Error(env.REEL_HANDOFF_SECRET));
    else if (failure === 'bad JSON') f.fetch.mockResolvedValueOnce(new Response('{'));
    else if (failure === 'invalid times')
      f.fetch.mockResolvedValueOnce(Response.json({ handoffs: [iso(Date.now() + 500), 'bad'] }));
    else f.fetch.mockResolvedValueOnce(new Response(null, { status: Number(failure) }));
    await f.run();
    expect(f.log).toHaveBeenCalledTimes(1);
    expect(f.log.mock.calls[0]![0]).not.toContain(env.REEL_HANDOFF_SECRET);
    expect(f.trash).not.toHaveBeenCalled();
    await expect(lstat(path)).resolves.toBeDefined();
    expect(await readFile(statePath, 'utf8')).toBe(before);
  },
);

it('retries a skipped inbox video even after moving its matching reel', async () => {
  const input = await put(inbox, 'work.mov');
  const output = await put(reels, 'work-reel.mp4');
  const cutoff = iso(Date.now() + 100);
  const f = fixture([cutoff]);
  f.checkOpen.mockResolvedValueOnce(true);
  await f.run();
  expect(f.trash.mock.calls).toEqual([[output]]);
  expect(await state()).toMatchObject({ last: cutoff, retry: [{ path: input }] });
  f.fetch.mockResolvedValueOnce(Response.json({ handoffs: [] }));
  await f.run();
  expect(f.trash.mock.calls).toEqual([[output], [input]]);
  expect(f.notify).toHaveBeenLastCalledWith('Робота в черзі: прибрано 1 файл.');
  expect(await state()).toEqual({ last: cutoff });
});

it('logs and leaves a skipped file at the 24-hour limit', async () => {
  const path = await put(reels, 'work-reel.mp4');
  const runAt = Date.now() + 100;
  const cutoff = iso(runAt);
  const f = fixture([cutoff]);
  f.now.mockReturnValue(runAt);
  f.checkOpen.mockResolvedValueOnce(undefined);
  await f.run();
  f.fetch.mockResolvedValueOnce(Response.json({ handoffs: [iso(runAt + 1)] }));
  f.now.mockReturnValue(runAt + dayMs);
  await f.run();
  expect(f.checkOpen).toHaveBeenCalledTimes(1);
  expect(f.trash).not.toHaveBeenCalled();
  expect(f.log).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('24 hours'));
  await expect(lstat(path)).resolves.toBeDefined();
  expect(await state()).toEqual({ last: iso(runAt + 1) });
});

it('does not retry a replaced file at the same path', async () => {
  const path = await put(reels, 'work-reel.mp4');
  const cutoff = Date.now() + 100;
  const f = fixture([iso(cutoff)]);
  f.checkOpen.mockResolvedValueOnce(true);
  await f.run();
  await rename(path, join(dir, 'original.mp4'));
  await put(reels, 'work-reel.mp4');
  f.fetch.mockResolvedValueOnce(Response.json({ handoffs: [] }));
  await f.run();
  expect(f.trash).not.toHaveBeenCalled();
  expect(await state()).toEqual({ last: iso(cutoff) });
});

it('passes the absolute file path to fuser as its only operand', async () => {
  execute.mockRejectedValueOnce({ code: 1, stdout: '', stderr: '' });
  expect(await checkCleanupFileOpen('-open.mov')).toBe(false);
  expect(execute).toHaveBeenCalledExactlyOnceWith('fuser', ['-v', resolve('-open.mov')], {
    timeout: 15_000,
  });
});

it.each([
  ['101', false],
  ['202', true],
  ['101 202', true],
  ['303', true],
] as const)('checks executable names for fuser PIDs %s', async (stdout, open) => {
  const listHolders = async () => ({ stdout, stderr: 'truncated command names' });
  const readExecutable = async (pid: string) => {
    if (pid === '303') throw new Error('Executable unavailable');
    return pid === '101' ? '/usr/libexec/xdg-document-portal' : '/usr/bin/editor';
  };
  expect(await checkCleanupFileOpen('open.mov', listHolders, readExecutable)).toBe(open);
});
