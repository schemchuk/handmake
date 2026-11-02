import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { showSchema } from '@handmake/core';
import type { PublishedCallbackBody, Show, Work } from '@handmake/core';
import { GitRepoContentStore } from '@handmake/stores';
import sharp from 'sharp';
import { markingFixtures } from './fixtures/show-marking';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parseDispatchPayload } from '../src/payload';
import type { DispatchPayload } from '../src/payload';
import { runPublish } from '../src/publish';

let root: string,
  payloadPath: string,
  show: Show,
  store: GitRepoContentStore,
  payload: DispatchPayload;
let image: Uint8Array;
let video: Uint8Array;
const source = { fetchMedia: vi.fn<(ref: string) => Promise<Uint8Array>>() };
const git = { commit: vi.fn(async (_paths: string[], _message: string) => true) };
const callback = { send: vi.fn(async (_body: PublishedCallbackBody) => {}) };
const run = async (overrides = {}) => {
  await writeFile(payloadPath, JSON.stringify(payload));
  return runPublish(payloadPath, {
    root,
    git,
    showMediaSource: source,
    callback,
    logger: () => {},
    env: {
      PUBLISH_CALLBACK_URL: 'https://example.invalid/callback',
      PUBLISH_CALLBACK_SECRET: 'fixture-secret',
    },
    ...overrides,
  });
};
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'handmake-show-publish-'));
  payloadPath = path.join(root, 'payload.json');
  await mkdir(path.join(root, 'config/tenants'), { recursive: true });
  await copyFile(
    new URL('../../../config/tenants/faden-und-stimmung.yaml', import.meta.url),
    path.join(root, 'config/tenants/faden-und-stimmung.yaml'),
  );
  show = showSchema.parse(
    JSON.parse(
      await readFile(
        new URL('../../../packages/core/test/fixtures/show.json', import.meta.url),
        'utf8',
      ),
    ),
  );
  const fixtures = await markingFixtures();
  image = new Uint8Array(fixtures.markedImage.result.bytes);
  video = new Uint8Array(fixtures.markedVideo.result.bytes);
  for (const entry of show.images) entry.marker = fixtures.markedImage.marker;
  show.video.marker = fixtures.markedVideo.marker;
  store = new GitRepoContentStore({ rootDir: root });
  const work: Work = {
    id: show.workId,
    tenant: show.tenant,
    date: show.date,
    collection: 'fixture',
    kind: 'interior',
    photos: ['original.jpg'],
    versions: show.versions,
  };
  await store.saveWork(work, [{ fileName: 'original.jpg', data: image }]);
  payload = {
    kind: 'show',
    tenantId: show.tenant,
    draftId: show.id,
    type: 'free',
    fileIds: [],
    provenance: show.provenance,
    texts: Object.fromEntries(
      Object.entries(show.versions).map(([lang, version]) => [lang, version.description]),
    ),
    show: {
      show,
      media: [...show.images, show.video].map(({ fileName }) => ({ fileName, ref: fileName })),
    },
  };
  source.fetchMedia
    .mockReset()
    .mockImplementation(async (ref) => (ref.endsWith('.mp4') ? video : image));
  git.commit.mockClear();
  callback.send.mockClear();
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it('publishes site-only content, preserves marking bytes, and safely retries on another day', async () => {
  const first = await run();
  expect(first.show).toEqual(show);
  expect(first.post.channels).toEqual([]);
  expect(await store.readShowMedia(show.tenant, show.id, 'image-0.png')).toEqual(image);
  expect(await store.readShowMedia(show.tenant, show.id, 'clip.mp4')).toEqual(video);
  expect(await store.listPosts(show.tenant)).toEqual([]);
  expect(git.commit.mock.calls[0]![0]).toEqual([`content/shows/${show.id}`]);
  await run({ now: new Date('2026-12-01T12:00:00Z') });
  expect(await store.listShows(show.tenant)).toEqual([show]);
  expect(await store.readLedger(show.tenant, show.id)).toMatchObject({ channels: {} });
  expect(callback.send).toHaveBeenCalledTimes(2);
  expect(callback.send.mock.calls[0]![0]).toMatchObject({
    kind: 'show',
    postId: show.id,
    channels: {},
  });
});
it('creates no second git commit on an identical retry with a real git committer', async () => {
  const exec = promisify(execFile);
  await exec('git', ['init', '-q'], { cwd: root });
  await run({ git: undefined });
  const first = (await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout;
  await run({ git: undefined });
  expect((await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout).toBe(first);
});
it.each(['language', 'work', 'original'] as const)(
  'fails missing %s before fetching or committing',
  async (which) => {
    if (which === 'language') {
      delete show.versions.de;
      delete payload.texts.de;
    }
    if (which === 'work') show.workId = show.id;
    if (which === 'original') show.originals[0]!.fileName = 'missing.jpg';
    await expect(run()).rejects.toThrow(/language|work|original/);
    expect(source.fetchMedia).not.toHaveBeenCalled();
    expect(git.commit).not.toHaveBeenCalled();
  },
);
it.each(['image', 'video', 'download'] as const)(
  'rejects bad %s before writing content',
  async (which) => {
    source.fetchMedia.mockImplementation(async (ref) => {
      if (which === 'download') throw new Error('download interrupted');
      return (which === 'video' && ref.endsWith('.mp4')) ||
        (which === 'image' && ref.endsWith('.png'))
        ? new Uint8Array([1, 2])
        : ref.endsWith('.mp4')
          ? video
          : image;
    });
    await expect(run()).rejects.toThrow();
    expect(await store.readShow(show.tenant, show.id)).toBeUndefined();
    expect(git.commit).not.toHaveBeenCalled();
  },
);
it('rejects changed approved content or media on retry', async () => {
  await run();
  show.video.promptVersion = 'changed@2';
  await expect(run()).rejects.toThrow('immutable');
  show.video.promptVersion = 'interior@1';
  source.fetchMedia.mockResolvedValue(new Uint8Array(await sharp(image).negate().png().toBuffer()));
  // Leave the video valid so the immutable image comparison is reached.
  source.fetchMedia.mockImplementation(async (ref) =>
    ref.endsWith('.mp4') ? video : new Uint8Array(await sharp(image).negate().png().toBuffer()),
  );
  await expect(run()).rejects.toThrow('marking failed');
});
it.each([
  { draftId: '01JBCA1B2C3D4E5F6G7H8J9K0A' },
  { tenantId: 'other' },
  { fileIds: ['unexpected'] },
  { type: 'reminder' },
  { texts: { uk: 'changed' } },
  { kind: 'post' },
  { provenance: 'human' },
])('rejects mismatched approved payload %j', (patch) => {
  expect(() => parseDispatchPayload(JSON.stringify({ ...payload, ...patch }))).toThrow();
});
it('rejects missing, duplicate and undeclared generated references', () => {
  for (const media of [
    payload.show!.media.slice(1),
    [...payload.show!.media, payload.show!.media[0]],
    payload.show!.media.map((file, i) => (i ? file : { ...file, fileName: 'other.png' })),
  ]) {
    expect(() =>
      parseDispatchPayload(JSON.stringify({ ...payload, show: { show, media } })),
    ).toThrow();
  }
});

it('refuses a conflicting channel ledger before any download', async () => {
  await store.writeLedger({
    tenantId: show.tenant,
    postId: show.id,
    channels: {
      telegram: { status: 'done', remoteIds: [], updatedAt: show.date },
    },
  });
  await expect(run()).rejects.toThrow('before T46');
  expect(source.fetchMedia).not.toHaveBeenCalled();
});

it('rejects valid but unmarked media even when dispatch declares a marker', async () => {
  const raw = (await markingFixtures()).image;
  source.fetchMedia.mockImplementation(async (ref) => (ref.endsWith('.mp4') ? video : raw));
  await expect(run()).rejects.toThrow('marking failed');
  expect(git.commit).not.toHaveBeenCalled();
});
