import sharp from 'sharp';
import { createHash } from 'node:crypto';

export const label = 'KI-generiertes Model';
export const version = 'show-mark@1';
export const maxBytes = 20_000_000;
export const sourceHash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export function bounded(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > maxBytes) throw new Error('show media size limit');
}
export function geometry(width: number, height: number) {
  if (
    !Number.isInteger(width) ||
    width < 320 ||
    width > 1920 ||
    !Number.isInteger(height) ||
    height < 64 ||
    height > 2560
  )
    throw new Error('show media dimensions');
  return 12 * Math.max(2, Math.floor(width / 180));
}
// Original 5x7 bitmap glyphs: deterministic across hosts, without system fonts.
const glyphs: Record<string, string> = {
  K: '10001/10010/10100/11000/10100/10010/10001',
  I: '11111/00100/00100/00100/00100/00100/11111',
  '-': '00000/00000/00000/11111/00000/00000/00000',
  g: '00000/01111/10001/10001/01111/00001/01110',
  e: '00000/01110/10001/11111/10000/10001/01110',
  n: '00000/10110/11001/10001/10001/10001/10001',
  r: '00000/10110/11001/10000/10000/10000/10000',
  i: '00100/00000/01100/00100/00100/00100/01110',
  t: '00100/00100/11111/00100/00100/00101/00010',
  s: '00000/01111/10000/01110/00001/10001/01110',
  M: '10001/11011/10101/10101/10001/10001/10001',
  o: '00000/01110/10001/10001/10001/10001/01110',
  d: '00001/00001/01101/10011/10001/10001/01111',
  l: '01100/00100/00100/00100/00100/00100/01110',
  ' ': '00000/00000/00000/00000/00000/00000/00000',
};
export async function footer(width: number) {
  const height = geometry(width, 64),
    scale = height / 12;
  const pixels = Buffer.alloc(width * height * 3);
  for (const [index, char] of [...label].entries())
    for (const [row, bits] of glyphs[char]!.split('/').entries())
      for (const [column, bit] of [...bits].entries())
        if (bit === '1')
          for (let dy = 0; dy < scale; dy++)
            for (let dx = 0; dx < scale; dx++) {
              const offset =
                (((row + 2) * scale + dy) * width + (index * 6 + column + 2) * scale + dx) * 3;
              pixels.fill(255, offset, offset + 3);
            }
  return {
    height,
    pixels,
    png: await sharp(pixels, { raw: { width, height, channels: 3 } })
      .png()
      .toBuffer(),
  };
}
