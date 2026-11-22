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
import { probe, run, UnreadableInputError } from '../src/media.ts';
import {
  acquireLock,
  checkFileOpen,
  lockPath,
  selectReady,
  watchDirectory,
  watchLength,
} from '../src/watch.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'reel-watch-test-'));
  vi.stubEnv('XDG_RUNTIME_DIR', join(dir, 'runtime'));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

function snapshot(
  entries: [name: string, mtimeMs: number, size?: number][],
  otherNames: string[] = [],
) {
  return {
    names: new Set([...entries.map(([name]) => name), ...otherNames]),
    files: new Map(
      entries.map(([name, mtimeMs, size = 100]) => [
        name,
        { name, mtimeMs, size, ctimeMs: mtimeMs, ino: 1, dev: 1 },
      ]),
    ),
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
  const inbox = join(dir, 'inbox');
  const lock = lockPath(inbox);
  expect(lock).toMatch(/^.*\/runtime\/handmake-reel\/[a-f0-9]{64}\.lock$/);
  expect(lockPath(join(inbox, '..', 'inbox'))).toBe(lock);
  expect(lockPath(dir)).not.toBe(lock);
  await mkdir(join(dir, 'runtime', 'handmake-reel'), { recursive: true });
  await writeFile(lock, '2147483647\n');
  await writeFile(`${lock}.recovery`, '2147483647\n');
  const attempts = await Promise.allSettled([acquireLock(inbox), acquireLock(inbox)]);
  try {
    expect(attempts.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejected = attempts.find(({ status }) => status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toEqual(
      expect.objectContaining({
        message: expect.stringContaining('already running'),
      }),
    );
    expect(await readFile(lock, 'utf8')).toBe(`${process.pid}\n`);
    await expect(acquireLock(inbox)).rejects.toThrow('already running');
  } finally {
    await Promise.all(attempts.map((attempt) => attempt.status === 'fulfilled' && attempt.value()));
  }
  expect(await readdir(join(dir, 'runtime', 'handmake-reel'))).toEqual([]);
  const release = await acquireLock(inbox);
  await rm(lock);
  await expect(release()).resolves.toBeUndefined();
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
  const watching = watchDirectory(dir, 10, controller.signal, processor, send, {
    checkOpen: async () => false,
  });
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
  expect(await readdir(join(dir, 'runtime', 'handmake-reel'))).toEqual([]);
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
    let clock = 0;
    const watching = watchDirectory(inbox, 20, controller.signal, undefined, send, {
      checkOpen: async () => false,
      now: () => clock,
    });
    try {
      const bad = join(inbox, 'broken.mp4');
      const input = join(inbox, 'recording.mp4');
      await writeFile(bad, 'broken');
      await utimes(bad, 1, 1);
      await copyFile(fixture, input);
      await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1), { timeout: 10000 });
      clock = 600_000;
      await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
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

it.each([
  [undefined, true],
  [1, false],
  ['ENOENT', undefined],
])('interprets fuser result %s', async (code, expected) => {
  const execute = vi.fn(async () => {
    if (code !== undefined) throw Object.assign(new Error('fuser'), { code });
  });
  const input = join(dir, 'recording with spaces.mov');
  await expect(checkFileOpen(input, execute)).resolves.toBe(expected);
  expect(execute).toHaveBeenCalledWith('fuser', ['-s', input]);
});

it('waits for a missing folder and resumes after removal and recreation', async () => {
  const inbox = join(dir, 'inbox');
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const controller = new AbortController();
  const processor = vi.fn<NonNullable<Parameters<typeof watchDirectory>[3]>>(async ({ out }) => {
    await writeFile(out, 'reel');
    return { size: 4, duration: 8 };
  });
  const watching = watchDirectory(inbox, 10, controller.signal, processor, async () => {}, {
    checkOpen: async () => false,
  });
  try {
    for (const [index, name] of ['first', 'second'].entries()) {
      await vi.waitFor(() => expect(log).toHaveBeenCalledTimes(index + 1));
      await mkdir(inbox);
      await writeFile(join(inbox, `${name}.mov`), 'video');
      await vi.waitFor(async () =>
        expect((await readdir(inbox)).sort()).toEqual([`${name}-reel.mp4`, `${name}.mov`]),
      );
      await rm(inbox, { recursive: true });
    }
    expect(log.mock.calls).toEqual(
      Array.from({ length: 2 }, () => [`${inbox}: folder missing, waiting`]),
    );
    expect(processor).toHaveBeenCalledTimes(2);
  } finally {
    controller.abort();
    await watching;
  }
});

it('retries an unreadable input and restarts the grace period after it is reopened', async () => {
  const input = join(dir, 'truncated.mov');
  const marker = join(dir, 'truncated.reel-error.txt');
  await writeFile(input, 'truncated');
  let clock = 0;
  let heldOpen = true;
  const checkOpen = vi.fn(async () => heldOpen);
  const processor = vi.fn(async () => {
    throw new UnreadableInputError('moov missing');
  });
  const send = vi.fn(async () => {});
  const controller = new AbortController();
  const watching = watchDirectory(dir, 10, controller.signal, processor, send, {
    checkOpen,
    now: () => clock,
  });
  try {
    await vi.waitFor(() => expect(checkOpen.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(processor).not.toHaveBeenCalled();
    heldOpen = false;
    await vi.waitFor(() => expect(processor).toHaveBeenCalled());
    clock = 599_999;
    const attempts = processor.mock.calls.length;
    await vi.waitFor(() => expect(processor.mock.calls.length).toBeGreaterThan(attempts));
    expect(send).not.toHaveBeenCalled();
    await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' });

    heldOpen = true;
    const checks = checkOpen.mock.calls.length;
    await vi.waitFor(() => expect(checkOpen.mock.calls.length).toBeGreaterThan(checks + 1));
    clock = 600_000;
    heldOpen = false;
    const priorAttempts = processor.mock.calls.length;
    await vi.waitFor(() => expect(processor.mock.calls.length).toBeGreaterThan(priorAttempts));
    expect(send).not.toHaveBeenCalled();
    clock = 1_200_000;
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(await readFile(marker, 'utf8')).toBe('moov missing\n');
  } finally {
    controller.abort();
    await watching;
  }
});

it('waits 60 seconds and logs once when fuser is missing', async () => {
  await writeFile(join(dir, 'recording.mov'), 'video');
  let clock = 0;
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const checkOpen = vi.fn(async () => undefined);
  const processor = vi.fn(async () => ({ size: 4, duration: 8 }));
  const controller = new AbortController();
  const now = vi.fn(() => clock);
  const watching = watchDirectory(
    dir,
    10,
    controller.signal,
    processor,
    async () => {
      controller.abort();
    },
    { checkOpen, now },
  );
  try {
    await vi.waitFor(() => expect(log).toHaveBeenCalledTimes(1));
    clock = 59_999;
    const reads = now.mock.calls.length;
    await vi.waitFor(() => expect(now.mock.calls.length).toBeGreaterThan(reads + 1));
    expect(processor).not.toHaveBeenCalled();
    clock = 60_000;
    await vi.waitFor(() => expect(processor).toHaveBeenCalledTimes(1));
    expect(log).toHaveBeenCalledTimes(1);
    expect(checkOpen).toHaveBeenCalledTimes(1);
  } finally {
    controller.abort();
    await watching;
  }
});

it('leaves photos and other files untouched and adds only the reel', async () => {
  const controller = new AbortController();
  const others = {
    'IMG_0001.jpeg': 'jpeg bytes',
    'IMG_0002.PNG': 'png bytes',
    'IMG_0003.HEIC': 'heic bytes',
    'notes.txt': 'text',
  };
  for (const [name, content] of Object.entries(others)) await writeFile(join(dir, name), content);
  await writeFile(join(dir, 'IMG_0004.MOV'), 'video');
  const processor = vi.fn<NonNullable<Parameters<typeof watchDirectory>[3]>>(async ({ out }) => {
    await writeFile(out, 'reel');
    return { size: 4, duration: 8 };
  });
  const watching = watchDirectory(dir, 10, controller.signal, processor, async () => {}, {
    checkOpen: async () => false,
  });
  try {
    await vi.waitFor(() => expect(processor).toHaveBeenCalledTimes(1));
    await vi.waitFor(async () =>
      expect((await readdir(dir)).filter((name) => name !== 'runtime').sort()).toEqual(
        [...Object.keys(others), 'IMG_0004-reel.mp4', 'IMG_0004.MOV'].sort(),
      ),
    );
    for (const [name, content] of Object.entries(others))
      expect(await readFile(join(dir, name), 'utf8')).toBe(content);
    expect(await readFile(join(dir, 'IMG_0004.MOV'), 'utf8')).toBe('video');
  } finally {
    controller.abort();
    await watching;
  }
});
