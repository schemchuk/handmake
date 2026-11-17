export type Interval = { start: number; end: number };
export type Options = {
  input: string;
  length: number;
  finale?: number;
  audioFrom?: number;
  music?: string;
  musicVolume: number;
  musicOnly: boolean;
  out: string;
  force: boolean;
};
export function timestamp(value: string): number {
  if (!/^\d+:[0-5]\d$|^\d+:[0-5]\d:[0-5]\d$/.test(value))
    throw new Error('Time must be mm:ss or h:mm:ss');
  const seconds = value
    .split(':')
    .map(Number)
    .reduce((total, part) => total * 60 + part, 0);
  if (!Number.isSafeInteger(seconds)) throw new Error('Time is too large');
  return seconds;
}
export function parseOptions(args: string[]): Options {
  const input = args[0];
  if (!input || input.startsWith('--')) throw new Error('Usage: pnpm reel <input> [options]');
  const options: Options = {
    input,
    length: 30,
    musicVolume: 0.2,
    musicOnly: false,
    out: `${input}-reel.mp4`,
    force: false,
  };
  const seen = new Set<string>();
  for (let i = 1; i < args.length; i++) {
    const key = args[i]!;
    if (seen.has(key)) throw new Error(`Duplicate option: ${key}`);
    seen.add(key);
    if (key === '--force') options.force = true;
    else if (key === '--music-only') options.musicOnly = true;
    else {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
      switch (key) {
        case '--length':
          options.length = Number(value);
          break;
        case '--finale':
          options.finale = timestamp(value);
          break;
        case '--audio-from':
          options.audioFrom = timestamp(value);
          break;
        case '--music':
          options.music = value;
          break;
        case '--music-volume':
          options.musicVolume = Number(value);
          break;
        case '--out':
          options.out = value;
          break;
        default:
          throw new Error(`Unknown option: ${key}`);
      }
    }
  }
  if (!Number.isFinite(options.length) || options.length <= 0 || options.length > 55)
    throw new Error('Length must be > 0 and <= 55 seconds');
  if (!Number.isFinite(options.musicVolume) || options.musicVolume < 0 || options.musicVolume > 1)
    throw new Error('Music volume must be 0..1');
  if (options.musicOnly && !options.music) throw new Error('--music-only requires --music');
  return options;
}
export function complement(duration: number, intervals: Interval[]): Interval[] {
  const result: Interval[] = [];
  let cursor = 0;
  for (const item of [...intervals].sort((a, b) => a.start - b.start)) {
    const start = Math.max(0, Math.min(duration, item.start));
    const end = Math.max(start, Math.min(duration, item.end));
    if (start > cursor) result.push({ start: cursor, end: start });
    cursor = Math.max(cursor, end);
  }
  if (cursor < duration) result.push({ start: cursor, end: duration });
  return result;
}
export function idleIntervals(frozen: Interval[], silent: Interval[]): Interval[] {
  const overlaps = frozen
    .flatMap((a) =>
      silent.map((b) => ({ start: Math.max(a.start, b.start), end: Math.min(a.end, b.end) })),
    )
    .filter((x) => x.end > x.start);
  const merged: Interval[] = [];
  for (const x of overlaps.sort((a, b) => a.start - b.start)) {
    const last = merged.at(-1);
    if (last && x.start <= last.end) last.end = Math.max(last.end, x.end);
    else merged.push({ ...x });
  }
  return merged.filter((x) => x.end - x.start >= 4);
}
export function makePlan(duration: number, idle: Interval[], silent: Interval[], options: Options) {
  if (!Number.isFinite(duration) || duration < options.length)
    throw new Error('Input is shorter than the target length');
  for (const time of [options.finale, options.audioFrom]) {
    if (time !== undefined && (!Number.isFinite(time) || time < 0 || time >= duration))
      throw new Error('Finale/audio time is outside the recording');
  }
  const finale =
    options.finale === undefined
      ? undefined
      : { start: options.finale, end: Math.min(duration, options.finale + 3) };
  const finaleLength = finale ? finale.end - finale.start : 0;
  if (finale && finaleLength < 2) throw new Error('Finale needs at least 2 seconds remaining');
  const bodyLength = options.length - finaleLength;
  if (bodyLength <= 0) throw new Error('Target must be longer than the finale');
  const dropped = idle.filter((x) => x.end - x.start >= 4);
  const segments = complement(duration, [...dropped, ...(finale ? [finale] : [])]);
  const kept = segments.reduce((sum, x) => sum + x.end - x.start, 0);
  if (kept < bodyLength) throw new Error('Not enough active footage for the target length');
  const audible = complement(duration, silent).sort((a, b) => b.end - b.start - (a.end - a.start));
  const audioStart = options.audioFrom ?? audible[0]?.start ?? 0;
  const audioEnd = options.audioFrom === undefined ? (audible[0]?.end ?? duration) : duration;
  return {
    segments,
    finale,
    kept,
    dropped: duration - kept - finaleLength,
    speed: kept / bodyLength,
    bodyLength,
    length: options.length,
    audio: { start: audioStart, end: Math.min(audioEnd, audioStart + bodyLength) },
  };
}
export type Plan = ReturnType<typeof makePlan>;
export function videoBitrate(length: number): number {
  return Math.min(8_000_000, Math.floor((19_000_000 * 8) / length - 128_000));
}
