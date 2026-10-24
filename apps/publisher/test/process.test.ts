import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

import { MAX_LONG_SIDE, processPhoto } from '../src/photos/process';

const fixturePath = fileURLToPath(new URL('./fixtures/with-gps-exif.jpg', import.meta.url));

const solidImage = (width: number, height: number, format: 'jpeg' | 'png' = 'jpeg') =>
  sharp({
    create: { width, height, channels: 3, background: { r: 120, g: 80, b: 40 } },
  })
    .toFormat(format)
    .toBuffer();

const EXIF_MARKER = Buffer.from('Exif\0\0', 'latin1');
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

describe('processPhoto', () => {
  it('strips GPS/EXIF metadata from a fixture JPEG that carries it', async () => {
    const input = await readFile(fixturePath);

    // The fixture must be valid input: sharp sees EXIF and the raw JPEG
    // carries an APP1 Exif segment.
    const inputMeta = await sharp(input).metadata();
    expect(inputMeta.format).toBe('jpeg');
    expect(inputMeta.exif?.length).toBeGreaterThan(0);
    expect(input.includes(EXIF_MARKER)).toBe(true);

    const output = await processPhoto(input);

    expect(output.format).toBe('jpeg');
    expect(Buffer.from(output.data).includes(EXIF_MARKER)).toBe(false);
    const outputMeta = await sharp(output.data).metadata();
    expect(outputMeta.format).toBe('jpeg');
    expect(outputMeta.exif).toBeUndefined();
    expect(outputMeta.width).toBe(output.width);
    expect(outputMeta.height).toBe(output.height);
  });

  it('re-encodes a PNG input to JPEG', async () => {
    const png = await solidImage(64, 48, 'png');
    expect(
      await sharp(png)
        .metadata()
        .then((m) => m.format),
    ).toBe('png');

    const output = await processPhoto(png);

    expect(output.format).toBe('jpeg');
    expect(Buffer.from(output.data.subarray(0, 3))).toEqual(JPEG_MAGIC);
    expect((await sharp(output.data).metadata()).format).toBe('jpeg');
  });

  it('caps the long side at 2048 px and preserves the aspect ratio', async () => {
    const large = await solidImage(3000, 2000);
    const output = await processPhoto(large);

    expect(Math.max(output.width, output.height)).toBe(MAX_LONG_SIDE);
    expect(output.width / output.height).toBeCloseTo(3000 / 2000, 1);
  });

  it('does not upscale a small image', async () => {
    const small = await solidImage(100, 80);
    const output = await processPhoto(small);

    expect(output.width).toBe(100);
    expect(output.height).toBe(80);
  });
});
