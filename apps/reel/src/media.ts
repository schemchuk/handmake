import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { constants } from 'node:fs';
import { access, copyFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { idleIntervals, makePlan, videoBitrate } from './plan.ts';
import type { Interval, Options, Plan } from './plan.ts';
const exec = promisify(execFile);
export async function run(binary: string, args: string[]) {
  try {
    return await exec(binary, args, { maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new Error(`Missing ${binary}; install system ffmpeg and ffprobe`);
    throw new Error(
      `${binary} failed: ${error instanceof Error ? error.message.slice(-2000) : String(error)}`,
    );
  }
}
export async function probe(file: string) {
  const { stdout } = await run('ffprobe', [
    '-v',
    'error',
    '-show_format',
    '-show_streams',
    '-of',
    'json',
    file,
  ]);
  const data = JSON.parse(stdout) as {
    format: { duration: string; tags?: Record<string, string> };
    streams: { codec_type: string; codec_name: string; width?: number; height?: number }[];
  };
  if (!data.streams.some((x) => x.codec_type === 'video'))
    throw new Error('Input has no video stream');
  return {
    duration: Number(data.format.duration),
    audio: data.streams.some((x) => x.codec_type === 'audio'),
    data,
  };
}
export function detectionIntervals(
  log: string,
  kind: 'freeze' | 'silence',
  duration: number,
): Interval[] {
  const result: Interval[] = [];
  let start: number | undefined;
  for (const match of log.matchAll(new RegExp(`${kind}_(start|end):\\s*([\\d.e+-]+)`, 'g'))) {
    if (match[1] === 'start') start = Number(match[2]);
    else if (start !== undefined) {
      result.push({ start, end: Number(match[2]) });
      start = undefined;
    }
  }
  if (start !== undefined) result.push({ start, end: duration });
  return result;
}
export function renderArgs(
  input: string,
  output: string,
  plan: Plan,
  options: Options,
  hasAudio: boolean,
  side: number,
): string[] {
  const filters: string[] = [];
  plan.segments.forEach((x, i) =>
    filters.push(`[0:v:0]trim=start=${x.start}:end=${x.end},setpts=PTS-STARTPTS[v${i}]`),
  );
  const labels = plan.segments.map((_, i) => `[v${i}]`).join('');
  filters.push(
    `${labels}concat=n=${plan.segments.length}:v=1:a=0,setpts=PTS/${plan.speed},trim=duration=${plan.bodyLength},setpts=PTS-STARTPTS[body]`,
  );
  if (plan.finale) {
    filters.push(
      `[0:v:0]trim=start=${plan.finale.start}:end=${plan.finale.end},setpts=PTS-STARTPTS[final]`,
    );
    filters.push('[body][final]concat=n=2:v=1:a=0[video]');
  } else filters.push('[body]null[video]');
  filters.push(
    `[video]fps=30,scale=w='trunc(iw*min(1,${side}/min(iw,ih))/2)*2':h='trunc(ih*min(1,${side}/min(iw,ih))/2)*2',setsar=1,format=yuv420p[v]`,
  );
  if (hasAudio) {
    const samples = Math.max(1, Math.floor((plan.audio.end - plan.audio.start) * 48000));
    filters.push(
      `[0:a:0]atrim=start=${plan.audio.start}:end=${plan.audio.end},asetpts=PTS-STARTPTS,aresample=48000,aloop=loop=-1:size=${samples},atrim=duration=${plan.bodyLength},afade=t=in:d=0.3,afade=t=out:st=${Math.max(0, plan.bodyLength - 0.5)}:d=0.5,loudnorm=I=-16:TP=-1.5:LRA=11[base]`,
    );
  } else filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${plan.bodyLength}[base]`);
  if (plan.finale) {
    filters.push(
      hasAudio
        ? `[0:a:0]atrim=start=${plan.finale.start}:end=${plan.finale.end},asetpts=PTS-STARTPTS,apad,atrim=duration=${plan.finale.end - plan.finale.start}[fa]`
        : `anullsrc=r=48000:cl=stereo,atrim=duration=${plan.finale.end - plan.finale.start}[fa]`,
    );
    filters.push('[base][fa]concat=n=2:v=0:a=1[original]');
  } else filters.push('[base]anull[original]');
  if (options.music) {
    filters.push(
      `[1:a:0]atrim=duration=${plan.length},asetpts=PTS-STARTPTS,volume=${options.musicVolume},afade=t=out:st=${Math.max(0, plan.length - 0.5)}:d=0.5[music]`,
    );
    filters.push(
      options.musicOnly
        ? '[original]anullsink;[music]anull[a]'
        : '[original][music]amix=inputs=2:duration=first:normalize=0[a]',
    );
  } else filters.push('[original]anull[a]');
  return [
    '-hide_banner',
    '-v',
    'error',
    '-nostdin',
    '-y',
    '-i',
    input,
    ...(options.music ? ['-stream_loop', '-1', '-i', resolve(options.music)] : []),
    '-filter_complex_threads',
    '1',
    '-filter_complex',
    filters.join(';'),
    '-map',
    '[v]',
    '-map',
    '[a]',
    '-t',
    String(plan.length),
    '-c:v',
    'libx264',
    '-threads',
    '2',
    '-preset',
    'fast',
    '-b:v',
    String(videoBitrate(plan.length)),
    '-maxrate',
    String(videoBitrate(plan.length)),
    '-bufsize',
    String(videoBitrate(plan.length) * 2),
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-ar',
    '48000',
    '-map_metadata',
    '-1',
    '-map_metadata:s',
    '-1',
    '-map_chapters',
    '-1',
    '-movflags',
    '+faststart',
    output,
  ];
}
export async function processReel(options: Options) {
  const input = resolve(options.input),
    out = resolve(options.out);
  if (input === out || (options.music && resolve(options.music) === out))
    throw new Error('Output must differ from input and music');
  await access(input, constants.R_OK).catch(() => {
    throw new Error('Input is unreadable');
  });
  if (!options.force) {
    try {
      await stat(out);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    // copyFile with COPYFILE_EXCL below also protects against a concurrent output creator.
    await access(out).then(
      () => {
        throw new Error('Output exists; use --force');
      },
      () => undefined,
    );
  }
  const info = await probe(input);
  const analysis = await run('ffmpeg', [
    '-hide_banner',
    '-nostdin',
    '-i',
    input,
    '-vf',
    'scale=320:-2,freezedetect=n=-50dB:d=1',
    ...(info.audio ? ['-af', 'silencedetect=n=-35dB:d=1'] : []),
    '-f',
    'null',
    '-',
  ]);
  const frozen = detectionIntervals(analysis.stderr, 'freeze', info.duration);
  const silent = info.audio
    ? detectionIntervals(analysis.stderr, 'silence', info.duration)
    : [{ start: 0, end: info.duration }];
  const plan = makePlan(info.duration, idleIntervals(frozen, silent), silent, options);
  const temp = await mkdtemp(join(dirname(out), '.reel-'));
  try {
    const file = join(temp, 'output.mp4');
    for (const side of [1080, 720]) {
      await run('ffmpeg', renderArgs(input, file, plan, options, info.audio, side));
      const rendered = await probe(file),
        size = (await stat(file)).size;
      if (
        size <= 20_000_000 &&
        rendered.duration <= 60 &&
        Math.abs(rendered.duration - plan.length) <= 0.15
      ) {
        await copyFile(file, out, options.force ? 0 : constants.COPYFILE_EXCL);
        return { plan, size, duration: rendered.duration, out };
      }
    }
    throw new Error('Reel still exceeds size/duration limits after 720 px retry');
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
