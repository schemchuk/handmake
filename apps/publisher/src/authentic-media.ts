import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
const exec = promisify(execFile);

/** Remove EXIF/XMP and IPTC segments without decoding or changing JPEG scan data. */
export function stripAuthenticPhoto(input: Uint8Array): Uint8Array {
  const bytes = Buffer.from(input);
  if (bytes.length > 20_000_000 || bytes.readUInt16BE(0) !== 0xffd8)
    throw new Error('Authentic photo must be a valid JPEG');
  const chunks = [bytes.subarray(0, 2)];
  let i = 2;
  let scan = false;
  while (i < bytes.length) {
    const start = i;
    if (bytes[i++] !== 0xff) throw new Error('Invalid authentic JPEG segment');
    while (bytes[i] === 0xff) i++;
    const marker = bytes[i++];
    if (marker === undefined) break;
    if (scan && marker === 0) continue;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (marker === 0xd9) {
      chunks.push(bytes.subarray(start, i));
      if (i !== bytes.length || !scan) throw new Error('Invalid authentic JPEG ending');
      return Buffer.concat(chunks);
    }
    if (i + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(i);
    if (length < 2 || i + length > bytes.length) break;
    i += length;
    if (marker !== 0xe1 && marker !== 0xed) chunks.push(bytes.subarray(start, i));
    if (marker === 0xda) {
      scan = true;
      const scanStart = i;
      while (i < bytes.length) {
        if (bytes[i] !== 0xff) {
          i++;
          continue;
        }
        const next = bytes[i + 1];
        if (next === 0 || (next !== undefined && next >= 0xd0 && next <= 0xd7)) {
          i += 2;
          continue;
        }
        break;
      }
      chunks.push(bytes.subarray(scanStart, i));
    }
  }
  throw new Error('Invalid authentic JPEG structure');
}

export async function stripAuthenticVideo(bytes: Uint8Array): Promise<Uint8Array> {
  const dir = await mkdtemp(path.join(tmpdir(), 'handmake-authentic-'));
  const run = (tool: string, args: string[]) =>
    exec(tool, args, {
      cwd: dir,
      timeout: 60_000,
      maxBuffer: 1_000_000,
    });
  const probe = async (file: string) => {
    const { stdout } = await run('ffprobe', [
      '-v',
      'error',
      '-protocol_whitelist',
      'file,pipe',
      '-format_whitelist',
      'mov',
      '-show_format',
      '-show_streams',
      '-of',
      'json',
      file,
    ]);
    const data = JSON.parse(stdout);
    const duration = Number(data.format?.duration);
    if (
      !Number.isFinite(duration) ||
      duration <= 0 ||
      duration > 60 ||
      !data.streams?.some((s: { codec_type: string }) => s.codec_type === 'video')
    )
      throw new Error('Authentic video must be at most 60 seconds');
    return data;
  };
  try {
    if (!bytes.length || bytes.length > 20_000_000) throw new Error();
    await writeFile(path.join(dir, 'input.mp4'), bytes);
    await probe('input.mp4');
    await run('ffmpeg', [
      '-v',
      'error',
      '-xerror',
      '-protocol_whitelist',
      'file,pipe',
      '-format_whitelist',
      'mov',
      '-i',
      'input.mp4',
      '-map',
      '0:v:0',
      '-map',
      '0:a?',
      '-map_metadata',
      '-1',
      '-map_metadata:s',
      '-1',
      '-map_chapters',
      '-1',
      '-c',
      'copy',
      '-movflags',
      '+faststart',
      'output.mp4',
    ]);
    const output = await probe('output.mp4');
    for (const entry of [output.format, ...output.streams]) {
      if (
        Object.keys(entry.tags ?? {}).some((key) =>
          /gps|exif|location|latitude|longitude/i.test(key),
        )
      )
        throw new Error();
    }
    return await readFile(path.join(dir, 'output.mp4'));
  } catch {
    throw new Error('Не вдалося очистити власне відео. Надішліть справне MP4/MOV до 60 секунд.');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
