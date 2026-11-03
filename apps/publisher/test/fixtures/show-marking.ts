import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { markShowMedia } from '../../src/marking';

export const receipt = {
  callId: 'fixture-call',
  model: 'fixture/model',
  promptVersion: 'show-interior@1',
  costEur: 0.1,
};
let cached: ReturnType<typeof create> | undefined;
export const markingFixtures = () => (cached ??= create());
async function create() {
  const dir = await mkdtemp(path.join(tmpdir(), 'handmake-mark-fixture-'));
  try {
    const image = await sharp({
      create: { width: 320, height: 240, channels: 3, background: '#bbbbbb' },
    })
      .png()
      .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/">Original fixture provenance</x:xmpmeta>')
      .toBuffer();
    await promisify(execFile)('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=gray:s=320x240:r=2',
      '-t',
      '5',
      '-an',
      '-c:v',
      'libx264',
      '-threads',
      '1',
      '-pix_fmt',
      'yuv420p',
      path.join(dir, 'raw.mp4'),
    ]);
    const video = await readFile(path.join(dir, 'raw.mp4'));
    const markedImage = await markShowMedia({ ...receipt, bytes: image, mimeType: 'image/png' });
    const markedVideo = await markShowMedia({ ...receipt, bytes: video, mimeType: 'video/mp4' });
    return { image, video, markedImage, markedVideo };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export const stripImageMetadata = (bytes: Uint8Array) => sharp(bytes).png().toBuffer();

export const tamperImageMetadata = (bytes: Uint8Array) =>
  sharp(bytes).withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/">tampered</x:xmpmeta>').png().toBuffer();

export async function stripVideoMetadata(bytes: Uint8Array) {
  const dir = await mkdtemp(path.join(tmpdir(), 'handmake-strip-fixture-'));
  try {
    const input = path.join(dir, 'input.mp4'),
      output = path.join(dir, 'output.mp4');
    await writeFile(input, bytes);
    await promisify(execFile)(
      'ffmpeg',
      ['-v', 'error', '-i', input, '-map_metadata', '-1', '-c', 'copy', output],
      { timeout: 60_000 },
    );
    return new Uint8Array(await readFile(output));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
