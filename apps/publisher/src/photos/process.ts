import sharp from 'sharp';

export const MAX_LONG_SIDE = 2048;

export interface ProcessedPhoto {
  data: Uint8Array;
  width: number;
  height: number;
  format: 'jpeg';
}

/**
 * Normalises an author-supplied photo for publishing: re-encodes to JPEG,
 * strips all metadata (EXIF/GPS/ICC), caps the long side at 2048 px without
 * upscaling smaller images.
 */
export async function processPhoto(input: Uint8Array): Promise<ProcessedPhoto> {
  const pipeline = sharp(input).rotate(); // honour the EXIF orientation before stripping
  const resized = await pipeline
    .resize({
      width: MAX_LONG_SIDE,
      height: MAX_LONG_SIDE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 85 })
    .toBuffer({ resolveWithObject: true });
  return {
    data: resized.data,
    width: resized.info.width,
    height: resized.info.height,
    format: 'jpeg',
  };
}
