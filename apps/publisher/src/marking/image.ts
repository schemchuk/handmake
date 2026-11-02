import sharp from 'sharp';
import { bounded, footer, geometry, label, version } from './label';

const options = { limitInputPixels: 8_000_000, failOn: 'warning' as const };
const token = (hash: string) => `${version}:${hash}`;
const packet = (hash: string, archived: string) =>
  `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:fum="https://fadenundstimmung.de/ns/ai/1/" fum:Marker="${token(hash)}" fum:Label="${label}" fum:SourceXmp="${archived}"/></rdf:RDF></x:xmpmeta>`;
export async function markImage(bytes: Uint8Array, hash: string, mime: string) {
  bounded(bytes);
  const image = sharp(bytes, options),
    metadata = await image.metadata();
  if (
    !['png', 'jpeg', 'webp'].includes(metadata.format ?? '') ||
    (metadata.pages && metadata.pages > 1) ||
    `image/${metadata.format}` !== mime
  )
    throw new Error('show image format');
  const normalized = await image
    .rotate()
    .keepMetadata()
    .png()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = normalized.info;
  geometry(width, height);
  const band = await footer(width);
  // Keep original XMP verbatim in an archive field; never pretend transformed C2PA is still signed.
  if ((metadata.xmp?.length ?? 0) > 64_000) throw new Error('show image metadata limit');
  const xmp = packet(hash, metadata.xmp?.toString('base64') ?? '');
  return sharp(normalized.data, options)
    .extend({ bottom: band.height, top: 0, left: 0, right: 0, background: 'black' })
    .composite([{ input: band.png, left: 0, top: height }])
    .keepMetadata()
    .withXmp(xmp)
    .png()
    .toBuffer();
}
export async function verifyImage(bytes: Uint8Array, hash: string) {
  bounded(bytes);
  const image = sharp(bytes, options),
    metadata = await image.metadata();
  const xmp = metadata.xmp?.toString() ?? '';
  const archived = /fum:SourceXmp="([A-Za-z0-9+/=]*)"/.exec(xmp)?.[1];
  if (
    metadata.format !== 'png' ||
    !metadata.width ||
    !metadata.height ||
    (metadata.pages ?? 1) !== 1 ||
    archived === undefined ||
    xmp !== packet(hash, archived)
  )
    throw new Error('show image marker');
  const band = await footer(metadata.width);
  geometry(metadata.width, metadata.height - band.height);
  // Decode the whole image, then compare the entire visible footer losslessly.
  const decoded = await image.toColourspace('srgb').ensureAlpha().raw().toBuffer();
  const expected = await sharp(band.png).ensureAlpha().raw().toBuffer();
  if (!decoded.subarray(decoded.length - expected.length).equals(expected))
    throw new Error('show image visible marker');
}
