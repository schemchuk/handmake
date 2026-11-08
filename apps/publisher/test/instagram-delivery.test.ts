import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { SendOperation } from '@handmake/core';
import { afterAll, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

import {
  contentRawBaseUrl,
  contentRawPhotoUrl,
  frameInstagramPhoto,
  instagramFramedFileName,
  prepareInstagramDelivery,
} from '../src/instagram-delivery';

const tmpDirs: string[] = [];
async function freshDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

afterAll(async () => {
  await Promise.all(tmpDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('contentRawBaseUrl', () => {
  it('prefers the CONTENT_RAW_BASE_URL override and strips trailing slashes', () => {
    expect(
      contentRawBaseUrl({
        CONTENT_RAW_BASE_URL: 'https://raw.example/base/',
        GITHUB_REPOSITORY: 'owner/repo',
        GITHUB_REF_NAME: 'main',
      }),
    ).toBe('https://raw.example/base');
  });

  it('builds the GitHub Actions raw URL from the repository and ref', () => {
    expect(contentRawBaseUrl({ GITHUB_REPOSITORY: 'owner/repo', GITHUB_REF_NAME: 'main' })).toBe(
      'https://raw.githubusercontent.com/owner/repo/main',
    );
  });

  it('is undefined without both the override and the Actions variables', () => {
    expect(contentRawBaseUrl({})).toBeUndefined();
    expect(contentRawBaseUrl({ GITHUB_REPOSITORY: 'owner/repo' })).toBeUndefined();
  });
});

describe('contentRawPhotoUrl', () => {
  it('joins the repo dir and file name with posix separators', () => {
    expect(contentRawPhotoUrl('https://raw.example/base', 'content/posts/f', 'photo-1.jpg')).toBe(
      'https://raw.example/base/content/posts/f/photo-1.jpg',
    );
  });

  it('normalizes backslashes for the URL', () => {
    expect(contentRawPhotoUrl('https://raw.example/base', 'content\\posts\\f', 'photo-1.jpg')).toBe(
      'https://raw.example/base/content/posts/f/photo-1.jpg',
    );
  });
});

describe('instagramFramedFileName', () => {
  it('replaces the extension with the framed suffix', () => {
    expect(instagramFramedFileName('photo-1.jpg')).toBe('photo-1.ig.jpg');
    expect(instagramFramedFileName('image-2.png')).toBe('image-2.ig.jpg');
  });
});

describe('frameInstagramPhoto', () => {
  it('pads a landscape photo onto the exact 4:5 canvas without cutting', async () => {
    const input = await sharp({
      create: { width: 900, height: 600, channels: 3, background: '#336699' },
    })
      .jpeg()
      .toBuffer();
    const framed = await frameInstagramPhoto(new Uint8Array(input));

    const metadata = await sharp(framed).metadata();
    expect(metadata).toMatchObject({ format: 'jpeg', width: 1080, height: 1350 });
  });

  it('upscales a tiny photo onto the full canvas', async () => {
    const input = await sharp({
      create: { width: 40, height: 20, channels: 3, background: '#222222' },
    })
      .jpeg()
      .toBuffer();
    const framed = await frameInstagramPhoto(new Uint8Array(input));

    const metadata = await sharp(framed).metadata();
    expect(metadata).toMatchObject({ format: 'jpeg', width: 1080, height: 1350 });
  });
});

describe('prepareInstagramDelivery', () => {
  const git = () => ({
    commit: vi.fn(async (_paths: string[], _message: string) => true),
    push: vi.fn(async (_ref: string) => {}),
  });
  const photos = [new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])];
  const carouselOp: SendOperation = {
    kind: 'mediaGroup',
    photoIndexes: [0, 1, 2],
    caption: 'Hallo!',
    captionLang: 'de',
  };

  it('throws without any raw base URL', async () => {
    const root = await freshDir('handmake-ig-prep-');
    await expect(
      prepareInstagramDelivery({
        root,
        env: {},
        git: git(),
        repoDir: 'content/posts/f',
        fileNames: ['photo-1.jpg'],
        photoBytes: [photos[0]!],
        ops: [{ kind: 'mediaGroup', photoIndexes: [0] }],
        startAt: 0,
        itemId: 'item',
      }),
    ).rejects.toThrowError(/public photo URLs/);
  });

  it('frames carousel photos beside the item, commits them and points the URLs at the copies', async () => {
    const root = await freshDir('handmake-ig-prep-');
    const itemDir = path.join(root, 'content', 'posts', 'folder');
    const g = git();
    const tinyJpeg = async () =>
      new Uint8Array(
        await sharp({ create: { width: 60, height: 40, channels: 3, background: '#555555' } })
          .jpeg()
          .toBuffer(),
      );

    const result = await prepareInstagramDelivery({
      root,
      env: { CONTENT_RAW_BASE_URL: 'https://raw.example/base' },
      git: g,
      repoDir: 'content/posts/folder',
      fileNames: ['photo-1.jpg', 'photo-2.jpg', 'photo-3.jpg'],
      photoBytes: [await tinyJpeg(), await tinyJpeg(), await tinyJpeg()],
      ops: [carouselOp],
      startAt: 0,
      itemId: '01JBCA1B2C3D4E5F6G7H8J9K0M',
    });

    expect(result.photoUrls).toEqual([
      'https://raw.example/base/content/posts/folder/photo-1.ig.jpg',
      'https://raw.example/base/content/posts/folder/photo-2.ig.jpg',
      'https://raw.example/base/content/posts/folder/photo-3.ig.jpg',
    ]);
    for (const name of ['photo-1.ig.jpg', 'photo-2.ig.jpg', 'photo-3.ig.jpg']) {
      const metadata = await sharp(await readFile(path.join(itemDir, name))).metadata();
      expect(metadata).toMatchObject({ format: 'jpeg', width: 1080, height: 1350 });
    }
    expect(g.commit).toHaveBeenCalledWith(
      [
        path.join('content', 'posts', 'folder', 'photo-1.ig.jpg'),
        path.join('content', 'posts', 'folder', 'photo-2.ig.jpg'),
        path.join('content', 'posts', 'folder', 'photo-3.ig.jpg'),
      ],
      'content: frame instagram photos 01JBCA1B2C3D4E5F6G7H8J9K0M',
    );
    expect(g.push).not.toHaveBeenCalled();
  });

  it('frames a single photo onto the 4:5 canvas — Instagram rejects other feed aspects', async () => {
    const root = await freshDir('handmake-ig-prep-');
    const g = git();
    const portrait = new Uint8Array(
      await sharp({ create: { width: 600, height: 800, channels: 3, background: '#777777' } })
        .jpeg()
        .toBuffer(),
    );
    const singleOp: SendOperation = { kind: 'mediaGroup', photoIndexes: [1], caption: 'Hallo!' };

    const result = await prepareInstagramDelivery({
      root,
      env: { CONTENT_RAW_BASE_URL: 'https://raw.example/base' },
      git: g,
      repoDir: 'content/works/01JBCA1B2C3D4E5F6G7H8J9K0M/photos',
      fileNames: ['photo-1.jpg', 'photo-2.jpg'],
      photoBytes: [new Uint8Array([1]), portrait],
      ops: [singleOp],
      startAt: 0,
      itemId: 'item',
    });

    expect(result.photoUrls).toEqual([
      'https://raw.example/base/content/works/01JBCA1B2C3D4E5F6G7H8J9K0M/photos/photo-1.jpg',
      'https://raw.example/base/content/works/01JBCA1B2C3D4E5F6G7H8J9K0M/photos/photo-2.ig.jpg',
    ]);
    const framed = await sharp(
      await readFile(
        path.join(
          root,
          'content',
          'works',
          '01JBCA1B2C3D4E5F6G7H8J9K0M',
          'photos',
          'photo-2.ig.jpg',
        ),
      ),
    ).metadata();
    expect(framed).toMatchObject({ format: 'jpeg', width: 1080, height: 1350 });
    expect(g.commit).toHaveBeenCalledTimes(1);
  });

  it('frames only the remaining ops on a ledger resume', async () => {
    const root = await freshDir('handmake-ig-prep-');
    const g = git();
    const tinyJpeg = new Uint8Array(
      await sharp({ create: { width: 60, height: 40, channels: 3, background: '#555555' } })
        .jpeg()
        .toBuffer(),
    );

    const result = await prepareInstagramDelivery({
      root,
      env: { CONTENT_RAW_BASE_URL: 'https://raw.example/base' },
      git: g,
      repoDir: 'content/shows/show-1',
      fileNames: ['image-0.png', 'image-1.png'],
      photoBytes: [tinyJpeg, tinyJpeg],
      ops: [carouselOp, { kind: 'mediaGroup', photoIndexes: [0, 1] }],
      startAt: 1,
      itemId: 'show-1',
    });

    // Only op 1 remains and references both photos, so both are framed; the
    // URL of the already-delivered op 0 no longer matters for delivery but
    // stays the original for a stable aligned array.
    expect(result.photoUrls).toEqual([
      'https://raw.example/base/content/shows/show-1/image-0.ig.jpg',
      'https://raw.example/base/content/shows/show-1/image-1.ig.jpg',
    ]);
    expect(g.commit).toHaveBeenCalledTimes(1);
  });

  it('pushes the content commit only with the workflow opt-in', async () => {
    const root = await freshDir('handmake-ig-prep-');
    const g = git();
    const tinyJpeg = async () =>
      new Uint8Array(
        await sharp({ create: { width: 60, height: 40, channels: 3, background: '#555555' } })
          .jpeg()
          .toBuffer(),
      );
    const photo = await tinyJpeg();

    await prepareInstagramDelivery({
      root,
      env: { CONTENT_RAW_BASE_URL: 'https://raw.example/base' },
      git: g,
      repoDir: 'content/posts/f',
      fileNames: ['photo-1.jpg'],
      photoBytes: [photo],
      ops: [{ kind: 'mediaGroup', photoIndexes: [0] }],
      startAt: 0,
      itemId: 'item',
    });
    expect(g.push).not.toHaveBeenCalled();

    const g2 = git();
    await prepareInstagramDelivery({
      root,
      env: {
        CONTENT_RAW_BASE_URL: 'https://raw.example/base',
        CONTENT_PUSH_BEFORE_DELIVERY: 'true',
        GITHUB_REF_NAME: 'main',
      },
      git: g2,
      repoDir: 'content/posts/f',
      fileNames: ['photo-1.jpg'],
      photoBytes: [await tinyJpeg()],
      ops: [{ kind: 'mediaGroup', photoIndexes: [0] }],
      startAt: 0,
      itemId: 'item',
    });
    expect(g2.push).toHaveBeenCalledWith('main');
  });
});
