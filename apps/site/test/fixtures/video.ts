/** Track-header fixture only, for layout and byte-preservation tests; not playable media. */
export function structuralVideo() {
  const track = Buffer.alloc(92);
  track.writeUInt32BE(92);
  track.write('tkhd', 4);
  track.writeInt32BE(65536, 48);
  track.writeInt32BE(65536, 64);
  track.writeUInt32BE(640 * 65536, 84);
  track.writeUInt32BE(360 * 65536, 88);
  return track;
}
