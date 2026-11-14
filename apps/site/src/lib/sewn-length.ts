/** Keep the needle near 60% of the viewport, within the usable cloth. */
export function sewnLength(clothTop: number, clothHeight: number, viewportHeight: number): number {
  const end = Math.max(0, clothHeight - 150);
  return Math.min(end, Math.max(40, viewportHeight * 0.6 - clothTop));
}
