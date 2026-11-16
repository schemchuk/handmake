import { expect, it } from 'vitest';
import sharp from 'sharp';
import { numberBallotPhoto, numberBallotPhotos } from '../src/photos/number';

it('preserves dimensions, changes pixels and deterministically numbers 1–10', async () => {
  const input = await sharp({
    create: { width: 400, height: 300, channels: 3, background: 'gray' },
  })
    .jpeg()
    .toBuffer();
  const photos = await numberBallotPhotos(
    Array.from({ length: 10 }, (_, i) => ({ fileName: `${i}.jpg`, data: input })),
  );
  for (const [index, photo] of photos.entries()) {
    expect(await sharp(photo.data).metadata()).toMatchObject({ width: 400, height: 300 });
    expect(photo.data).toEqual(await numberBallotPhoto(input, index + 1));
    expect(Buffer.from(photo.data).equals(input)).toBe(false);
  }
  expect(new Set(photos.map((photo) => Buffer.from(photo.data).toString('base64'))).size).toBe(10);
  await expect(numberBallotPhoto(input, 11)).rejects.toThrow('1–10');
});
