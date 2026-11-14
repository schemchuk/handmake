import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { parseCollection, parseWork, serializeCollection, serializeWork } from '@handmake/core';
import type { Collection, Work } from '@handmake/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GitRepoContentStore } from './git-repo';

const work: Work = {
  id: '01JBCA1B2C3D4E5F6G7H8J9K0M',
  tenant: 'tenant',
  date: '2026-11-01T10:00:00Z',
  collection: 'sample',
  kind: 'interior',
  photos: ['a.jpg'],
  versions: { uk: { description: 'Fixture', provenance: 'human' } },
};
const collection: Collection = {
  tenant: 'tenant',
  slug: 'sample',
  order: 0,
  versions: { uk: { title: 'Fixture', description: 'Fixture', provenance: 'human' } },
  cover: { workId: work.id, fileName: 'a.jpg' },
};
let root: string;
let store: GitRepoContentStore;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'handmake-works-'));
  store = new GitRepoContentStore({ rootDir: root });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('Git work layout and failure handling', () => {
  it('writes the exact paths and repeated saves do not create new folders', async () => {
    for (let i = 0; i < 2; i++) {
      await store.saveWork(work, [{ fileName: 'a.jpg', data: new Uint8Array([1, 2]) }]);
      await store.saveCollection(collection);
    }
    expect(await readdir(path.join(root, 'content/works'))).toEqual([work.id]);
    expect(
      parseWork(await readFile(path.join(root, 'content/works', work.id, 'index.md'), 'utf8')),
    ).toEqual(work);
    expect(
      parseCollection(await readFile(path.join(root, 'content/collections/sample.md'), 'utf8')),
    ).toEqual(collection);
    expect(
      new Uint8Array(await readFile(path.join(root, 'content/works', work.id, 'photos/a.jpg'))),
    ).toEqual(new Uint8Array([1, 2]));
  });

  it.each(['works', 'collections'] as const)(
    'fails loudly on malformed %s with its location',
    async (kind) => {
      const file = kind === 'works' ? `works/${work.id}/index.md` : 'collections/sample.md';
      await mkdir(path.dirname(path.join(root, 'content', file)), { recursive: true });
      await writeFile(path.join(root, 'content', file), 'broken content');
      await expect(
        kind === 'works' ? store.listWorks('tenant') : store.listCollections('tenant'),
      ).rejects.toThrow(file);
    },
  );

  it('fails on a work folder without its document, and detects identity mismatches', async () => {
    await mkdir(path.join(root, 'content/works', work.id), { recursive: true });
    await expect(store.listWorks('tenant')).rejects.toThrow(/missing document/);
    await writeFile(
      path.join(root, 'content/works', work.id, 'index.md'),
      serializeWork({ ...work, id: '01JBCA1B2C3D4E5F6G7H8J9K0Z' }),
    );
    await expect(store.readWork('tenant', work.id)).rejects.toThrow(/id mismatch/);
    await mkdir(path.join(root, 'content/collections'), { recursive: true });
    await writeFile(
      path.join(root, 'content/collections/sample.md'),
      serializeCollection({ ...collection, slug: 'different' }),
    );
    await expect(store.listCollections('tenant')).rejects.toThrow(/slug mismatch/);
  });

  it('names malformed work folders in errors', async () => {
    await mkdir(path.join(root, 'content/works/broken-folder'), { recursive: true });
    await expect(store.listWorks('tenant')).rejects.toThrow('content/works/broken-folder');
  });

  it('reads one work despite an unrelated broken work', async () => {
    await store.saveWork(work, []);
    const bad = path.join(root, 'content/works/01JBCA1B2C3D4E5F6G7H8J9K0Z');
    await mkdir(bad, { recursive: true });
    await writeFile(path.join(bad, 'index.md'), 'broken');
    expect(await store.readWork('tenant', work.id)).toEqual(work);
    await expect(store.listWorks('tenant')).rejects.toThrow(/01JBCA1B2C3D4E5F6G7H8J9K0Z/);
  });

  it('validates all photo names before writing metadata or any bytes', async () => {
    await expect(
      store.saveWork(work, [
        { fileName: 'a.jpg', data: new Uint8Array([1]) },
        { fileName: '../bad.jpg', data: new Uint8Array([1]) },
      ]),
    ).rejects.toThrow();
    expect(await store.readWork('tenant', work.id)).toBeUndefined();
    await expect(
      readFile(path.join(root, 'content/works', work.id, 'photos/a.jpg')),
    ).rejects.toThrow();
  });

  it.each(['../outside', '/tmp/outside', 'bad\\path'])(
    'rejects unsafe lookup identity %s',
    async (name) => {
      await expect(store.readWork('tenant', name)).rejects.toThrow();
      await expect(store.readCollection('tenant', name)).rejects.toThrow();
    },
  );

  it('rejects symlink photos on reads and writes', async () => {
    await store.saveWork(work, []);
    const target = path.join(root, 'outside.jpg');
    await writeFile(target, 'outside bytes');
    await symlink(target, path.join(root, 'content/works', work.id, 'photos/a.jpg'));
    await expect(store.readWorkPhoto('tenant', work.id, 'a.jpg')).rejects.toThrow(/symlink/);
    await expect(
      store.saveWork(work, [{ fileName: 'a.jpg', data: new Uint8Array([9]) }]),
    ).rejects.toThrow(/symlink/);
    expect(await readFile(target, 'utf8')).toBe('outside bytes');
  });

  it('rejects symlink work and collection directories', async () => {
    await mkdir(path.join(root, 'content'), { recursive: true });
    const outside = path.join(root, 'outside');
    await mkdir(outside);
    for (const kind of ['works', 'collections'])
      await symlink(outside, path.join(root, 'content', kind));
    await expect(store.listWorks('tenant')).rejects.toThrow(/symlink/);
    await expect(store.saveCollection(collection)).rejects.toThrow(/symlink/);
    expect(await readdir(outside)).toEqual([]);
  });
});

it('stores declared video beside the work and guards tenant and symlink access', async () => {
  const video = new Uint8Array([1, 2, 3]);
  await expect(store.saveWork(work, [], video)).rejects.toThrow('declared');
  const withVideo: Work = {
    ...work,
    video: { fileName: 'video.mp4', provenance: 'human', people: 'none' },
  };
  await store.saveWork(withVideo, [], video);
  expect(await store.readWorkVideo(work.tenant, work.id)).toEqual(video);
  expect(await store.readWorkVideo('other', work.id)).toBeUndefined();
  const target = path.join(root, 'content/works', work.id, 'video.mp4');
  await rm(target);
  await symlink(path.join(root, 'outside.mp4'), target);
  await expect(store.readWorkVideo(work.tenant, work.id)).rejects.toThrow('symlink');
  await expect(store.saveWork(withVideo, [], video)).rejects.toThrow('symlink');
});
