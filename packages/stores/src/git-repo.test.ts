import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { initLedger, parsePost } from '@handmake/core';
import type { Post } from '@handmake/core';
import { describeContentStoreContract } from '@handmake/core/testing';
import { afterAll, describe, expect, it } from 'vitest';

import { GitRepoContentStore, postFolderName } from './git-repo';

const tmpDirs: string[] = [];

function freshRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'handmake-stores-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

describeContentStoreContract(
  'GitRepoContentStore',
  () => new GitRepoContentStore({ rootDir: freshRoot() }),
);

const samplePost: Post = {
  id: '01JCA11B2C3D4E5F6G7H8J9K0M',
  tenant: 'tenant',
  date: '2026-10-24T09:30:00+02:00',
  publishAt: 'now',
  type: 'free',
  photos: ['photo-1.jpg', 'photo-2.jpg'],
  channels: ['telegram'],
  versions: { uk: { provenance: 'human' }, de: { provenance: 'human' } },
  texts: { uk: 'uk text', de: 'de text' },
};

describe('GitRepoContentStore', () => {
  it('names the folder <date>-<lowercase id> and writes a parseable index.md', async () => {
    const rootDir = freshRoot();
    const store = new GitRepoContentStore({ rootDir });
    await store.savePost(samplePost, []);

    const folder = path.join('content', 'posts', postFolderName(samplePost));
    expect(folder).toMatch(/^content\/posts\/\d{4}-\d{2}-\d{2}-[0-9a-hjkmnp-tv-z]{26}$/);

    const markdown = await readFile(path.join(rootDir, folder, 'index.md'), 'utf8');
    expect(parsePost(markdown)).toEqual(samplePost);
  });

  it('writes photos beside index.md under the exact file names', async () => {
    const rootDir = freshRoot();
    const store = new GitRepoContentStore({ rootDir });
    const photos = [
      { fileName: 'photo-1.jpg', data: new Uint8Array([1, 2]) },
      { fileName: 'photo-2.jpg', data: new Uint8Array([3]) },
    ];
    await store.savePost(samplePost, photos);

    const postDir = path.join(rootDir, 'content', 'posts', postFolderName(samplePost));
    for (const photo of photos) {
      const data = new Uint8Array(await readFile(path.join(postDir, photo.fileName)));
      expect(data).toEqual(photo.data);
    }
  });

  it('rejects photo file names that escape the post folder', async () => {
    const store = new GitRepoContentStore({ rootDir: freshRoot() });
    await expect(
      store.savePost(samplePost, [{ fileName: '../evil.jpg', data: new Uint8Array([1]) }]),
    ).rejects.toThrow(/file name/);
  });

  it('round-trips ledgers and hides them from other tenants', async () => {
    const rootDir = freshRoot();
    const store = new GitRepoContentStore({ rootDir });
    const ledger = initLedger(
      'tenant',
      samplePost.id,
      ['telegram'],
      new Date('2026-10-24T10:00:00Z'),
    );
    await store.writeLedger(ledger);

    expect(await store.readLedger('tenant', samplePost.id)).toEqual(ledger);
    expect(await store.readLedger('other-tenant', samplePost.id)).toBeUndefined();
  });

  it('lists nothing when the content folder does not exist yet', async () => {
    const store = new GitRepoContentStore({ rootDir: freshRoot() });
    expect(await store.listPosts('tenant')).toEqual([]);
  });

  it('never serves index.md or a path outside the post folder as a photo', async () => {
    const rootDir = freshRoot();
    const store = new GitRepoContentStore({ rootDir });
    await store.savePost(samplePost, [{ fileName: 'photo-1.jpg', data: new Uint8Array([1]) }]);
    expect(await store.readPostPhoto('tenant', samplePost.id, 'index.md')).toBeUndefined();
    expect(await store.readPostPhoto('tenant', samplePost.id, '../photo-1.jpg')).toBeUndefined();
    // Declared in the frontmatter but missing on disk.
    expect(await store.readPostPhoto('tenant', samplePost.id, 'photo-2.jpg')).toBeUndefined();
  });

  it('names the folder of a broken post when listing', async () => {
    const rootDir = freshRoot();
    const brokenDir = path.join(rootDir, 'content', 'posts', '2026-10-24-broken');
    await mkdir(brokenDir, { recursive: true });
    await writeFile(path.join(brokenDir, 'index.md'), 'not a post');
    const store = new GitRepoContentStore({ rootDir });
    await expect(store.listPosts('tenant')).rejects.toThrow(/2026-10-24-broken\/index\.md/);
  });

  it('reads one post even when an unrelated post folder is broken', async () => {
    const rootDir = freshRoot();
    const store = new GitRepoContentStore({ rootDir });
    await store.savePost(samplePost, []);
    const brokenDir = path.join(rootDir, 'content', 'posts', '2026-10-24-broken');
    await mkdir(brokenDir, { recursive: true });
    await writeFile(path.join(brokenDir, 'index.md'), 'not a post');
    expect((await store.readPost('tenant', samplePost.id))?.id).toBe(samplePost.id);
  });
});
