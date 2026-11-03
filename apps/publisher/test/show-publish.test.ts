import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { ChannelRegistry, showSchema } from '@handmake/core';
import type { PublishedCallbackBody, Show, Work } from '@handmake/core';
import { GitRepoContentStore } from '@handmake/stores';
import { markingFixtures } from './fixtures/show-marking';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parseDispatchPayload } from '../src/payload';
import type { DispatchPayload } from '../src/payload';
import { runPublish } from '../src/publish';
import { runCopyShow } from '../src/copy-show';
import { TelegramAdapter } from '@handmake/channels';

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
  vi.restoreAllMocks();
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
it('rejects changed approved content and reuses stored media after draft references expire', async () => {
  await run();
  show.video.promptVersion = 'changed@2';
  await expect(run()).rejects.toThrow('immutable');
  show.video.promptVersion = 'interior@1';
  source.fetchMedia.mockClear().mockRejectedValue(new Error('expired'));
  await run();
  expect(source.fetchMedia).not.toHaveBeenCalled();
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
  await expect(run()).rejects.toThrow('without published content');
  expect(source.fetchMedia).not.toHaveBeenCalled();
});

it('rejects valid but unmarked media even when dispatch declares a marker', async () => {
  const raw = (await markingFixtures()).image;
  source.fetchMedia.mockImplementation(async (ref) => (ref.endsWith('.mp4') ? video : raw));
  await expect(run()).rejects.toThrow('marking failed');
  expect(git.commit).not.toHaveBeenCalled();
});

function copies() {
  const requests: { method: string; body: FormData }[] = [];
  let failVideo = true;
  const fetchImpl = vi.fn(async (url: unknown, init?: RequestInit) => {
    const method = String(url).split('/').at(-1)!;
    const body = init!.body instanceof FormData ? init!.body : new FormData();
    if (typeof init!.body === 'string')
      for (const [key, value] of Object.entries(JSON.parse(init!.body)))
        body.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    requests.push({ method, body });
    if (method === 'sendVideo' && failVideo) throw new Error('network interrupted');
    return new Response(
      JSON.stringify({
        ok: true,
        result:
          method === 'sendMediaGroup'
            ? [{ message_id: 101 }, { message_id: 102 }, { message_id: 103 }]
            : { message_id: 200 + requests.length },
      }),
    );
  });
  const registry = new ChannelRegistry();
  const adapter = new TelegramAdapter({ token: 'fixture', fetchImpl });
  const render = vi.spyOn(adapter, 'renderShow');
  registry.register(adapter);
  const notifier = { notify: vi.fn(async () => {}) };
  const copy = (overrides = {}) =>
    runCopyShow(show.tenant, show.id, {
      root,
      git,
      registry,
      notifier,
      callback,
      env: {},
      secrets: { resolve: async (name) => name },
      ...overrides,
    });
  return {
    copy,
    requests,
    render,
    notifier,
    succeed: () => {
      failVideo = false;
    },
  };
}

it('copies stored bytes, commits progress, resumes the saved plan and skips completed channels', async () => {
  const exec = promisify(execFile);
  await exec('git', ['init', '-q'], { cwd: root });
  await run({ git: undefined });
  source.fetchMedia.mockClear().mockRejectedValue(new Error('expired'));
  callback.send.mockClear();
  const c = copies();
  await expect(c.copy({ git: undefined })).rejects.toThrow('interrupted');
  expect(c.requests.map((r) => r.method)).toEqual(['sendMediaGroup', 'sendVideo']);
  const partial = await store.readLedger(show.tenant, show.id);
  expect(partial!.channels.telegram).toMatchObject({ status: 'failed', remoteIds: [101] });
  expect(partial!.showCopyPlan).toBeDefined();
  expect(c.notifier.notify).toHaveBeenCalledWith(
    'operator',
    expect.stringContaining('copy failed'),
  );
  expect(callback.send).not.toHaveBeenCalled();
  expect(await store.readShow(show.tenant, show.id)).toEqual(show);
  const album = c.requests[0]!.body;
  const uploaded = [...album.values()].filter((value): value is File => typeof value !== 'string');
  expect(uploaded).toHaveLength(3);
  for (const file of uploaded) expect(new Uint8Array(await file.arrayBuffer())).toEqual(image);
  const config = path.join(root, 'config/tenants/faden-und-stimmung.yaml');
  const yaml = await readFile(config, 'utf8');
  await writeFile(
    config,
    yaml
      .replace('https://fadenundstimmung.de', 'https://changed.example')
      .replace('TELEGRAM_CHANNEL_ID', 'CHANGED_CHANNEL_ID')
      .replace('languages: [uk, de]', 'languages: [de, uk]'),
  );
  c.render.mockImplementation(() => {
    throw new Error('must reuse plan');
  });
  c.succeed();
  const done = await c.copy({ git: undefined });
  expect(done.ledger.showCopyPlan).toEqual(partial!.showCopyPlan);
  expect(c.requests.map((r) => r.method)).toEqual([
    'sendMediaGroup',
    'sendVideo',
    'sendVideo',
    'sendMessage',
  ]);
  expect(c.requests[2]!.body.get('reply_parameters')).toContain('101');
  const videoFile = c.requests[2]!.body.get('video') as File;
  expect(new Uint8Array(await videoFile.arrayBuffer())).toEqual(video);
  expect(c.requests[2]!.body.get('chat_id')).toBe('TELEGRAM_CHANNEL_ID');
  expect(c.requests[3]!.body.get('text')).not.toContain('changed.example');
  expect((await c.copy({ git: undefined })).skipped).toEqual(['telegram']);
  expect(c.requests).toHaveLength(4);
  await run({ git: undefined });
  expect(callback.send).toHaveBeenCalledWith(
    expect.objectContaining({ kind: 'show', channels: {} }),
  );
  expect(source.fetchMedia).not.toHaveBeenCalled();
  expect((await store.readLedger(show.tenant, show.id))!.channels.telegram!.status).toBe('done');
  const tracked = (await exec('git', ['ls-files'], { cwd: root })).stdout.trim().split('\n');
  expect(tracked.every((file) => file.startsWith('content/'))).toBe(true);
}, 30_000);

it('keeps site publication retryable while channel copies remain failed', async () => {
  await run();
  const c = copies();
  await expect(c.copy()).rejects.toThrow();
  source.fetchMedia.mockClear().mockRejectedValue(new Error('expired'));
  callback.send.mockClear();
  await run();
  expect(callback.send).toHaveBeenCalledWith(
    expect.objectContaining({ channels: {}, kind: 'show' }),
  );
  expect((await store.readLedger(show.tenant, show.id))!.channels.telegram!.status).toBe('failed');
  expect(source.fetchMedia).not.toHaveBeenCalled();
});

it.each(['commit', 'operation-commit', 'write'] as const)(
  'resumes after an interrupted operation %s',
  async (failure) => {
    await run();
    const c = copies();
    c.succeed();
    if (failure === 'commit') git.commit.mockRejectedValueOnce(new Error('initial commit failed'));
    else if (failure === 'operation-commit')
      git.commit
        .mockResolvedValueOnce(true)
        .mockRejectedValueOnce(new Error('operation commit failed'));
    else {
      const original = GitRepoContentStore.prototype.writeLedger;
      const write = vi.spyOn(GitRepoContentStore.prototype, 'writeLedger');
      // Initial plan persists; the first operation write fails once.
      write
        .mockImplementationOnce(async function (this: GitRepoContentStore, ledger) {
          return original.call(this, ledger);
        })
        .mockRejectedValueOnce(new Error('operation write failed'));
    }
    await expect(c.copy()).rejects.toThrow();
    const firstCount = c.requests.filter((r) => r.method === 'sendMediaGroup').length;
    await c.copy();
    expect(c.requests.filter((r) => r.method === 'sendMediaGroup')).toHaveLength(
      failure === 'commit' ? 1 : firstCount,
    );
    vi.restoreAllMocks();
  },
);

it.each([
  'missing-show',
  'tenant',
  'missing-media',
  'unmarked',
  'prefix',
  'done-prefix',
  'plan',
  'hash',
  'foreign-ledger',
  'identity',
  'channels',
  'reply',
  'index',
] as const)('rejects %s before sending', async (failure) => {
  await run();
  const c = copies();
  if (failure === 'missing-show') await rm(path.join(root, `content/shows/${show.id}/index.md`));
  else if (failure === 'tenant') {
    await expect(runCopyShow('other', show.id, { root, git })).rejects.toThrow('tenant');
    expect(c.requests).toEqual([]);
    return;
  } else if (failure === 'missing-media')
    await rm(path.join(root, `content/shows/${show.id}/clip.mp4`));
  else if (failure === 'unmarked')
    await writeFile(
      path.join(root, `content/shows/${show.id}/image-0.png`),
      (await markingFixtures()).image,
    );
  else if (failure === 'foreign-ledger') {
    await writeFile(
      path.join(root, `content/ledger/${show.id}.json`),
      JSON.stringify({ tenantId: 'other', postId: show.id, channels: {} }),
    );
  } else {
    await expect(c.copy()).rejects.toThrow();
    const ledger = (await store.readLedger(show.tenant, show.id))!;
    if (failure === 'prefix') ledger.channels.telegram!.remoteIds = Array(20).fill(1);
    if (failure === 'done-prefix') ledger.channels.telegram!.status = 'done';
    if (failure === 'plan') delete ledger.showCopyPlan;
    if (failure === 'hash') ledger.showCopyPlan!.mediaHashes[0] = '0'.repeat(64);
    if (failure === 'identity') ledger.postId = show.workId;
    if (failure === 'channels') delete ledger.channels.telegram;
    if (failure === 'reply') ledger.showCopyPlan!.channels.telegram!.operations[1]!.replyToOp = 1;
    if (failure === 'index') {
      const op = ledger.showCopyPlan!.channels.telegram!.operations[0]!;
      if (op.kind === 'mediaGroup') op.photoIndexes = [99];
    }
    if (failure === 'identity')
      await writeFile(path.join(root, `content/ledger/${show.id}.json`), JSON.stringify(ledger));
    else await store.writeLedger(ledger);
    c.requests.length = 0;
  }
  await expect(c.copy()).rejects.toThrow();
  expect(c.requests).toEqual([]);
});
