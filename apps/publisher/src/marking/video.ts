import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { bounded, footer, geometry, label, version } from './label';
const exec = promisify(execFile);
const run = (tool: string, args: string[], cwd: string) =>
  exec(
    tool,
    tool === 'ffmpeg'
      ? ['-threads', '1', '-filter_threads', '1', '-filter_complex_threads', '1', ...args]
      : args,
    { cwd, timeout: 60_000, maxBuffer: 1_000_000 },
  );
const inputs =
  '-v error -xerror -err_detect explode -protocol_whitelist file,pipe -format_whitelist mov -i input.mp4 -loop 1 -i footer.png'.split(
    ' ',
  );
const schema = z.object({
  format: z.object({
    duration: z.coerce.number(),
    format_name: z.string(),
    tags: z.object({ comment: z.string().optional() }).optional(),
  }),
  streams: z.array(
    z.object({
      codec_type: z.string(),
      width: z.number().optional(),
      height: z.number().optional(),
      nb_read_frames: z.coerce.number().optional(),
      nb_frames: z.coerce.number().optional(),
    }),
  ),
});
const probe = async (file: string, dir: string, duration: number, marked = false) => {
  const { stdout } = await run(
    'ffprobe',
    [
      '-v',
      'error',
      '-protocol_whitelist',
      'file,pipe',
      '-format_whitelist',
      'mov',
      '-count_frames',
      '-show_format',
      '-show_streams',
      '-of',
      'json',
      file,
    ],
    dir,
  );
  const data = schema.parse(JSON.parse(stdout));
  const stream = data.streams[0];
  if (
    !data.format.format_name.includes('mp4') ||
    data.streams.length !== 1 ||
    stream?.codec_type !== 'video' ||
    !stream.width ||
    !stream.height ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > 15 ||
    Math.abs(data.format.duration - duration) > 0.1 ||
    !stream.nb_read_frames ||
    stream.nb_read_frames > 450 ||
    (stream.nb_frames !== undefined && stream.nb_frames !== stream.nb_read_frames)
  )
    throw new Error('show video structure/duration');
  geometry(stream.width, stream.height - (marked ? geometry(stream.width, 64) : 0));
  return {
    width: stream.width,
    height: stream.height,
    frames: stream.nb_read_frames,
    comment: data.format.tags?.comment,
  };
};
async function workspace<T>(bytes: Uint8Array, work: (dir: string) => Promise<T>) {
  bounded(bytes);
  const dir = await mkdtemp(path.join(tmpdir(), 'handmake-mark-'));
  try {
    await writeFile(path.join(dir, 'input.mp4'), bytes);
    return await work(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const comment = (hash: string) => `${version}:${hash};${label}`;
export const markVideo = (bytes: Uint8Array, hash: string, duration: number) =>
  workspace(bytes, async (dir) => {
    const input = await probe('input.mp4', dir, duration),
      band = await footer(input.width);
    await writeFile(path.join(dir, 'footer.png'), band.png);
    await run(
      'ffmpeg',
      [
        ...inputs,
        '-filter_complex',
        `[0:v]pad=iw:ih+${band.height}:0:0:black[v];[v][1:v]overlay=0:H-h:shortest=1`,
        '-map_metadata',
        '0',
        '-metadata',
        `comment=${comment(hash)}`,
        '-an',
        '-c:v',
        'libx264',
        '-threads',
        '1',
        '-crf',
        '18',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        '-fs',
        '20000001',
        'output.mp4',
      ],
      dir,
    );
    return readFile(path.join(dir, 'output.mp4'));
  });
export const verifyVideo = (bytes: Uint8Array, hash: string, duration: number) =>
  workspace(bytes, async (dir) => {
    const input = await probe('input.mp4', dir, duration, true),
      band = await footer(input.width);
    geometry(input.width, input.height - band.height);
    if (input.comment !== comment(hash)) throw new Error('show video metadata marker');
    await writeFile(path.join(dir, 'footer.png'), band.png);
    // Compare EVERY decoded frame against the expected footer, without buffering raw video in Node.
    await run(
      'ffmpeg',
      [
        ...inputs,
        '-filter_complex',
        `[0:v]crop=iw:${band.height}:0:ih-${band.height},format=yuv420p[v];[1:v]format=yuv420p[r];[v][r]psnr=stats_file=frames.log:shortest=1`,
        '-an',
        '-threads',
        '1',
        '-f',
        'null',
        '-',
      ],
      dir,
    );
    const lines = (await readFile(path.join(dir, 'frames.log'), 'utf8')).trim().split('\n');
    if (
      lines.length !== input.frames ||
      lines.some((line) => {
        const score = /psnr_avg:([\d.]+|inf)/.exec(line)?.[1];
        return !score || (score !== 'inf' && Number(score) < 32);
      })
    )
      throw new Error('show video visible marker');
  });
