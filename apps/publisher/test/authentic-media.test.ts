import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { expect, it } from 'vitest';
import { stripAuthenticPhoto, stripAuthenticVideo } from '../src/authentic-media';
const exec = promisify(execFile);
it('removes EXIF GPS, XMP and IPTC losslessly while retaining ICC and progressive scans', async () => {
  const raw = await sharp({ create: { width: 20, height: 20, channels: 3, background: 'red' } })
    .withIccProfile('srgb')
    .jpeg({ progressive: true })
    .toBuffer();
  const gps = await readFile(new URL('./fixtures/with-gps-exif.jpg', import.meta.url));
  const segment = (marker: number) => Buffer.from([255, marker, 0, 6, 71, 80, 83, 0]);
  const input = Buffer.concat([raw.subarray(0, 2), segment(225), segment(237), raw.subarray(2)]);
  const clean = stripAuthenticPhoto(input);
  expect(Buffer.from(clean)).toEqual(raw);
  expect(await sharp(clean).raw().toBuffer()).toEqual(await sharp(input).raw().toBuffer());
  expect((await sharp(stripAuthenticPhoto(gps)).metadata()).exif).toBeUndefined();
  expect(stripAuthenticPhoto(clean)).toEqual(clean);
  expect(() => stripAuthenticPhoto(input.subarray(0, input.length - 1))).toThrow();
});
it('remuxes QuickTime location metadata without changing audio/video packets', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'handmake-authentic-test-'));
  const run = (tool: string, args: string[]) => exec(tool, args, { cwd: dir });
  try {
    await run('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=red:s=32x32:r=1',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440',
      '-t',
      '1',
      '-c:v',
      'libx264',
      '-threads',
      '1',
      '-c:a',
      'aac',
      '-metadata',
      'location=+48.5+012.1/',
      '-metadata',
      'title=private',
      'input.mov',
    ]);
    const input = await readFile(path.join(dir, 'input.mov'));
    const cleaned = await stripAuthenticVideo(input);
    await writeFile(path.join(dir, 'clean.mp4'), cleaned);
    const packets = async (file: string) =>
      JSON.parse(
        (
          await run('ffprobe', [
            '-v',
            'error',
            '-show_packets',
            '-show_data_hash',
            'sha256',
            '-show_entries',
            'packet=stream_index,data_hash',
            '-of',
            'json',
            file,
          ])
        ).stdout,
      ).packets;
    expect(await packets('clean.mp4')).toEqual(await packets('input.mov'));
    const metadata = (
      await run('ffprobe', [
        '-v',
        'error',
        '-show_format',
        '-show_streams',
        '-of',
        'json',
        'clean.mp4',
      ])
    ).stdout;
    const parsed = JSON.parse(metadata);
    expect(
      JSON.stringify([parsed.format.tags, ...parsed.streams.map((s: { tags: unknown }) => s.tags)]),
    ).not.toMatch(/location|private|48\.5/);
    await expect(stripAuthenticVideo(Buffer.from('broken'))).rejects.toThrow('60');
    await run('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=s=16x16:r=1',
      '-t',
      '61',
      '-c:v',
      'libx264',
      '-threads',
      '1',
      'long.mp4',
    ]);
    await expect(stripAuthenticVideo(await readFile(path.join(dir, 'long.mp4')))).rejects.toThrow(
      '60',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30000);
