import {
  appendFile,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';

export type Track = {
  file: string;
  title: string;
  creator: string;
  license: string;
  page: string;
};
export type Round = { used: string[]; previous?: string };

export function parseCsv(csv: string) {
  csv = csv.replace(/^\uFEFF/, '');
  const field = /(?:"((?:[^"]|"")*)"|([^",\r\n]*))(,|\r\n|\n|\r|$)/y;
  const rows: string[][] = [];
  let row: string[] = [];
  for (let offset = 0; offset < csv.length || row.length > 0;) {
    field.lastIndex = offset;
    const match = field.exec(csv);
    if (!match) throw new Error('Invalid CSV field in ліцензії.csv');
    offset = field.lastIndex;
    row.push(match[1]?.replaceAll('""', '"') ?? match[2] ?? '');
    if (match[3] !== ',') {
      if (row.length > 1 || row[0]) rows.push(row);
      row = [];
    }
  }
  return rows;
}

export function pickTrack(tracks: Track[], round: Round, random = Math.random) {
  let used = round.used.filter((file) => tracks.some((track) => track.file === file));
  let eligible = tracks.filter((track) => !used.includes(track.file));
  if (!eligible.length) {
    used = [];
    eligible = tracks.filter((track) => track.file !== round.previous);
    if (!eligible.length) eligible = tracks;
  }
  const track = eligible[Math.floor(random() * eligible.length)];
  if (!track) throw new Error('No eligible CC0 music tracks in ліцензії.csv');
  return { track, round: { used: [...used, track.file], previous: track.file } };
}

async function readOptional(path: string) {
  return readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return undefined;
  });
}

export async function selectMusic(dir: string, stateDir: string, warned: Set<string>) {
  dir = await realpath(dir);
  const [header = [], ...rows] = parseCsv((await readOptional(join(dir, 'ліцензії.csv'))) ?? '');
  const columns = ['file', 'title', 'creator', 'license', 'page'] as const;
  const indices = columns.map((column) => header.indexOf(column));
  if (header.length && indices.includes(-1)) throw new Error('Missing columns in ліцензії.csv');
  const licensed = new Map<string, Track>();
  for (const row of rows) {
    const [file, title, creator, license, page] = indices.map((index, column) =>
      column === 0 ? row[index] : row[index]?.trim(),
    );
    if (
      file &&
      title &&
      creator &&
      license &&
      page &&
      /^(?:CC0|Creative Commons Zero|Creative Commons 0)(?:\s+1\.0(?:\s+Universal)?)?$/i.test(
        license,
      )
    )
      licensed.set(file, { file, title, creator, license, page });
  }
  const tracks: Track[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(mp3|m4a|ogg|flac|wav)$/i.test(entry.name)) continue;
    const track = licensed.get(entry.name);
    const path = join(dir, entry.name);
    if (track) tracks.push(track);
    else if (!warned.has(path)) {
      warned.add(path);
      console.error(`Skipping music without a complete CC0 row in ліцензії.csv: ${path}`);
    }
  }
  const statePath = join(stateDir, 'music-rotation.json');
  const state = JSON.parse((await readOptional(statePath)) ?? '{}') as Record<string, Round>;
  const { track, round } = pickTrack(tracks, state[dir] ?? { used: [] });
  return {
    track,
    path: join(dir, track.file),
    async record(input: string, output: string) {
      state[dir] = round;
      const temp = `${statePath}.tmp`;
      try {
        await writeFile(temp, JSON.stringify(state) + '\n');
        await rename(temp, statePath);
      } finally {
        await rm(temp, { force: true });
      }
      const log = join(stateDir, 'music-log.csv');
      const size = await stat(log).then(
        ({ size }) => size,
        (error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
          return 0;
        },
      );
      const header = size === 0 ? 'date,input,output,track,title,creator,license,page\n' : '';
      const row = [
        new Date().toISOString(),
        input,
        output,
        track.file,
        track.title,
        track.creator,
        track.license,
        track.page,
      ]
        .map((value) => (/[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value))
        .join(',');
      await appendFile(log, `${header}${row}\n`);
    },
  };
}
