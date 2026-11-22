import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parseCsv, pickTrack } from '../src/music.ts';
import type { Round } from '../src/music.ts';
import { parseWatchOptions, trashSource, watchDirectory } from '../src/watch.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'reel-music-test-'));
  vi.stubEnv('XDG_RUNTIME_DIR', join(dir, 'runtime'));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

it('parses quoted fields, escaped quotes, newlines, BOM and an empty final column', () => {
  expect(parseCsv('\uFEFFfile,title,note\r\na.mp3,"A, ""song""","a\nb"\r\nb.wav,B,')).toEqual([
    ['file', 'title', 'note'],
    ['a.mp3', 'A, "song"', 'a\nb'],
    ['b.wav', 'B', ''],
  ]);
  expect(() => parseCsv('broken,"quote')).toThrow('Invalid CSV');
});

const tracks = ['a', 'b', 'c'].map((file) => ({
  file,
  title: file,
  creator: 'Author',
  license: 'CC0',
  page: `https://example.test/${file}`,
}));

it('rotates ten picks with no repeats in rounds or at their boundaries', () => {
  let round: Round = { used: [] };
  const picked = Array.from({ length: 10 }, () => {
    const result = pickTrack(tracks, round, () => 0.99);
    round = result.round;
    return result.track.file;
  });
  expect(picked).toEqual(['c', 'b', 'a', 'c', 'b', 'a', 'c', 'b', 'a', 'c']);
  expect(pickTrack(tracks.slice(0, 1), round, () => 0).track.file).toBe('a');
  expect(() => pickTrack([], round)).toThrow('No eligible CC0 music tracks');
});

it('parses the inbox flags and paths with spaces', () => {
  expect(
    parseWatchOptions([
      'inbox',
      '--trash-source',
      '--music-dir',
      'music',
      '--out-dir',
      'output folder',
      '--interval',
      '0.5',
    ]),
  ).toEqual({
    dir: 'inbox',
    intervalMs: 500,
    options: { trashSource: true, musicDir: 'music', outDir: 'output folder' },
  });
  expect(() => parseWatchOptions(['inbox', '--out-dir', '--trash-source'])).toThrow('Usage');
});

it('uses gio for Trash and archives without overwriting when gio fails', async () => {
  const input = join(dir, 'my clip.mov');
  await writeFile(input, 'video');
  const gio = vi.fn(async () => rm(input));
  await trashSource(input, dir, gio);
  expect(gio).toHaveBeenCalledWith('gio', ['trash', '--', input]);
  expect(await readdir(dir)).toEqual([]);

  const archive = join(dir, 'оброблені');
  await mkdir(archive);
  await writeFile(join(archive, 'my clip.mov'), 'old');
  await writeFile(input, 'new');
  await trashSource(input, dir, async () => {
    throw new Error('Trash unavailable');
  });
  expect(await readFile(join(archive, 'my clip.mov'), 'utf8')).toBe('old');
  expect(await readFile(join(archive, 'my clip-2.mov'), 'utf8')).toBe('new');
  await expect(readFile(input)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('renders inbox copies with licensed music, persists rotation and logs the exact credit', async () => {
  const inbox = join(dir, 'Ролики');
  const outDir = join(dir, 'Готові рілси');
  const musicDir = join(dir, 'music');
  const musicStateDir = join(dir, 'state');
  const transferred = join(dir, 'transfer');
  for (const folder of [inbox, outDir, musicDir, transferred]) await mkdir(folder);
  await writeFile(join(transferred, 'clip.mov'), 'original');
  await writeFile(join(inbox, 'photo.jpg'), 'photo');
  await mkdir(join(inbox, 'nested.mov'));
  await writeFile(join(inbox, 'clip-reel.mp4'), 'existing inbox reel');
  await writeFile(join(outDir, 'clip-reel.mp4'), 'existing');
  await writeFile(join(outDir, 'clip-reel-2.mp4'), 'also existing');
  for (const track of ['a.mp3', 'b.wav', 'unlisted.ogg', 'restricted.flac'])
    await writeFile(join(musicDir, track), 'music');
  await writeFile(
    join(musicDir, 'ліцензії.csv'),
    [
      'file,title,creator,license,page',
      'a.mp3,"A, track",Author,CC0 1.0,https://example.test/a',
      'b.wav,B,Author,CC0,https://example.test/b',
      'restricted.flac,Restricted,Author,CC-BY,https://example.test/restricted',
    ].join('\n'),
  );
  const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
  const processor = vi.fn<NonNullable<Parameters<typeof watchDirectory>[3]>>(async (options) => {
    expect(options.musicOnly).toBe(true);
    await writeFile(options.out, 'render', { flag: 'wx' });
    return { size: 6, duration: 8 };
  });

  for (const suffix of [3, 4]) {
    await writeFile(join(inbox, 'clip.mov'), 'copy');
    const controller = new AbortController();
    const send = vi.fn(async (_message: string) => controller.abort());
    const watching = watchDirectory(inbox, 5, controller.signal, processor, send, {
      outDir,
      musicDir,
      musicStateDir,
      trashSource: true,
      checkOpen: async () => false,
      moveSource: async (input) => rename(input, join(dir, `trashed-${suffix}.mov`)),
    });
    try {
      await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
      expect(await readFile(join(outDir, `clip-reel-${suffix}.mp4`), 'utf8')).toBe('render');
      expect(send).toHaveBeenCalledWith(
        expect.stringMatching(
          /^Рілс готовий: clip\.mov, музика: (A, track|B)\. Прослухайте перед надсиланням\.$/,
        ),
      );
      expect(await readFile(join(dir, `trashed-${suffix}.mov`), 'utf8')).toBe('copy');
    } finally {
      controller.abort();
      await watching;
    }
  }
  expect(processor).toHaveBeenCalledTimes(2);
  expect(await readFile(join(outDir, 'clip-reel.mp4'), 'utf8')).toBe('existing');
  expect((await readdir(inbox)).sort()).toEqual(['clip-reel.mp4', 'nested.mov', 'photo.jpg']);
  expect(await readdir(transferred)).toEqual(['clip.mov']);
  expect(await readFile(join(transferred, 'clip.mov'), 'utf8')).toBe('original');
  const [header, ...log] = parseCsv(await readFile(join(musicStateDir, 'music-log.csv'), 'utf8'));
  expect(header).toEqual([
    'date',
    'input',
    'output',
    'track',
    'title',
    'creator',
    'license',
    'page',
  ]);
  expect(log.map((row) => row.slice(3)).sort()).toEqual([
    ['a.mp3', 'A, track', 'Author', 'CC0 1.0', 'https://example.test/a'],
    ['b.wav', 'B', 'Author', 'CC0', 'https://example.test/b'],
  ]);
  expect(
    warn.mock.calls.filter(([message]) => String(message).includes('unlisted.ogg')),
  ).toHaveLength(2);
});

it('keeps the source and writes an error with an empty eligible library', async () => {
  const inbox = join(dir, 'inbox');
  const musicDir = join(dir, 'music');
  const outDir = join(dir, 'out');
  await mkdir(inbox);
  await mkdir(musicDir);
  await writeFile(join(inbox, 'clip.mov'), 'video');
  const processor = vi.fn();
  const controller = new AbortController();
  const send = vi.fn(async (_message: string) => controller.abort());
  const watching = watchDirectory(inbox, 5, controller.signal, processor, send, {
    musicDir,
    outDir,
    musicStateDir: join(dir, 'state'),
    trashSource: true,
    checkOpen: async () => false,
  });
  try {
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(processor).not.toHaveBeenCalled();
    expect(await readFile(join(inbox, 'clip.reel-error.txt'), 'utf8')).toContain(
      'No eligible CC0 music',
    );
    expect(await readFile(join(inbox, 'clip.mov'), 'utf8')).toBe('video');
    await expect(readdir(outDir)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    controller.abort();
    await watching;
  }
});
