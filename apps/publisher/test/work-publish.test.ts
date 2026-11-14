import { TelegramAdapter } from '@handmake/channels';
import { deliverWorkVideo } from '../src/work-video';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { ChannelRegistry, idempotencyBase, parseCollection, parseWork } from '@handmake/core';
import type { Collection, PublishedCallbackBody, WorkPublication } from '@handmake/core';
import { FakeChannelAdapter, FakeNotifier } from '@handmake/core/testing';
import { GitRepoContentStore } from '@handmake/stores';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runPublish } from '../src/publish';
import { runDryRun } from '../src/dry-run';
import type { DispatchPayload } from '../src/payload';
import { writeTelegramOnlyTenantConfig } from './helpers/tenant-config';

const tenantId = 'faden-und-stimmung';
const id = '01JBCA1B2C3D4E5F6G7H8J9K0M';
const work: WorkPublication = {
  date: '2026-11-01T10:00:00Z',
  kind: 'interior',
  collection: 'fixture',
  channels: [],
  versions: {
    uk: {
      description: 'UA fixture',
      provenance: 'ai-assisted',
      model: 'fixture-model',
      prompt: 'fixture@1',
    },
    de: {
      description: 'DE fixture',
      provenance: 'ai-generated',
      model: 'fixture-model',
      prompt: 'fixture@1',
    },
  },
  newCollection: {
    order: 1,
    versions: {
      uk: { title: 'UA fixture', description: 'UA collection fixture', provenance: 'human' },
      de: { title: 'DE fixture', description: 'DE collection fixture', provenance: 'human' },
    },
  },
};
const payload: DispatchPayload = {
  tenantId,
  draftId: id,
  kind: 'work',
  type: 'free',
  fileIds: ['opaque-photo'],
  texts: { uk: 'UA fixture', de: 'DE fixture' },
  provenance: 'human',
  work,
};
const exec = promisify(execFile);
let root: string;
let payloadPath: string;
let current: DispatchPayload;
let store: GitRepoContentStore;
const source = { fetchPhoto: vi.fn<() => Promise<Uint8Array>>() };
const git = {
  commit: vi.fn(async (_paths: string[], _message: string) => true),
  push: vi.fn(async (_ref: string) => {}),
};
const callback = { send: vi.fn(async (_body: PublishedCallbackBody) => {}) };
const deps = () => ({
  root,
  env: {
    PUBLISH_CALLBACK_URL: 'https://example.invalid/callback',
    PUBLISH_CALLBACK_SECRET: 'fixture-callback',
  },
  git,
  callback,
  mediaSource: source,
  notifier: new FakeNotifier(),
  logger: () => {},
});
const run = async (overrides = {}) => {
  await writeFile(payloadPath, JSON.stringify(current));
  return runPublish(payloadPath, { ...deps(), ...overrides });
};
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'handmake-work-publish-'));
  payloadPath = path.join(root, 'payload.json');
  await writeTelegramOnlyTenantConfig(path.join(root, 'config/tenants'));
  store = new GitRepoContentStore({ rootDir: root });
  current = structuredClone(payload);
  source.fetchPhoto
    .mockReset()
    .mockResolvedValue(
      new Uint8Array(await readFile(new URL('./fixtures/with-gps-exif.jpg', import.meta.url))),
    );
  git.commit.mockClear();
  callback.send.mockClear();
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('approved work publishing', () => {
  it('writes work/photos/collection, preserves provenance and completes site-only work on retries', async () => {
    const first = await run();
    expect(first.work?.versions).toEqual(work.versions);
    expect(first.post.channels).toEqual([]);
    expect(await store.readWork(tenantId, id)).toEqual(first.work);
    const collection = await store.readCollection(tenantId, 'fixture');
    expect(collection?.cover).toEqual({ workId: id, fileName: 'photo-1.jpg' });
    expect(collection?.versions).toEqual(work.newCollection!.versions);
    const photo = await store.readWorkPhoto(tenantId, id, 'photo-1.jpg');
    const metadata = await sharp(photo!).metadata();
    expect(metadata.format).toBe('jpeg');
    expect(metadata.exif).toBeUndefined();
    expect(git.commit.mock.calls[0]![0]).toEqual([
      `content/works/${id}`,
      'content/collections/fixture.md',
    ]);
    expect(await store.readLedger(tenantId, id)).toMatchObject({ channels: {} });
    await run({ now: new Date('2026-12-01T10:00:00Z') });
    expect(await readdir(path.join(root, 'content/works'))).toEqual([id]);
    expect(await store.listPosts(tenantId)).toEqual([]);
    expect(callback.send).toHaveBeenCalledTimes(2);
    expect(callback.send.mock.calls[0]![0]).toMatchObject({
      kind: 'work',
      postId: id,
      date: work.date,
      channels: {},
    });
  });

  it('persists test exclusion and keeps it on retry without the environment flag', async () => {
    const first = await run({ env: { ...deps().env, SITE_EXCLUDE_POST: 'true' } });
    expect(first.work?.siteExcluded).toBe(true);
    expect(first.post.siteExcluded).toBe(true);
    expect((await store.readWork(tenantId, id))?.siteExcluded).toBe(true);
    await run();
    expect((await store.readWork(tenantId, id))?.siteExcluded).toBe(true);
    current.work!.versions.de!.description = 'Changed identity';
    current.texts.de = 'Changed identity';
    await expect(run()).rejects.toThrow('immutable');
  });

  it('commits a new collection and its first work together in a real Git commit', async () => {
    await exec('git', ['init', '-q'], { cwd: root });
    await run({ git: undefined });
    const log = (await exec('git', ['log', '--reverse', '--format=%H'], { cwd: root })).stdout
      .trim()
      .split('\n');
    const files = (await exec('git', ['show', '--format=', '--name-only', log[0]!], { cwd: root }))
      .stdout;
    expect(files).toContain(`content/works/${id}/index.md`);
    expect(files).toContain('content/collections/fixture.md');
    const index = await readFile(path.join(root, `content/works/${id}/index.md`), 'utf8');
    expect(parseWork(index).id).toBe(id);
    expect(
      parseCollection(await readFile(path.join(root, 'content/collections/fixture.md'), 'utf8'))
        .cover.workId,
    ).toBe(id);
  });

  it('resumes only undelivered announcement operations and skips the completed channel on retry', async () => {
    current.work!.channels = ['telegram'];
    const adapter = new FakeChannelAdapter({
      key: 'telegram',
      renderImpl: () => [
        { kind: 'message', text: 'Fixture 1', lang: 'uk' },
        { kind: 'message', text: 'Fixture 2', lang: 'de' },
      ],
    });
    const registry = new ChannelRegistry();
    registry.register(adapter);
    const deliver = vi.spyOn(adapter, 'deliver');
    deliver.mockImplementationOnce(async (_ops, _ctx, progress) => {
      await progress!.onDelivered(0, 'known-first');
      throw new Error('temporary failure');
    });
    await expect(run({ registry })).rejects.toThrow('temporary failure');
    expect(callback.send).not.toHaveBeenCalled();
    expect(await store.readLedger(tenantId, id)).toMatchObject({
      channels: { telegram: { status: 'failed', remoteIds: ['known-first'] } },
    });
    const second = await run({ registry });
    expect(deliver.mock.calls[1]![2]?.startAt).toBe(1);
    expect(adapter.progressCalls.map((call) => call.opIndex)).toEqual([1]);
    expect(second.post.versions).toMatchObject({
      uk: { provenance: 'ai-assisted' },
      de: { provenance: 'ai-generated' },
    });
    expect((await run({ registry })).skipped).toEqual(['telegram']);
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(await store.listPosts(tenantId)).toEqual([]);
  });

  it('reuses an existing collection without changing its cover or metadata', async () => {
    const existing: Collection = {
      tenant: tenantId,
      slug: 'fixture',
      ...work.newCollection!,
      cover: { workId: '01JBCA1B2C3D4E5F6G7H8J9K0Z', fileName: 'earlier.jpg' },
    };
    await store.saveCollection(existing);
    delete current.work!.newCollection;
    await run();
    expect(await store.readCollection(tenantId, 'fixture')).toEqual(existing);
    expect(git.commit.mock.calls[0]![0]).toEqual([`content/works/${id}`]);
  });

  it.each(['missing', 'foreign', 'conflicting'] as const)(
    'refuses a %s collection without delivering',
    async (scenario) => {
      if (scenario !== 'missing')
        await store.saveCollection({
          tenant: scenario === 'foreign' ? 'other' : tenantId,
          slug: 'fixture',
          ...work.newCollection!,
          cover: { workId: '01JBCA1B2C3D4E5F6G7H8J9K0Z', fileName: 'earlier.jpg' },
        });
      if (scenario !== 'conflicting') delete current.work!.newCollection;
      await expect(run()).rejects.toThrow(/collection/);
      expect(source.fetchPhoto).not.toHaveBeenCalled();
      expect(callback.send).not.toHaveBeenCalled();
      expect(await store.readWork(tenantId, id)).toBeUndefined();
    },
  );

  it('rejects new collection data that would overwrite a foreign tenant', async () => {
    await store.saveCollection({
      tenant: 'other',
      slug: 'fixture',
      ...work.newCollection!,
      cover: { workId: id, fileName: 'photo-1.jpg' },
    });
    await expect(run()).rejects.toThrow(/another tenant/);
    expect(await store.readWork(tenantId, id)).toBeUndefined();
    expect(git.commit).not.toHaveBeenCalled();
    expect(callback.send).not.toHaveBeenCalled();
  });

  it.each(['languages', 'collection-languages', 'disabled-channel', 'inherited-channel'] as const)(
    'rejects invalid %s before media fetch or writes',
    async (scenario) => {
      if (scenario === 'languages') {
        delete current.texts['de'];
        delete current.work!.versions['de'];
      } else if (scenario === 'collection-languages') {
        delete current.work!.newCollection!.versions['de'];
      } else current.work!.channels = [scenario === 'disabled-channel' ? 'unknown' : 'toString'];
      await expect(run()).rejects.toThrow();
      expect(source.fetchPhoto).not.toHaveBeenCalled();
      expect(git.commit).not.toHaveBeenCalled();
    },
  );

  it('refuses modified text or announcement choices on a repeated identity', async () => {
    await run();
    source.fetchPhoto.mockClear();
    current.texts['uk'] = 'Changed';
    current.work!.versions['uk']!.description = 'Changed';
    await expect(run()).rejects.toThrow(/immutable/);
    current = structuredClone(payload);
    current.work!.channels = ['telegram'];
    await expect(run()).rejects.toThrow(/immutable/);
    expect(source.fetchPhoto).not.toHaveBeenCalled();
  });
});

it('dry-runs a site-only work entirely into a temporary output folder', async () => {
  await writeFile(payloadPath, JSON.stringify(current));
  const result = await runDryRun(payloadPath, {
    root,
    tempDir: path.join(root, 'dry-output'),
    mediaSource: source,
    env: {},
    logger: () => {},
  });
  expect(result.work?.id).toBe(id);
  expect(result.ops).toEqual([]);
  expect(parseWork(await readFile(path.join(result.postDir, 'index.md'), 'utf8')).versions).toEqual(
    work.versions,
  );
  expect(await store.readWork(tenantId, id)).toBeUndefined();
  expect(await store.readCollection(tenantId, 'fixture')).toBeUndefined();
  expect(git.commit).not.toHaveBeenCalled();
  expect(callback.send).not.toHaveBeenCalled();
});

it('rejects collisions with a regular post before fetching photos', async () => {
  await store.savePost(
    {
      id,
      tenant: tenantId,
      date: work.date,
      publishAt: 'now',
      type: 'free',
      photos: [],
      channels: [],
      texts: current.texts,
      versions: { uk: { provenance: 'human' }, de: { provenance: 'human' } },
    },
    [],
  );
  await expect(run()).rejects.toThrow(/already belongs to a post/);
  expect(source.fetchPhoto).not.toHaveBeenCalled();
});

it('retries a failed completion callback without announcing the work twice', async () => {
  current.work!.channels = ['telegram'];
  const adapter = new FakeChannelAdapter({
    key: 'telegram',
    renderImpl: () => [{ kind: 'message', text: 'Fixture', lang: 'uk' }],
  });
  const registry = new ChannelRegistry();
  registry.register(adapter);
  callback.send.mockRejectedValueOnce(new Error('callback unavailable'));
  await run({ registry });
  await run({ registry });
  expect(adapter.deliveries).toHaveLength(1);
  expect(callback.send).toHaveBeenCalledTimes(2);
});

it('stores cleaned video, replies after photos, and retries only the failed video', async () => {
  const file = path.join(root, 'input.mov');
  await exec('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=s=16x16:r=1',
    '-t',
    '1',
    '-c:v',
    'libx264',
    '-threads',
    '1',
    '-metadata',
    'location=+48.5+012.1/',
    file,
  ]);
  current.work!.videoFileId = 'opaque-video';
  current.work!.videoPeople = 'author';
  current.work!.channels = ['telegram'];
  const videoSource = { fetchMedia: vi.fn(async () => new Uint8Array(await readFile(file))) };
  const adapter = new FakeChannelAdapter({
    key: 'telegram',
    renderImpl: () => [
      { kind: 'mediaGroup', photoIndexes: [0] },
      { kind: 'message', text: 'DE', lang: 'de', replyToOp: 0 },
    ],
  });
  const registry = new ChannelRegistry();
  registry.register(adapter);
  await writeFile(payloadPath, JSON.stringify(current));
  const initialDry = await runDryRun(payloadPath, {
    root,
    tempDir: path.join(root, 'first-dry'),
    mediaSource: source,
    showMediaSource: videoSource,
    env: {},
    logger: () => {},
  });
  expect(initialDry.work?.video?.people).toBe('author');
  expect((await readFile(path.join(initialDry.postDir, 'video.mp4'))).length).toBeGreaterThan(0);
  expect(await store.readWork(tenantId, id)).toBeUndefined();
  videoSource.fetchMedia.mockClear();
  const original = adapter.deliver.bind(adapter);
  const deliver = vi.spyOn(adapter, 'deliver');
  deliver.mockImplementation(async (ops, ctx, progress) => {
    if (ctx.video) throw new Error('video unavailable');
    return original(ops, ctx, progress);
  });
  await expect(run({ registry, showMediaSource: videoSource })).rejects.toThrow('відео');
  expect((await store.readWork(tenantId, id))?.video).toEqual({
    fileName: 'video.mp4',
    provenance: 'human',
    people: 'author',
  });
  const saved = await store.readWorkVideo(tenantId, id);
  expect(saved?.length).toBeGreaterThan(0);
  expect(await store.readLedger(tenantId, `${id}-video`)).toMatchObject({
    channels: { telegram: { status: 'failed' } },
  });
  const ledgerPaths = (await readdir(path.join(root, 'content/ledger'))).map((name) =>
    path.join('content', 'ledger', name),
  );
  expect(ledgerPaths).toContain(path.join('content', 'ledger', `${id}-video.json`));
  expect(ledgerPaths.every((ledgerPath) => !ledgerPath.includes(':'))).toBe(true);
  expect(git.commit).toHaveBeenCalledWith(
    [path.join('content', 'ledger', `${id}-video.json`)],
    expect.any(String),
  );
  deliver.mockImplementation(original);
  await run({ registry, showMediaSource: videoSource });
  const call = deliver.mock.calls.at(-1)!;
  expect(call[0][1]).toEqual({ kind: 'video', replyToOp: 0 });
  expect(call[2]).toMatchObject({
    startAt: 1,
    knownIds: [(await store.readLedger(tenantId, id))!.channels.telegram!.remoteIds[0]],
  });
  expect(call[1].video).toEqual(saved);
  expect(call[1].idempotencyBase).toBe(idempotencyBase(tenantId, `${id}-video`, 'telegram'));
  expect(videoSource.fetchMedia).toHaveBeenCalledTimes(1);
  const count = deliver.mock.calls.length;
  await run({ registry, showMediaSource: videoSource });
  expect(deliver).toHaveBeenCalledTimes(count);
  await writeFile(payloadPath, JSON.stringify(current));
  const dry = await runDryRun(payloadPath, {
    root,
    tempDir: path.join(root, 'dry-video'),
    mediaSource: source,
    env: {},
    logger: () => {},
  });
  expect(dry.ops.at(-1)).toEqual({ kind: 'video', replyToOp: 0 });
  expect(await readFile(path.join(dry.postDir, 'video.mp4'))).toEqual(Buffer.from(saved!));
});

it('informs the author when the saved video cannot be found for retry', async () => {
  const result = await run();
  await store.saveWork(
    { ...result.work!, video: { fileName: 'video.mp4', provenance: 'human', people: 'none' } },
    [],
  );
  current.work!.videoFileId = 'opaque-video';
  current.work!.videoPeople = 'none';
  const notifier = new FakeNotifier();
  git.commit.mockClear();
  await expect(run({ notifier })).rejects.toThrow('Published work video is missing');
  expect(notifier.messages).toEqual([
    { target: 'author', message: 'Не вдалося знайти відео для повторної публікації.' },
  ]);
  expect(git.commit).not.toHaveBeenCalled();
});

it('rejects a long video before writing content or committing and informs the author', async () => {
  const file = path.join(root, 'long.mp4');
  await exec('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=s=16x16:r=1',
    '-t',
    '61',
    '-c:v',
    'libx264',
    '-threads',
    '1',
    file,
  ]);
  current.work!.videoFileId = 'long';
  current.work!.videoPeople = 'none';
  const notifier = new FakeNotifier();
  await expect(
    run({
      notifier,
      showMediaSource: { fetchMedia: async () => new Uint8Array(await readFile(file)) },
    }),
  ).rejects.toThrow('60');
  expect(git.commit).not.toHaveBeenCalled();
  expect(await store.readWork(tenantId, id)).toBeUndefined();
  expect(await store.readCollection(tenantId, 'fixture')).toBeUndefined();
  expect(notifier.messages).toHaveLength(1);
});

it('uploads the Telegram video as a reply to the recorded album and skips a completed ledger', async () => {
  const result = await run();
  const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
    const form = init!.body as FormData;
    expect(JSON.parse(String(form.get('reply_parameters')))).toEqual({ message_id: 101 });
    expect(form.get('video')).toBeInstanceOf(Blob);
    return Response.json({ ok: true, result: { message_id: 102 } });
  });
  const adapter = new TelegramAdapter({ token: 'fixture', fetchImpl });
  const ledger = {
    tenantId,
    postId: id,
    channels: {
      telegram: { status: 'done' as const, remoteIds: [101, 103], updatedAt: work.date },
    },
  };
  const context = {
    photos: [],
    settings: { channelId: 'CHAT' },
    secrets: { resolve: async () => 'chat' },
    idempotencyBase: '',
  };
  const persist = async (value: import('@handmake/core').PublishLedger) => store.writeLedger(value);
  for (let i = 0; i < 2; i++)
    await deliverWorkVideo(
      result.work!,
      new Uint8Array([1]),
      ledger,
      adapter,
      context,
      store,
      persist,
      new Date(),
    );
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(String(fetchImpl.mock.calls[0]![0])).toContain('/sendVideo');
});

it('retries only the Instagram Reel with its caption and separate channel ledger', async () => {
  const result = await run();
  const { InstagramAdapter } = await import('@handmake/channels');
  let fail = true;
  const requests: Array<{ url: string; body?: Record<string, unknown> }> = [];
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    requests.push({ url, ...(typeof init?.body === 'string' && { body: JSON.parse(init.body) }) });
    if (url.includes('rupload.')) return Response.json({ success: !fail });
    if (url.includes('media_publish')) return Response.json({ id: 'reel-id' });
    if (url.includes('fields=status_code')) return Response.json({ status_code: 'FINISHED' });
    return Response.json({ id: 'container-id' });
  });
  const adapter = new InstagramAdapter({ fetchImpl });
  const photosLedger = {
    tenantId,
    postId: id,
    channels: {
      instagram: { status: 'done' as const, remoteIds: ['photos-id'], updatedAt: work.date },
    },
  };
  const context = {
    photos: [],
    settings: { language: 'de' },
    idempotencyBase: '',
    secrets: { resolve: async () => 'fixture' },
  };
  const persist = async (value: import('@handmake/core').PublishLedger) => store.writeLedger(value);
  await store.writeLedger({
    ...photosLedger,
    postId: `${id}-video`,
    channels: { telegram: { status: 'done', remoteIds: [123], updatedAt: work.date } },
  });
  const send = () =>
    deliverWorkVideo(
      result.work!,
      new Uint8Array([1]),
      photosLedger,
      adapter,
      context,
      store,
      persist,
      new Date(),
      'Same photo caption',
    );
  await expect(send()).rejects.toThrow('відео');
  expect(await store.readLedger(tenantId, `${id}-video`)).toMatchObject({
    channels: { instagram: { status: 'failed' } },
  });
  fail = false;
  await send();
  expect(await store.readLedger(tenantId, `${id}-video`)).toMatchObject({
    channels: { instagram: { status: 'done', remoteIds: ['reel-id'] } },
  });
  const count = requests.length;
  await send();
  expect(requests).toHaveLength(count);
  expect(
    requests
      .filter((request) => request.body?.media_type === 'REELS')
      .map((request) => request.body?.caption),
  ).toEqual(['Same photo caption', 'Same photo caption']);
  expect(requests.some((request) => request.body?.image_url)).toBe(false);
  expect(photosLedger.channels.instagram.remoteIds).toEqual(['photos-id']);
  expect((await store.readLedger(tenantId, `${id}-video`))?.channels.telegram?.remoteIds).toEqual([
    123,
  ]);
});

it.each(['instagram', 'facebook'])(
  'wires the %s caption and resumes only its failed video',
  async (channel) => {
    await writeFile(
      path.join(root, 'config/tenants/faden-und-stimmung.yaml'),
      await readFile(new URL('../../../config/tenants/faden-und-stimmung.yaml', import.meta.url)),
    );
    const file = path.join(root, 'input.mp4');
    await exec('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=s=16x16:r=1',
      '-t',
      '1',
      '-c:v',
      'libx264',
      '-threads',
      '1',
      file,
    ]);
    current.work!.channels = [channel];
    current.work!.videoFileId = 'opaque-video';
    current.work!.videoPeople = 'none';
    const videoSource = { fetchMedia: vi.fn(async () => new Uint8Array(await readFile(file))) };
    const adapter = new FakeChannelAdapter({
      key: channel,
      renderImpl: () => [{ kind: 'mediaGroup', photoIndexes: [0], caption: 'Work caption' }],
    });
    const registry = new ChannelRegistry();
    registry.register(adapter);
    const original = adapter.deliver.bind(adapter);
    const deliver = vi.spyOn(adapter, 'deliver').mockImplementation(async (ops, ctx, progress) => {
      if (ctx.video) throw new Error('fixture upload rejected');
      return original(ops, ctx, progress);
    });
    const overrides = {
      ...deps(),
      registry,
      showMediaSource: videoSource,
      env: { ...deps().env, CONTENT_RAW_BASE_URL: 'https://raw.example/content' },
    };
    await expect(run(overrides)).rejects.toThrow('відео');
    expect((await store.readLedger(tenantId, id))?.channels[channel]?.status).toBe('done');
    deliver.mockImplementation(original);
    await run(overrides);
    expect(deliver.mock.calls.at(-1)![0]).toEqual([{ kind: 'video', caption: 'Work caption' }]);
    expect(deliver.mock.calls.at(-1)![2]).toMatchObject({ startAt: 0, knownIds: [] });
    expect(videoSource.fetchMedia).toHaveBeenCalledTimes(1);
    expect(deliver.mock.calls.filter(([ops]) => ops[0]?.kind === 'mediaGroup')).toHaveLength(1);
    const count = deliver.mock.calls.length;
    await run(overrides);
    expect(deliver).toHaveBeenCalledTimes(count);
  },
);

it('keeps the Threads work video last in a single carousel ledger entry', async () => {
  await writeFile(
    path.join(root, 'config/tenants/faden-und-stimmung.yaml'),
    await readFile(new URL('../../../config/tenants/faden-und-stimmung.yaml', import.meta.url)),
  );
  const file = path.join(root, 'input.mp4');
  await exec('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=s=16x16:r=1',
    '-t',
    '1',
    '-c:v',
    'libx264',
    '-threads',
    '1',
    file,
  ]);

  current.work!.channels = ['threads'];
  current.work!.videoFileId = 'opaque-video';
  current.work!.videoPeople = 'none';
  const videoSource = { fetchMedia: vi.fn(async () => new Uint8Array(await readFile(file))) };
  const { createThreadsAdapter } = await import('@handmake/channels');
  let created = 100;
  let rejectVideo = true;
  const writes: URLSearchParams[] = [];
  const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
    if (init?.method === 'GET') return new Response(JSON.stringify({ status: 'FINISHED' }));
    const params = new URLSearchParams(String(init?.body));
    writes.push(params);
    if (rejectVideo && params.get('media_type') === 'VIDEO')
      return new Response(JSON.stringify({ error: { code: 100 } }), { status: 400 });
    return new Response(JSON.stringify({ id: String(++created) }));
  });
  const registry = new ChannelRegistry();
  registry.register(createThreadsAdapter({ fetchImpl }));
  const overrides = {
    ...deps(),
    registry,
    showMediaSource: videoSource,
    secrets: {
      resolve: async (name: string) => (name === 'THREADS_USER_ID' ? '123' : 'fixture-token'),
    },
    env: { ...deps().env, CONTENT_RAW_BASE_URL: 'https://raw.example/repo' },
  };
  await expect(run(overrides)).rejects.toThrow();
  expect((await store.readLedger(tenantId, id))?.channels.threads?.status).toBe('failed');
  expect(writes.some((p) => p.has('creation_id'))).toBe(false);
  rejectVideo = false;
  await run(overrides);
  const video = writes.filter((p) => p.get('media_type') === 'VIDEO').at(-1)!;
  expect(video.get('video_url')).toBe(`https://raw.example/repo/content/works/${id}/video.mp4`);
  expect(writes.filter((p) => p.has('creation_id'))).toHaveLength(1);
  expect((await store.readLedger(tenantId, id))?.channels.threads).toMatchObject({
    status: 'done',
    remoteIds: [String(created)],
  });
  expect(await store.readLedger(tenantId, `${id}-video`)).toBeUndefined();
  const count = fetchImpl.mock.calls.length;
  await run(overrides);
  expect(fetchImpl).toHaveBeenCalledTimes(count);
  expect(videoSource.fetchMedia).toHaveBeenCalledTimes(1);
});
