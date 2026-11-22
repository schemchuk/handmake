import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { checkCleanupFileOpen, runCleanup } from '../src/cleanup.ts';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>();
  const { promisify } = await import('node:util');
  return { ...original, execFile: Object.assign(vi.fn(), { [promisify.custom]: execute }) };
});

const id = 'WORK-1';
const date = Date.parse('2026-11-22T09:00:00.000Z');
const now = () => date + 1000;
const sha = 'a'.repeat(40);
let dir: string;
let inbox: string;
let reels: string;
let statePath: string;
const listing = 'content/works';
const index = `${listing}/${id}/index.md`;
const ledger = `content/ledger/${id}.json`;
const videoLedger = `content/ledger/${id}-video.json`;
const page = '/works/work-1/';
const video = '/work-media/work-1/video.mp4';

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'reel-cleanup-test-'));
  inbox = join(dir, 'inbox');
  reels = join(dir, 'ready reels');
  statePath = join(dir, 'state', 'cleanup.json');
  await Promise.all([mkdir(inbox), mkdir(reels)]);
});
afterEach(async () => rm(dir, { recursive: true, force: true }));

function frontMatter(hasVideo = false, submitted = date) {
  return `---\ndate: ${new Date(submitted).toISOString()}\n${hasVideo ? 'video:\n  fileName: video.mp4\n' : ''}---\n`;
}

const statuses = (...values: string[]) =>
  JSON.stringify({ channels: Object.fromEntries(values.map((status, n) => [n, { status }])) });

function fixture() {
  const resources = new Map<string, string | number>([
    [listing, JSON.stringify([{ name: id, type: 'dir' }])],
    [index, frontMatter()],
    [ledger, statuses('done', 'done')],
    [page, 200],
    [video, 206],
  ]);
  let commit = new Response(JSON.stringify({ sha }), { headers: { ETag: '"main-1"' } });
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/commits/main')) return commit.clone();
    const path = url.pathname.split('/contents/')[1] ?? url.pathname;
    if (url.hostname === 'api.github.com')
      expect(url.searchParams.get('ref')).toMatch(/^[ab]{40}$/);
    if (path === video) expect(new Headers(init?.headers).get('range')).toBe('bytes=0-0');
    const value = resources.get(path) ?? 404;
    return typeof value === 'number' ? new Response(null, { status: value }) : new Response(value);
  });
  const trash = vi.fn(unlink);
  const notify = vi.fn(async (_message: string) => {});
  const log = vi.fn();
  const checkOpen = vi.fn(async (file: string) => basename(file) === 'open.mov');
  return {
    resources,
    fetch,
    trash,
    notify,
    log,
    checkOpen,
    setCommit(response: Response) {
      commit = response;
    },
    run: (clock = now) =>
      runCleanup({ inbox, reels, statePath }, { fetch, now: clock, trash, notify, log, checkOpen }),
  };
}

async function put(folder: string, file: string, mtime = date - 1000) {
  const path = join(folder, file);
  await writeFile(path, 'fixture');
  await utimes(path, new Date(mtime), new Date(mtime));
  return path;
}

it('trashes only older closed regular files in both folders and handles the work once', async () => {
  const f = fixture();
  const a = await put(inbox, 'older.mov');
  const b = await put(reels, 'older.mp4');
  await put(inbox, 'equal.mov', date);
  await put(reels, 'newer.mp4', date + 1000);
  await put(reels, '.hidden');
  await mkdir(join(reels, 'nested'));
  const child = await put(join(reels, 'nested'), 'child.mp4');
  await symlink(child, join(inbox, 'link.mov'));
  await f.run();
  expect(f.trash.mock.calls).toEqual([[a], [b]]);
  expect(f.notify).toHaveBeenCalledExactlyOnceWith(`Робота ${id} опублікована: прибрано 2 файли.`);
  expect((await readdir(inbox)).sort()).toEqual(['equal.mov', 'link.mov']);
  expect((await readdir(reels)).sort()).toEqual(['.hidden', 'nested', 'newer.mp4']);
  f.setCommit(new Response(JSON.stringify({ sha: 'b'.repeat(40) })));
  f.fetch.mockClear();
  await put(inbox, 'still-older.mov');
  await f.run();
  expect(f.fetch).toHaveBeenCalledTimes(2);
  expect(f.trash).toHaveBeenCalledTimes(2);
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

it.each(['gone', 'closed'])(
  'retries on unchanged main until the skipped file is %s',
  async (end) => {
    const f = fixture();
    const open = await put(inbox, 'open.mov');
    const closed = await put(reels, 'closed.mp4');
    await f.run();
    expect(f.trash.mock.calls).toEqual([[closed]]);
    expect(JSON.parse(await readFile(statePath, 'utf8'))).toMatchObject({
      handled: [],
      waitingForCleanup: [{ id, date, firstSkippedAt: now() }],
    });

    f.setCommit(new Response(null, { status: 304 }));
    f.fetch.mockClear();
    await f.run();
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.trash.mock.calls).toEqual([[closed]]);

    if (end === 'gone') await unlink(open);
    else f.checkOpen.mockResolvedValue(false);
    f.fetch.mockClear();
    await f.run();
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.trash.mock.calls).toEqual(end === 'gone' ? [[closed]] : [[closed], [open]]);
    expect(JSON.parse(await readFile(statePath, 'utf8'))).toMatchObject({
      handled: [id],
      waitingForCleanup: [],
    });
  },
);

it('keeps the original retry deadline across a new SHA and gives up once after 24 hours', async () => {
  const f = fixture();
  await put(inbox, 'open.mov');
  await f.run();
  f.setCommit(new Response(JSON.stringify({ sha: 'b'.repeat(40) })));
  f.fetch.mockClear();
  await f.run(() => now() + 86_399_999);
  expect(f.fetch).toHaveBeenCalledTimes(2);
  expect(f.checkOpen).toHaveBeenCalledTimes(2);
  expect(f.log).not.toHaveBeenCalled();

  const deadline = () => now() + 86_400_000;
  await f.run(deadline);
  await f.run(deadline);
  expect(f.checkOpen).toHaveBeenCalledTimes(2);
  expect(f.trash).not.toHaveBeenCalled();
  expect(f.log).toHaveBeenCalledExactlyOnceWith(`Reel cleanup: gave up on ${id} after 24 hours`);
  expect(JSON.parse(await readFile(statePath, 'utf8'))).toMatchObject({
    handled: [id],
    waitingForCleanup: [],
  });
});

it.each([
  [1, 'файл'],
  [2, 'файли'],
  [5, 'файлів'],
  [11, 'файлів'],
  [21, 'файл'],
  [22, 'файли'],
])('uses the Ukrainian plural for %i files', async (count, noun) => {
  const f = fixture();
  await Promise.all(Array.from({ length: count }, (_, i) => put(inbox, `older-${i}.mov`)));
  await f.run();
  expect(f.notify).toHaveBeenCalledExactlyOnceWith(
    `Робота ${id} опублікована: прибрано ${count} ${noun}.`,
  );
});

it.each([200, 304])('makes one conditional request on idle HTTP %s', async (status) => {
  const f = fixture();
  await f.run();
  if (status === 304) f.setCommit(new Response(null, { status }));
  f.fetch.mockClear();
  await f.run();
  expect(f.fetch).toHaveBeenCalledTimes(1);
  expect(new Headers(f.fetch.mock.calls[0]?.[1]?.headers).get('if-none-match')).toBe('"main-1"');
  expect(f.log).not.toHaveBeenCalled();
  expect(f.notify).not.toHaveBeenCalled();
});

it('waits for the video ledger and then retries a missing site video on unchanged main', async () => {
  const f = fixture();
  f.resources.set(index, frontMatter(true));
  f.resources.set(videoLedger, statuses('done', 'pending'));
  await put(reels, 'older.mp4');
  await f.run();
  expect(f.trash).not.toHaveBeenCalled();
  expect(f.fetch.mock.calls.some(([url]) => String(url).includes(video))).toBe(false);

  f.setCommit(new Response(JSON.stringify({ sha: 'b'.repeat(40) })));
  f.resources.set(videoLedger, statuses('done', 'done'));
  f.resources.set(video, 404);
  await f.run();
  expect(f.trash).not.toHaveBeenCalled();

  f.setCommit(new Response(null, { status: 304 }));
  f.resources.set(video, 206);
  f.fetch.mockClear();
  await f.run();
  expect(f.fetch).toHaveBeenCalledTimes(2);
  expect(f.trash).toHaveBeenCalledTimes(1);
});

it('reports a failed video channel once, even while the photo ledger is pending', async () => {
  const f = fixture();
  f.resources.set(index, frontMatter(true));
  f.resources.set(ledger, statuses('pending'));
  f.resources.set(videoLedger, statuses('done', 'failed'));
  await put(reels, 'older.mp4');
  await f.run();
  f.setCommit(new Response(JSON.stringify({ sha: 'b'.repeat(40) })));
  await f.run();
  expect(f.trash).not.toHaveBeenCalled();
  expect(f.notify).toHaveBeenCalledExactlyOnceWith(`Публікація ${id} з помилкою, папки не чищу`);
});

it('baselines old works without checking their ledgers', async () => {
  const f = fixture();
  f.resources.set(index, frontMatter(false, date - 86_400_000));
  await put(inbox, 'old.mov', date - 172_800_000);
  await f.run();
  expect(f.fetch).toHaveBeenCalledTimes(3);
  expect(f.trash).not.toHaveBeenCalled();
  expect(JSON.parse(await readFile(statePath, 'utf8')).handled).toEqual([id]);
});

it.each([403, 429, 'bad JSON', 'network'])(
  'leaves files in place on partial remote data (%s)',
  async (failure) => {
    const f = fixture();
    f.resources.set(listing, JSON.stringify([id, 'WORK-2'].map((name) => ({ name, type: 'dir' }))));
    f.resources.set(`${listing}/WORK-2/index.md`, frontMatter());
    if (failure === 'network') {
      const request = f.fetch.getMockImplementation()!;
      f.fetch.mockImplementation((url, init) => {
        if (String(url).includes('WORK-2.json')) return Promise.reject(new Error('offline'));
        return request(url, init);
      });
    } else {
      f.resources.set('content/ledger/WORK-2.json', failure);
    }
    await put(inbox, 'older.mov');
    await f.run();
    expect(await readdir(inbox)).toEqual(['older.mov']);
    expect(f.trash).not.toHaveBeenCalled();
    expect(f.notify).not.toHaveBeenCalled();
    expect(f.log).toHaveBeenCalledTimes(1);
    await expect(readFile(statePath)).rejects.toMatchObject({ code: 'ENOENT' });
  },
);

it('keeps both folders when the photo work page is missing', async () => {
  const f = fixture();
  f.resources.set(page, 404);
  await put(inbox, 'older.mov');
  await put(reels, 'older.mp4');
  await f.run();
  expect(f.trash).not.toHaveBeenCalled();
  expect(f.notify).not.toHaveBeenCalled();
  expect(f.log).not.toHaveBeenCalled();
});

it('leaves earlier ready works untouched when a later site request fails', async () => {
  const f = fixture();
  f.resources.set(listing, JSON.stringify([id, 'WORK-2'].map((name) => ({ name, type: 'dir' }))));
  f.resources.set(`${listing}/WORK-2/index.md`, frontMatter());
  f.resources.set('content/ledger/WORK-2.json', statuses('done'));
  f.resources.set('/works/work-2/', 503);
  await put(inbox, 'older.mov');
  await f.run();
  expect(f.trash).not.toHaveBeenCalled();
  expect(f.notify).not.toHaveBeenCalled();
  expect(f.log).toHaveBeenCalledExactlyOnceWith('Reel cleanup: Error: /works/work-2/: HTTP 503');
});
