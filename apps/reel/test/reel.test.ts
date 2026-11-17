import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { complement, idleIntervals, makePlan, parseOptions, videoBitrate } from '../src/plan.ts';
import { detectionIntervals, probe, processReel, renderArgs, run } from '../src/media.ts';
const options = (args: string[] = []) => parseOptions(['input.mp4', ...args]);
describe('planner', () => {
  it('keeps footage without idle and calculates speed', () => {
    const plan = makePlan(600, [], [], options());
    expect(plan.segments).toEqual([{ start: 0, end: 600 }]);
    expect(plan.speed).toBe(20);
  });
  it.each([
    { start: 0, end: 10 },
    { start: 40, end: 50 },
    { start: 90, end: 100 },
  ])('drops idle at $start', (idle) => {
    const plan = makePlan(100, [idle], [], options());
    expect(plan.kept).toBe(90);
    expect(plan.dropped).toBe(10);
    expect(plan.segments).toEqual(complement(100, [idle]));
  });
  it('drops only intersections lasting at least four seconds', () => {
    expect(
      idleIntervals(
        [{ start: 0, end: 20 }],
        [
          { start: 5, end: 8 },
          { start: 10, end: 15 },
        ],
      ),
    ).toEqual([{ start: 10, end: 15 }]);
    expect(makePlan(100, [{ start: 0, end: 3 }], [], options()).kept).toBe(100);
    expect(
      idleIntervals(
        [
          { start: 0, end: 4 },
          { start: 4, end: 8 },
        ],
        [{ start: 1, end: 7 }],
      ),
    ).toEqual([{ start: 1, end: 7 }]);
  });
  it('reserves a normal speed finale without duplicating it', () => {
    const plan = makePlan(100, [], [], options(['--finale', '01:30']));
    expect(plan.finale).toEqual({ start: 90, end: 93 });
    expect(plan.kept).toBe(97);
    expect(plan.bodyLength).toBe(27);
    expect(plan.speed).toBe(97 / 27);
    expect(makePlan(100, [], [], options(['--finale', '01:38'])).finale).toEqual({
      start: 98,
      end: 100,
    });
    expect(() => makePlan(100, [], [], options(['--finale', '01:39']))).toThrow('at least 2');
  });
  it('rejects too-short, all-idle and out-of-range inputs', () => {
    expect(() => makePlan(20, [], [], options())).toThrow('shorter');
    expect(() => makePlan(100, [{ start: 0, end: 100 }], [], options())).toThrow('active footage');
    for (const flag of ['--finale', '--audio-from'])
      expect(() => makePlan(60, [], [], options([flag, '01:00']))).toThrow('outside');
  });
  it('chooses the longest audible stretch or an explicit audio start', () => {
    const silence = [
      { start: 10, end: 20 },
      { start: 70, end: 100 },
    ];
    expect(makePlan(100, [], silence, options()).audio).toEqual({ start: 20, end: 50 });
    expect(makePlan(100, [], silence, options(['--audio-from', '01:30'])).audio).toEqual({
      start: 90,
      end: 100,
    });
  });
  it('computes a bounded video bitrate with audio and size headroom', () => {
    expect(videoBitrate(30)).toBe(Math.floor((19_000_000 * 8) / 30 - 128_000));
    expect(videoBitrate(1)).toBe(8_000_000);
    expect(((videoBitrate(55) + 128_000) * 55) / 8).toBeLessThanOrEqual(19_000_000);
  });
});
describe('options and filters', () => {
  it('parses all options and defaults', () => {
    expect(options()).toMatchObject({ length: 30, out: 'input.mp4-reel.mp4', force: false });
    expect(
      options([
        '--length',
        '55',
        '--finale',
        '12:34',
        '--audio-from',
        '01:02',
        '--music',
        'song.wav',
        '--music-volume',
        '0.4',
        '--music-only',
        '--out',
        'out.mp4',
        '--force',
      ]),
    ).toMatchObject({
      length: 55,
      finale: 754,
      audioFrom: 62,
      musicVolume: 0.4,
      musicOnly: true,
      force: true,
      out: 'out.mp4',
    });
  });
  it('accepts hour timestamps for both time options', () => {
    expect(options(['--finale', '2:03:04', '--audio-from', '1:59:58'])).toMatchObject({
      finale: 7384,
      audioFrom: 7198,
    });
    const plan = makePlan(
      8000,
      [],
      [],
      options(['--finale', '2:03:04', '--audio-from', '1:59:58']),
    );
    expect(plan.finale).toEqual({ start: 7384, end: 7387 });
    expect(plan.audio.start).toBe(7198);
  });
  it.each(['1:60:00', '1:00:60', '1:2:03', '-1:02:03', '1:02:03:04'])(
    'rejects invalid hour timestamp %s',
    (time) => {
      for (const flag of ['--finale', '--audio-from'])
        expect(() => options([flag, time])).toThrow('Time');
    },
  );
  it.each([
    [],
    ['x', '--length', '56'],
    ['x', '--length', 'NaN'],
    ['x', '--length', '0'],
    ['x', '--music-volume', '2'],
    ['x', '--finale', '1:60'],
    ['x', '--music-only'],
    ['x', '--out'],
    ['x', '--unknown', 'v'],
    ['x', '--force', '--force'],
  ])('rejects invalid arguments %j', (...args) => {
    expect(() => parseOptions(args)).toThrow();
  });
  it('parses trailing detection intervals and overlaps', () => {
    expect(
      detectionIntervals('freeze_start: 2\nfreeze_end: 8\nfreeze_start: 10', 'freeze', 12),
    ).toEqual([
      { start: 2, end: 8 },
      { start: 10, end: 12 },
    ]);
    expect(
      detectionIntervals('silence_start: 0\nsilence_end: 6 | silence_duration: 6', 'silence', 12),
    ).toEqual([{ start: 0, end: 6 }]);
  });
  it('keeps audio at normal speed, loops it, and mixes or replaces music', () => {
    const opts = options(['--finale', '01:30', '--music', 'song.wav']);
    const args = renderArgs(
      'input with spaces.mp4',
      'out.mp4',
      makePlan(100, [], [], opts),
      opts,
      true,
      1080,
    );
    const filter = args[args.indexOf('-filter_complex') + 1]!;
    expect(args).toContain('input with spaces.mp4');
    expect(filter).toContain('aloop=');
    expect(filter).toContain('loudnorm=I=-16:TP=-1.5:LRA=11');
    expect(filter).toContain('amix=');
    expect(filter).not.toContain('atempo');
    opts.musicOnly = true;
    expect(
      renderArgs('in', 'out', makePlan(100, [], [], opts), opts, true, 720).join(' '),
    ).toContain('[original]anullsink');
  });
});
let available = true;
try {
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
} catch {
  available = false;
  console.warn('Skipping reel integration: system ffmpeg/ffprobe unavailable');
}
it.skipIf(!available)(
  'renders a real still/silent clip with finale within bot limits and protects files',
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'reel-test-'));
    try {
      const input = join(dir, 'input clip.mp4'),
        out = join(dir, 'reel.mp4');
      await run('ffmpeg', [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=160x120:rate=30:duration=4',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=160x120:rate=30:duration=3',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=48000:duration=12',
        '-filter_complex',
        "[0:v]tpad=stop_mode=clone:stop_duration=5[first];[first][1:v]concat=n=2:v=1:a=0[v];[2:a]volume=0:enable='between(t,4,9)'[a]",
        '-map',
        '[v]',
        '-map',
        '[a]',
        '-c:v',
        'libx264',
        '-threads',
        '2',
        '-c:a',
        'aac',
        '-metadata',
        'comment=private-source',
        input,
      ]);
      const opts = parseOptions([input, '--length', '5', '--finale', '00:09', '--out', out]);
      const result = await processReel(opts);
      expect(result.plan.dropped).toBeGreaterThan(4);
      expect(result.plan.finale).toEqual({ start: 9, end: 12 });
      expect(result.duration).toBeCloseTo(5, 1);
      expect(result.size).toBeLessThanOrEqual(20_000_000);
      const output = await probe(out);
      expect(output.data.streams.map((x) => x.codec_name)).toEqual(['h264', 'aac']);
      expect(output.data.streams[0]).toMatchObject({ width: 160, height: 120 });
      expect(output.data.format.tags?.comment).toBeUndefined();
      const bytes = await readFile(out);
      await expect(processReel(opts)).rejects.toThrow('Output exists');
      expect(await readFile(out)).toEqual(bytes);
      await expect(processReel({ ...opts, out: input, force: true })).rejects.toThrow('differ');
      await expect(processReel({ ...opts, input: join(dir, 'missing') })).rejects.toThrow(
        'unreadable',
      );
      const music = join(dir, 'music.wav');
      await run('ffmpeg', [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=880:duration=1',
        music,
      ]);
      await processReel({ ...opts, force: true, music, musicOnly: true });
      expect((await probe(out)).duration).toBeCloseTo(5, 1);
      await writeFile(join(dir, 'invalid'), 'not video');
      await expect(probe(join(dir, 'invalid'))).rejects.toThrow('ffprobe failed');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
  120_000,
);

it.skipIf(!available).each([
  [1920, 1080, 1080, 1920, 1080],
  [1080, 1920, 1080, 1080, 1920],
  [1920, 1080, 720, 1280, 720],
  [1080, 1920, 720, 720, 1280],
  [320, 180, 1080, 320, 180],
  [180, 320, 720, 180, 320],
])(
  'renders %ix%i at short-side target %i as %ix%i',
  async (width, height, side, expectedWidth, expectedHeight) => {
    const dir = await mkdtemp(join(tmpdir(), 'reel-dimensions-'));
    try {
      const input = join(dir, 'input.mp4'),
        out = join(dir, 'output.mp4');
      await run('ffmpeg', [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        `testsrc2=size=${width}x${height}:rate=30:duration=0.2`,
        '-c:v',
        'libx264',
        '-threads',
        '2',
        input,
      ]);
      const opts = options(['--length', '0.2']);
      await run('ffmpeg', renderArgs(input, out, makePlan(0.2, [], [], opts), opts, false, side));
      expect(
        (await probe(out)).data.streams.find((stream) => stream.codec_type === 'video'),
      ).toMatchObject({ width: expectedWidth, height: expectedHeight });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
  30_000,
);
