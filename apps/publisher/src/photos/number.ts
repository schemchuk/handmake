import sharp from 'sharp';
import type { PhotoFile } from '@handmake/core';

/** Burn only an ordinal into the processed photo; preserve its dimensions. */
export async function numberBallotPhoto(input: Uint8Array, number: number): Promise<Uint8Array> {
  if (!Number.isInteger(number) || number < 1 || number > 10)
    throw new Error('Ballot number must be 1–10');
  const { width, height } = await sharp(input).metadata();
  if (!width || !height) throw new Error('Ballot photo has no dimensions');
  const size = Math.max(1, Math.floor(Math.min(width, height) * 0.2));
  const margin = Math.floor(size * 0.15);
  // Vector digits avoid dependence on host fonts and fontconfig caches in CI.
  const segments = [
    'abcdef',
    'bc',
    'abged',
    'abgcd',
    'fgbc',
    'afgcd',
    'afgecd',
    'abc',
    'abcdefg',
    'abfgcd',
  ];
  const bars: Record<string, [number, number, number, number]> = {
    a: [2, 0, 6, 2],
    b: [8, 2, 2, 6],
    c: [8, 10, 2, 6],
    d: [2, 16, 6, 2],
    e: [0, 10, 2, 6],
    f: [0, 2, 2, 6],
    g: [2, 8, 6, 2],
  };
  const digits = String(number);
  const scale = (size * 0.65) / 18;
  const totalWidth = (digits.length * 12 - 2) * scale;
  const glyphs = Array.from(digits, (digit, index) => {
    const rects = Array.from(segments[Number(digit)]!, (segment) => {
      const [x, y, width, height] = bars[segment]!;
      return `<rect x="${x}" y="${y}" width="${width}" height="${height}"/>`;
    }).join('');
    return `<g transform="translate(${(size - totalWidth) / 2 + index * 12 * scale},${size * 0.175}) scale(${scale})" fill="white">${rects}</g>`;
  }).join('');
  const svg = `<svg width="${size}" height="${size}"><rect width="100%" height="100%" rx="${size * 0.15}" fill="black" stroke="white" stroke-width="${size * 0.05}"/>${glyphs}</svg>`;
  return new Uint8Array(
    await sharp(input)
      .composite([{ input: Buffer.from(svg), left: margin, top: margin }])
      .jpeg({ quality: 85 })
      .toBuffer(),
  );
}

export async function numberBallotPhotos(photos: PhotoFile[]): Promise<PhotoFile[]> {
  if (photos.length > 10) throw new Error('Ballot allows at most 10 photos');
  return Promise.all(
    photos.map(async (photo, index) => ({
      ...photo,
      data: await numberBallotPhoto(photo.data, index + 1),
    })),
  );
}
