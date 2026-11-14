import { expect, it } from 'vitest';
import sharp from 'sharp';
import { imageDimensions, videoDimensions } from '../src/lib/media-dimensions';
import { structuralVideo } from './fixtures/video';

it('reads non-square image dimensions and honours EXIF rotation', async () => {
  const bytes = await sharp({
    create: { width: 80, height: 40, channels: 3, background: '#ffffff' },
  })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
  expect(await imageDimensions(bytes)).toEqual({ width: 40, height: 80 });
  await expect(imageDimensions(undefined)).rejects.toThrow('absent');
});
it('reads MP4 display dimensions and rejects malformed media', () => {
  expect(videoDimensions(structuralVideo())).toEqual({ width: 640, height: 360 });
  expect(() => videoDimensions(Buffer.from('broken'))).toThrow();
  expect(() => videoDimensions(structuralVideo().subarray(0, 90))).toThrow();
});

it('applies the track rotation matrix to portrait video', () => {
  const bytes = structuralVideo();
  bytes.writeInt32BE(0, 48);
  bytes.writeInt32BE(65536, 52);
  bytes.writeInt32BE(-65536, 60);
  bytes.writeInt32BE(0, 64);
  expect(videoDimensions(bytes)).toEqual({ width: 360, height: 640 });
});
