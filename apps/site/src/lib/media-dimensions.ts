import sharp from 'sharp';

export interface Dimensions {
  width: number;
  height: number;
}

/** Read displayed dimensions without changing the published bytes. */
export async function imageDimensions(bytes: Uint8Array | undefined): Promise<Dimensions> {
  if (!bytes) throw new Error('Declared image is absent');
  const metadata = await sharp(bytes).metadata();
  const { width, height } = metadata.autoOrient;
  if (!width || !height) throw new Error('Image has no dimensions');
  return { width, height };
}

/** MP4 track headers store display size and rotation; no decoding or external executable. */
export function videoDimensions(bytes: Uint8Array | undefined): Dimensions {
  if (!bytes) throw new Error('Declared video is absent');
  const data = Buffer.from(bytes);
  const tracks: Dimensions[] = [];
  const boxes = (start: number, end: number) => {
    for (let offset = start; offset + 8 <= end;) {
      let size = data.readUInt32BE(offset);
      const type = data.toString('ascii', offset + 4, offset + 8);
      let header = 8;
      if (size === 1) {
        if (offset + 16 > end) throw new Error('Truncated MP4 box');
        size = Number(data.readBigUInt64BE(offset + 8));
        header = 16;
      }
      if (size === 0) size = end - offset;
      if (!Number.isSafeInteger(size) || size < header || offset + size > end)
        throw new Error('Invalid MP4 box');
      const body = offset + header;
      if (type === 'moov' || type === 'trak') boxes(body, offset + size);
      if (type === 'tkhd') {
        const version = data[body];
        const matrix = body + (version === 1 ? 52 : 40);
        if ((version !== 0 && version !== 1) || matrix + 44 > offset + size)
          throw new Error('Invalid MP4 track header');
        const width = data.readUInt32BE(matrix + 36) / 65536;
        const height = data.readUInt32BE(matrix + 40) / 65536;
        // Audio tracks have no display dimensions. Apply the linear rotation matrix.
        if (width && height)
          tracks.push({
            width: Math.round(
              (Math.abs(data.readInt32BE(matrix)) * width +
                Math.abs(data.readInt32BE(matrix + 12)) * height) /
                65536,
            ),
            height: Math.round(
              (Math.abs(data.readInt32BE(matrix + 4)) * width +
                Math.abs(data.readInt32BE(matrix + 16)) * height) /
                65536,
            ),
          });
      }
      offset += size;
    }
  };
  boxes(0, data.length);
  const result = tracks.find(({ width, height }) => width > 0 && height > 0);
  if (!result) throw new Error('Video has no display dimensions');
  return result;
}
