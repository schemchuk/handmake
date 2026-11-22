import { execFileSync } from 'node:child_process';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { probe, run } from '../src/media.ts';
import { acquireLock, selectReady, watchDirectory, watchLength } from '../src/watch.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'reel-watch-test-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function snapshot(
  entries: [name: string, mtimeMs: number, size?: number][],
  otherNames: string[] = [],
) {
  return {
    names: new Set([...entries.map(([name]) => name), ...otherNames]),
    files: new Map(entries.map(([name, mtimeMs, size = 100]) => [name, { name, mtimeMs, size }])),
  };
}

it('selects stable regular videos oldest first and excludes derivatives and partial files', () => {
  const unchanged: [string, number][] = [
    ['later.MP4', 10],
    ['earlier.MoV', 5],
    ['.hidden.mp4', 1],
    ['finished-REEL.MP4', 1],
    ['copy.mp4.part', 1],
    ['copy.mov.crdownload', 1],
    ['copy.mp4.tmp', 1],
    ['notes.txt', 1],
    ['rendered.MOV', 1],
    ['failed.mp4', 1],
    ['failed.reel-error.txt', 1],
  ];
  const previous = snapshot([...unchanged, ['growing.mp4', 1], ['modified.mp4', 1]]);
  const current = snapshot(
    [...unchanged, ['growing.mp4', 1, 200], ['modified.mp4', 2], ['new.mp4', 1]],
    ['rendered-reel.mp4', 'folder.mov', 'symlink.mp4'],
  );
  expect(selectReady(previous, current).map(({ name }) => name)).toEqual([
    'earlier.MoV',
    'later.MP4',
  ]);
});

it.each([
  [90, 30],
  [30, 30],
  [29.99, 29],
  [5, 5],
])('chooses the reel length for a %s-second source', (source, length) =>
  expect(watchLength(source)).toBe(length),
);

it.each([4.99, NaN, Infinity])('rejects invalid or short durations (%s)', (duration) => {
  expect(() => watchLength(duration)).toThrow('at least 5 seconds');
});

it('replaces a stale lock, rejects a live lock and releases the claim', async () => {
  const lock = join(dir, '.reel-watch.lock');
  await writeFile(lock, '2147483647\n');
  await writeFile(`${lock}.recovery`, '2147483647\n');
  const attempts = await Promise.allSettled([acquireLock(dir), acquireLock(dir)]);
  try {
    expect(attempts.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejected = attempts.find(({ status }) => status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toEqual(
      expect.objectContaining({
        message: expect.stringContaining('already running'),
      }),
    );
    expect(await readFile(lock, 'utf8')).toBe(`${process.pid}\n`);
    await expect(acquireLock(dir)).rejects.toThrow('already running');
  } finally {
    await Promise.all(attempts.map((attempt) => attempt.status === 'fulfilled' && attempt.value()));
  }
  expect(await readdir(dir)).toEqual([]);
});

it('writes the error message, continues, and retries after the marker is deleted', async () => {
  const bad = join(dir, 'broken.mp4');
  const good = join(dir, 'good.MOV');
  const marker = join(dir, 'broken.reel-error.txt');
  await writeFile(bad, 'bad');
  await writeFile(good, 'good');
  await utimes(bad, 1, 1);
  await utimes(good, 2, 2);

  const controller = new AbortController();
  let fail = true;
  const processor = vi.fn<NonNullable<Parameters<typeof watchDirectory>[3]>>(
    async (options, chooseLength) => {
      if (options.input === bad && fail) throw new Error('invalid video');
      const length = chooseLength(6.4);
      expect(options).toMatchObject({ endcard: true, force: false });
      expect(options.finale).toBeUndefined();
      expect(options.audioFrom).toBeUndefined();
      await writeFile(options.out, 'reel');
      return { size: 4, duration: length + 2.5 };
    },
  );
  const send = vi.fn(async (_message: string) => {});
  const watching = watchDirectory(dir, 10, controller.signal, processor, send);
  try {
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(await readFile(marker, 'utf8')).toBe('invalid video\n');
    expect(send.mock.calls.map(([message]) => message)).toEqual([
      'Не вдалося обробити broken.mp4: invalid video',
      'Рілс готовий: good.MOV. Прослухайте перед надсиланням.',
    ]);
    fail = false;
    await rm(marker);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(3));
    expect(processor.mock.calls.map(([{ input }]) => basename(input))).toEqual([
      'broken.mp4',
      'good.MOV',
      'broken.mp4',
    ]);
    expect(await readFile(bad, 'utf8')).toBe('bad');
  } finally {
    controller.abort();
    await watching;
  }
  expect(await readdir(dir)).not.toContain('.reel-watch.lock');
});

const available = ['ffmpeg', 'ffprobe'].every((command) => {
  try {
    execFileSync(command, ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
});

it.skipIf(!available)(
  'processes a copied lavfi clip once and continues past a broken file',
  async () => {
    const inbox = join(dir, 'inbox');
    await mkdir(inbox);
    const fixture = join(dir, 'fixture.mp4');
    await run('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=160x120:rate=30:duration=6.5',
      '-c:v',
      'libx264',
      '-threads',
      '2',
      fixture,
    ]);

    const controller = new AbortController();
    const send = vi.fn(async (_message: string) => {});
    const watching = watchDirectory(inbox, 20, controller.signal, undefined, send);
    try {
      const bad = join(inbox, 'broken.mp4');
      const input = join(inbox, 'recording.mp4');
      await writeFile(bad, 'broken');
      await utimes(bad, 1, 1);
      await copyFile(fixture, input);
      await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2), { timeout: 10000 });
      expect(await readFile(join(inbox, 'broken.reel-error.txt'), 'utf8')).toContain(
        'ffprobe failed',
      );
      expect((await probe(join(inbox, 'recording-reel.mp4'))).duration).toBeCloseTo(8.5, 1);
      expect(await readFile(input)).toEqual(await readFile(fixture));
      // Several further scans must leave the processed files alone.
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(send).toHaveBeenCalledTimes(2);
    } finally {
      controller.abort();
      await watching;
    }
  },
  15000,
);
