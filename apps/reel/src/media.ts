import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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
export function displayDimensions(width: number, height: number, rotation = 0) {
  const angle = Math.abs(rotation) % 360;
  return angle === 90 || angle === 270 ? { width: height, height: width } : { width, height };
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
    streams: {
      codec_type: string;
      codec_name: string;
      width?: number;
      height?: number;
      side_data_list?: { rotation?: number }[];
    }[];
  };
  const video = data.streams.find((stream) => stream.codec_type === 'video');
  if (!video?.width || !video.height) throw new Error('Input has no video stream with dimensions');
  return {
    duration: Number(data.format.duration),
    audio: data.streams.some((x) => x.codec_type === 'audio'),
    dimensions: displayDimensions(
      video.width,
      video.height,
      video.side_data_list?.find((sideData) => sideData.rotation !== undefined)?.rotation,
    ),
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
  dimensions: { width: number; height: number },
): string[] {
  const filters: string[] = [];
  const cardIndex = options.music ? 2 : 1;
  const card = fileURLToPath(
    new URL(
      `../assets/endcard-${dimensions.height > dimensions.width ? 'portrait' : 'landscape'}.png`,
      import.meta.url,
    ),
  );
  const factor = Math.min(1, side / Math.min(dimensions.width, dimensions.height));
  const width = Math.trunc((dimensions.width * factor) / 2) * 2;
  const height = Math.trunc((dimensions.height * factor) / 2) * 2;
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
    `[video]fps=30,scale=w='trunc(iw*min(1,${side}/min(iw,ih))/2)*2':h='trunc(ih*min(1,${side}/min(iw,ih))/2)*2',setsar=1,format=yuv420p[scaled]`,
  );
  if (plan.endcardLength) {
    filters.push(
      '[scaled]split[main][last]',
      `[last]trim=start=${options.length - 1 / 30},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${plan.endcardLength},trim=duration=${plan.endcardLength},boxblur=10:1,eq=brightness=-0.25[backdrop]`,
      `[${cardIndex}:v:0]scale=${width}:${height},format=rgba,fade=t=in:d=0.3:alpha=1[card]`,
      '[backdrop][card]overlay=shortest=1[endcard]',
      '[main][endcard]concat=n=2:v=1:a=0,format=yuv420p[v]',
    );
  } else filters.push('[scaled]null[v]');
  const loopLength = plan.bodyLength + plan.endcardLength;
  const bodyFade = `afade=t=out:st=${Math.max(0, plan.bodyLength - 0.5)}:d=0.5`;
  if (hasAudio) {
    const samples = Math.max(1, Math.floor((plan.audio.end - plan.audio.start) * 48000));
    filters.push(
      `[0:a:0]atrim=start=${plan.audio.start}:end=${plan.audio.end},asetpts=PTS-STARTPTS,aresample=48000,aloop=loop=-1:size=${samples},atrim=duration=${loopLength},afade=t=in:d=0.3,${plan.endcardLength ? '' : `${bodyFade},`}loudnorm=I=-16:TP=-1.5:LRA=11[loop]`,
    );
  } else filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${loopLength}[loop]`);
  if (plan.finale) {
    if (plan.endcardLength) {
      filters.push(
        '[loop]asplit[bodyloop][cardloop]',
        `[bodyloop]atrim=duration=${plan.bodyLength},${bodyFade}[base]`,
        `[cardloop]atrim=start=${plan.bodyLength},asetpts=PTS-STARTPTS[cardaudio]`,
      );
    } else filters.push('[loop]anull[base]');
    const finaleLength = plan.finale.end - plan.finale.start;
    filters.push(
      hasAudio
        ? `[0:a:0]atrim=start=${plan.finale.start}:end=${plan.finale.end},asetpts=PTS-STARTPTS,apad,atrim=duration=${finaleLength}[fa]`
        : `anullsrc=r=48000:cl=stereo,atrim=duration=${finaleLength}[fa]`,
      plan.endcardLength
        ? '[base][fa][cardaudio]concat=n=3:v=0:a=1[extended]'
        : '[base][fa]concat=n=2:v=0:a=1[extended]',
    );
  } else filters.push('[loop]anull[extended]');
  if (options.music) {
    filters.push(
      `[1:a:0]atrim=duration=${plan.length},asetpts=PTS-STARTPTS,volume=${options.musicVolume}${plan.endcardLength ? '' : `,afade=t=out:st=${Math.max(0, plan.length - 0.5)}:d=0.5`}[music]`,
    );
    filters.push(
      options.musicOnly
        ? '[extended]anullsink;[music]anull[mixed]'
        : '[extended][music]amix=inputs=2:duration=first:normalize=0[mixed]',
    );
  } else filters.push('[extended]anull[mixed]');
  filters.push(
    plan.endcardLength ? `[mixed]afade=t=out:st=${plan.length - 1}:d=1[a]` : '[mixed]anull[a]',
  );
  return [
    '-hide_banner',
    '-v',
    'error',
    '-nostdin',
    '-y',
    '-i',
    input,
    ...(options.music ? ['-stream_loop', '-1', '-i', resolve(options.music)] : []),
    ...(plan.endcardLength ? ['-loop', '1', '-i', card] : []),
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
export async function processReel(options: Options, chooseLength?: (duration: number) => number) {
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
  if (chooseLength) options = { ...options, length: chooseLength(info.duration) };
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
      await run(
        'ffmpeg',
        renderArgs(input, file, plan, options, info.audio, side, info.dimensions),
      );
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
