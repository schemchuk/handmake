import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
  unlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseShow, serializeShow, showSchema } from '@handmake/core';
import type { Show, ShowContentStore, Work } from '@handmake/core';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { GitRepoContentStore } from './git-repo';

let root: string;
let store: GitRepoContentStore;
let show: Show;
const data = new Uint8Array([1, 2, 3]);
const files = (s: Show) => [...s.images, s.video].map(({ fileName }) => ({ fileName, data }));
let work: Work;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'handmake-shows-'));
  store = new GitRepoContentStore({ rootDir: root });
  show = showSchema.parse(
    JSON.parse(
      await readFile(
        new URL('../../../packages/core/test/fixtures/show.json', import.meta.url),
        'utf8',
      ),
    ),
  );
  work = {
    id: show.workId,
    tenant: show.tenant,
    date: show.date,
    collection: 'fixture',
    kind: 'interior',
    photos: ['original.jpg'],
    versions: show.versions,
  };
  await store.saveWork(work, [{ fileName: 'original.jpg', data }]);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it('implements the show store capability, serializes and retries without duplicate files', async () => {
  const capability: ShowContentStore = store;
  expect(parseShow(serializeShow(show))).toEqual(show);
  await capability.saveShow(show, files(show));
  await capability.saveShow(show, files(show));
  expect(await capability.readShow(show.tenant, show.id)).toEqual(show);
  expect(await readdir(path.join(root, 'content/shows'))).toEqual([show.id]);
  expect(await readdir(path.join(root, 'content/shows', show.id))).toHaveLength(5);
  expect(await capability.readShowMedia(show.tenant, show.id, 'clip.mp4')).toEqual(data);
  expect(await capability.readShowMedia(show.tenant, show.id, '../index.md')).toBeUndefined();
  expect(await capability.readShowMedia(show.tenant, show.id, 'index.md')).toBeUndefined();
  expect(await capability.readShowMedia(show.tenant, show.id, 'undeclared.png')).toBeUndefined();
});
it('allows exclusion to narrow visibility without changing content or bytes and never reopens it', async () => {
  await store.saveShow(show, files(show));
  const hidden = { ...show, siteExcluded: true };
  await store.saveShow(hidden, files(hidden));
  expect(await store.readShow(show.tenant, show.id)).toEqual(hidden);
  await store.saveShow(hidden, files(hidden));
  await expect(store.saveShow(show, files(show))).rejects.toThrow('immutable');
  await expect(
    store.saveShow({ ...hidden, date: '2026-12-01T10:00:00Z' }, files(hidden)),
  ).rejects.toThrow('immutable');
  expect(await store.readShowMedia(show.tenant, show.id, show.video.fileName)).toEqual(data);
});
it('keeps flat identities isolated across tenants on read/list/write', async () => {
  await store.saveShow(show, files(show));
  expect(await store.readShow('other', show.id)).toBeUndefined();
  expect(await store.readShowMedia('other', show.id, 'clip.mp4')).toBeUndefined();
  expect(await store.listShows('other')).toEqual([]);
  await expect(store.saveShow({ ...show, tenant: 'other' }, files(show))).rejects.toThrow(
    'immutable',
  );
});
it('orders by instant newest first and keeps missing reads empty', async () => {
  expect(await store.listShows(show.tenant)).toEqual([]);
  expect(await store.readShow(show.tenant, show.id)).toBeUndefined();
  await store.saveShow(show, files(show));
  const newer = { ...show, id: '01JBCA1B2C3D4E5F6G7H8J9K0A', date: '2026-11-02T10:00:00Z' };
  await store.saveShow(newer, files(newer));
  expect((await store.listShows(show.tenant)).map((s) => s.id)).toEqual([newer.id, show.id]);
});
it.each(['metadata', 'bytes'] as const)(
  'rejects changed %s without altering any saved asset',
  async (change) => {
    await store.saveShow(show, files(show));
    const changed = files(show);
    if (change === 'metadata') show.video.promptVersion = 'changed@2';
    else changed[2]!.data = new Uint8Array([9]);
    await expect(store.saveShow(show, changed)).rejects.toThrow('immutable');
    expect(await store.readShowMedia(show.tenant, show.id, show.images[0]!.fileName)).toEqual(data);
  },
);
it.each(['work', 'foreign work', 'original', 'original bytes'] as const)(
  'refuses missing %s',
  async (which) => {
    if (which === 'work') show.workId = show.id;
    if (which === 'foreign work') show.tenant = 'other';
    if (which === 'original') show.originals[0]!.fileName = 'missing.jpg';
    if (which === 'original bytes')
      await unlink(path.join(root, 'content/works', work.id, 'photos/original.jpg'));
    await expect(store.saveShow(show, files(show))).rejects.toThrow(/work|original/);
    expect(await store.listShows(show.tenant)).toEqual([]);
  },
);
it.each(['missing', 'duplicate', 'empty', 'extra'] as const)('refuses %s media', async (which) => {
  const media = files(show);
  if (which === 'missing') media.pop();
  if (which === 'duplicate') media[1] = media[0]!;
  if (which === 'empty') media[0]!.data = new Uint8Array();
  if (which === 'extra') media.push({ fileName: 'extra.png', data });
  await expect(store.saveShow(show, media)).rejects.toThrow(/all declared/);
});
it('recovers an interrupted manifest publication, preserving already saved media', async () => {
  const dir = path.join(root, 'content/shows', show.id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'image-0.png'), data);
  await writeFile(path.join(dir, 'index.pending'), 'interrupted manifest');
  expect(await store.listShows(show.tenant)).toEqual([]);
  await store.saveShow(show, files(show));
  expect(await store.readShow(show.tenant, show.id)).toEqual(show);
  expect(await readdir(dir)).not.toContain('index.pending');
});
it('rejects symlinks and malformed manifests instead of traversing them', async () => {
  await mkdir(path.join(root, 'content/shows'), { recursive: true });
  await symlink(
    path.join(root, 'content/works', work.id),
    path.join(root, 'content/shows', show.id),
  );
  await expect(store.saveShow(show, files(show))).rejects.toThrow('symlink');
  await unlink(path.join(root, 'content/shows', show.id));
  await mkdir(path.join(root, 'content/shows', show.id));
  await writeFile(path.join(root, 'content/shows', show.id, 'index.md'), 'broken');
  await expect(store.readShow(show.tenant, show.id)).rejects.toThrow(
    `content/shows/${show.id}/index.md`,
  );
});
