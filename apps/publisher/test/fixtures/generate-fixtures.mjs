// One-off generator for the GPS-EXIF test fixture. sharp cannot write a GPS
// IFD, so this script builds the APP1/Exif TIFF segment by hand and splices it
// into a tiny baseline JPEG. Re-run with:
//   cd apps/publisher && node test/fixtures/generate-fixtures.mjs
// to regenerate test/fixtures/with-gps-exif.jpg.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

// Landshut-ish coordinates as DMS rationals (N48 32'13.92", E12 9'7.92").
const GPS_VERSION = [2, 3, 0, 0];
const LAT = [
  [48, 1],
  [32, 1],
  [1392, 100],
];
const LON = [
  [12, 1],
  [9, 1],
  [792, 100],
];

function buildGpsExifApp1() {
  // Little-endian TIFF: header(8) + IFD0(18) + GPS IFD(66) + rationals(48).
  const gpsIfdOffset = 8 + 18;
  const rationalsOffset = gpsIfdOffset + 66;
  const tiff = Buffer.alloc(rationalsOffset + 6 * 8);

  tiff.write('II', 0);
  tiff.writeUInt16LE(0x2a, 2);
  tiff.writeUInt32LE(8, 4); // IFD0 offset

  // IFD0: single entry — GPSInfo pointer (tag 0x8825, LONG, count 1).
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x8825, 10);
  tiff.writeUInt16LE(4, 12); // LONG
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt32LE(gpsIfdOffset, 18);
  tiff.writeUInt32LE(0, 22); // no next IFD

  // GPS IFD: version, lat ref, lat, lon ref, lon.
  tiff.writeUInt16LE(5, gpsIfdOffset);
  let entry = gpsIfdOffset + 2;
  const writeEntry = (tag, type, count, value) => {
    tiff.writeUInt16LE(tag, entry);
    tiff.writeUInt16LE(type, entry + 2);
    tiff.writeUInt32LE(count, entry + 4);
    if (Buffer.isBuffer(value)) value.copy(tiff, entry + 8);
    else tiff.writeUInt32LE(value, entry + 8);
    entry += 12;
  };
  // BYTE count 4 and ASCII count 2 fit inline in the value field.
  writeEntry(0, 1, 4, Buffer.from(GPS_VERSION));
  writeEntry(1, 2, 2, Buffer.from('N\0'));
  writeEntry(2, 5, 3, rationalsOffset);
  writeEntry(3, 2, 2, Buffer.from('E\0'));
  writeEntry(4, 5, 3, rationalsOffset + 3 * 8);
  tiff.writeUInt32LE(0, entry); // no next IFD

  let rational = rationalsOffset;
  for (const pair of [...LAT, ...LON]) {
    tiff.writeUInt32LE(pair[0], rational);
    tiff.writeUInt32LE(pair[1], rational + 4);
    rational += 8;
  }

  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const app1 = Buffer.alloc(2 + 2 + payload.length);
  app1.writeUInt16BE(0xffe1, 0); // APP1 marker
  app1.writeUInt16BE(payload.length + 2, 2); // segment length includes itself
  payload.copy(app1, 4);
  return app1;
}

async function main() {
  const baseline = await sharp({
    create: { width: 32, height: 24, channels: 3, background: { r: 180, g: 140, b: 90 } },
  })
    .jpeg({ quality: 80 })
    .toBuffer();
  if (baseline[0] !== 0xff || baseline[1] !== 0xd8) {
    throw new Error('baseline is not a JPEG (no SOI marker)');
  }

  const app1 = buildGpsExifApp1();
  const fixture = Buffer.concat([baseline.subarray(0, 2), app1, baseline.subarray(2)]);

  // Sanity-check the fixture: raw markers present, sharp reads it, EXIF kept.
  if (!fixture.includes(Buffer.from('Exif\0\0', 'latin1'))) {
    throw new Error('fixture has no Exif APP1 segment');
  }
  const meta = await sharp(fixture).metadata();
  if (!meta.exif || meta.exif.length === 0) {
    throw new Error('sharp does not see EXIF in the fixture');
  }

  const out = fileURLToPath(new URL('./with-gps-exif.jpg', import.meta.url));
  await writeFile(out, fixture);
  console.log(`wrote ${out} (${fixture.length} bytes, exif ${meta.exif.length} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
