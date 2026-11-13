import { execFile } from 'node:child_process';
import sharp from 'sharp';
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
import { writeTelegramOnlyTenantConfig } from './helpers/tenant-config';
import { TelegramAdapter } from '@handmake/channels';
import { parse } from 'yaml';

let root: string,
  payloadPath: string,
  show: Show,
  store: GitRepoContentStore,
  payload: DispatchPayload;
let image: Uint8Array;
let video: Uint8Array;
const source = { fetchMedia: vi.fn<(ref: string) => Promise<Uint8Array>>() };
const git = {
  commit: vi.fn(async (_paths: string[], _message: string) => true),
  push: vi.fn(async (_ref: string) => {}),
};
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
  await writeTelegramOnlyTenantConfig(path.join(root, 'config/tenants'));
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
it('persists show exclusion and keeps it on retries without the environment flag', async () => {
  const first = await run({ env: { SITE_EXCLUDE_POST: 'true' } });
  expect(first.show?.siteExcluded).toBe(true);
  expect(first.post.siteExcluded).toBe(true);
  await run();
  expect((await store.readShow(show.tenant, show.id))?.siteExcluded).toBe(true);
  payload.show!.show.versions.de!.description = 'Changed identity';
  payload.texts.de = 'Changed identity';
  await expect(run()).rejects.toThrow('immutable');
});
it('can exclude an already published show without changing its approved identity', async () => {
  await run();
  await run({ env: { SITE_EXCLUDE_POST: 'true' } });
  await run();
  expect((await store.readShow(show.tenant, show.id))?.siteExcluded).toBe(true);
});
it('excludes a show linked to a test work even without the environment flag', async () => {
  const work = (await store.readWork(show.tenant, show.workId))!;
  await store.saveWork({ ...work, siteExcluded: true }, []);
  expect((await run()).show?.siteExcluded).toBe(true);
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

it('requires a Telegram token only when downloading an unpublished show', async () => {
  await expect(run({ showMediaSource: undefined })).rejects.toThrow(
    'missing environment variable TELEGRAM_BOT_TOKEN',
  );
  expect(git.commit).not.toHaveBeenCalled();
  await run();
  await expect(run({ showMediaSource: undefined })).resolves.toMatchObject({ show });
});

it('fails all copies before delivery when a configured adapter lacks show support', async () => {
  await run();
  const c = copies();
  const registry = new ChannelRegistry();
  const adapter = new TelegramAdapter({ token: 'fixture' });
  Object.defineProperty(adapter, 'renderShow', { value: undefined });
  const deliver = vi.spyOn(adapter, 'deliver');
  registry.register(adapter);
  await expect(c.copy({ registry })).rejects.toThrow('does not support shows');
  expect(deliver).not.toHaveBeenCalled();
  expect((await store.readLedger(show.tenant, show.id))!.showCopyPlan).toBeUndefined();
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

it('pushes failed progress with the CI shell and resumes from a fresh checkout', async () => {
  const exec = promisify(execFile);
  await exec('git', ['init', '-q', '-b', 'main'], { cwd: root });
  await run({ git: undefined });
  const remote = path.join(root, '.git/copy-origin.git');
  await exec('git', ['init', '--bare', '-q', '-b', 'main', remote]);
  await exec('git', ['remote', 'add', 'origin', remote], { cwd: root });
  await exec('git', ['push', '-q', 'origin', 'main'], { cwd: root });
  const c = copies();
  await expect(c.copy({ git: undefined })).rejects.toThrow('interrupted');
  const workflow = parse(
    await readFile(new URL('../../../.github/workflows/publish.yml', import.meta.url), 'utf8'),
  ) as {
    jobs: Record<
      string,
      { steps: { name?: string; run?: string; env?: Record<string, string> }[] }
    >;
  };
  const push = workflow.jobs['copy-show']!.steps.find((s) => s.name === 'Push copy progress')!;
  const pushEnv = { ...process.env, ...push.env };
  await exec('bash', ['-e', '-o', 'pipefail', '-c', push.run!], { cwd: root, env: pushEnv });
  const checkout = await mkdtemp(path.join(tmpdir(), 'handmake-copy-retry-'));
  try {
    await exec('git', ['clone', '-q', remote, checkout]);
    await mkdir(path.join(checkout, 'config/tenants'), { recursive: true });
    await copyFile(
      path.join(root, 'config/tenants/faden-und-stimmung.yaml'),
      path.join(checkout, 'config/tenants/faden-und-stimmung.yaml'),
    );
    const freshStore = new GitRepoContentStore({ rootDir: checkout });
    expect((await freshStore.readLedger(show.tenant, show.id))!.channels.telegram).toMatchObject({
      status: 'failed',
      remoteIds: [101],
    });
    source.fetchMedia.mockRejectedValue(new Error('draft expired'));
    c.succeed();
    await c.copy({ root: checkout, git: undefined });
    await exec('bash', ['-e', '-o', 'pipefail', '-c', push.run!], {
      cwd: checkout,
      env: pushEnv,
    });
    expect(c.requests.map((r) => r.method)).toEqual([
      'sendMediaGroup',
      'sendVideo',
      'sendVideo',
      'sendMessage',
    ]);
    expect((await freshStore.readLedger(show.tenant, show.id))!.channels.telegram!.status).toBe(
      'done',
    );
    expect(await freshStore.readShow(show.tenant, show.id)).toEqual(show);
  } finally {
    await rm(checkout, { recursive: true, force: true });
  }
}, 30_000);

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
  const german = partial!.showCopyPlan!.channels.telegram!.operations.find((op) =>
    op.kind === 'mediaGroup' ? op.captionLang === 'de' : op.kind === 'message' && op.lang === 'de',
  );
  expect(german).toBeDefined();
  const germanText =
    german!.kind === 'mediaGroup'
      ? german!.caption
      : german!.kind === 'message'
        ? german!.text
        : '';
  expect(germanText).toContain('Kanal abonnieren: https://t.me/Faden_und_Stimmung');
  expect(c.notifier.notify).toHaveBeenCalledWith(
    'operator',
    expect.stringContaining('copy failed'),
  );
  expect(callback.send).not.toHaveBeenCalled();
  expect(await store.readShow(show.tenant, show.id)).toEqual(show);
  const album = c.requests[0]!.body;
  const uploaded = [...album.values()].filter((value) => typeof value !== 'string');
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

it('strips authentic photos beside marked media and reuses committed bytes on retry', async () => {
  const { default: sharp } = await import('sharp');
  const jpeg = await readFile(new URL('./fixtures/with-gps-exif.jpg', import.meta.url));
  show.authentic = [
    { fileName: 'authentic-photo-1.jpg', kind: 'photo', provenance: 'human', people: 'none' },
  ];
  payload.show!.media.push({ fileName: 'authentic-photo-1.jpg', ref: 'authentic' });
  source.fetchMedia.mockImplementation(async (ref) =>
    ref === 'authentic' ? jpeg : ref.endsWith('.mp4') ? video : image,
  );
  await run();
  const clean = (await store.readShowMedia(show.tenant, show.id, 'authentic-photo-1.jpg'))!;
  expect((await sharp(clean).metadata()).exif).toBeUndefined();
  expect(await sharp(clean).raw().toBuffer()).toEqual(await sharp(jpeg).raw().toBuffer());
  source.fetchMedia.mockRejectedValue(new Error('expired'));
  await run();
  expect(await store.readShowMedia(show.tenant, show.id, 'authentic-photo-1.jpg')).toEqual(clean);
});

it('rejects bad authentic video before any content or ledger commit and informs the author', async () => {
  show.authentic = [
    { fileName: 'authentic-video.mp4', kind: 'video', provenance: 'human', people: 'none' },
  ];
  payload.show!.media.push({ fileName: 'authentic-video.mp4', ref: 'broken' });
  source.fetchMedia.mockImplementation(async (ref) =>
    ref === 'broken' ? Buffer.from('broken') : ref.endsWith('.mp4') ? video : image,
  );
  const notifier = { notify: vi.fn(async () => {}) };
  await expect(run({ notifier })).rejects.toThrow('60');
  expect(git.commit).not.toHaveBeenCalled();
  expect(await store.readShow(show.tenant, show.id)).toBeUndefined();
  expect(notifier.notify).toHaveBeenCalledWith('author', expect.stringContaining('60'));
});

it('dry-runs authentic show preparation into a temporary store only', async () => {
  const { runDryRun } = await import('../src/dry-run');
  const jpeg = await readFile(new URL('./fixtures/with-gps-exif.jpg', import.meta.url));
  show.authentic = [
    { fileName: 'authentic-photo.jpg', kind: 'photo', provenance: 'human', people: 'none' },
  ];
  payload.show!.media.push({ fileName: 'authentic-photo.jpg', ref: 'authentic' });
  source.fetchMedia.mockImplementation(async (ref) =>
    ref === 'authentic' ? jpeg : ref.endsWith('.mp4') ? video : image,
  );
  await writeFile(payloadPath, JSON.stringify(payload));
  const tempDir = path.join(root, 'dry-run');
  const result = await runDryRun(payloadPath, {
    root,
    tempDir,
    showMediaSource: source,
    logger: () => {},
  });
  expect(result.ops).toEqual([]);
  expect(await store.readShow(show.tenant, show.id)).toBeUndefined();
  expect(
    await new GitRepoContentStore({ rootDir: tempDir }).readShow(show.tenant, show.id),
  ).toBeDefined();
  expect(git.commit).not.toHaveBeenCalled();
});

it('copies authentic photos first and resumes authentic then generated video replies', async () => {
  const original = new Uint8Array(
    await sharp((await markingFixtures()).image)
      .jpeg()
      .toBuffer(),
  );
  const originalVideo = new Uint8Array((await markingFixtures()).markedVideo.result.bytes);
  show.authentic = [
    { fileName: 'authentic.jpg', kind: 'photo', provenance: 'human', people: 'none' },
    { fileName: 'authentic.mp4', kind: 'video', provenance: 'human', people: 'none' },
  ];
  payload.show!.show = show;
  payload.show!.media.push(
    { fileName: 'authentic.jpg', ref: 'authentic.jpg' },
    { fileName: 'authentic.mp4', ref: 'authentic.mp4' },
  );
  source.fetchMedia.mockImplementation(async (ref) =>
    ref === 'authentic.jpg'
      ? original
      : ref === 'authentic.mp4'
        ? originalVideo
        : ref.endsWith('.mp4')
          ? video
          : image,
  );
  await run();
  const storedOriginalVideo = (await store.readShowMedia(show.tenant, show.id, 'authentic.mp4'))!;
  const c = copies();
  await expect(c.copy()).rejects.toThrow('interrupted');
  const album = c.requests[0]!.body;
  expect(new Uint8Array(await (album.get('media0') as File).arrayBuffer())).toEqual(original);
  const partial = (await store.readLedger(show.tenant, show.id))!;
  expect(partial.showCopyPlan!.mediaHashes).toHaveLength(6);
  expect(partial.showCopyPlan!.channels.telegram!.operations[1]).toMatchObject({
    videoSource: 'authentic',
  });
  c.succeed();
  await c.copy();
  expect(c.requests.map((request) => request.method)).toEqual([
    'sendMediaGroup',
    'sendVideo',
    'sendVideo',
    'sendVideo',
    'sendMessage',
  ]);
  expect(new Uint8Array(await (c.requests[2]!.body.get('video') as File).arrayBuffer())).toEqual(
    storedOriginalVideo,
  );
  expect(new Uint8Array(await (c.requests[3]!.body.get('video') as File).arrayBuffer())).toEqual(
    video,
  );
  await c.copy();
  expect(c.requests).toHaveLength(5);
  await writeFile(path.join(root, 'content/shows', show.id, 'authentic.jpg'), new Uint8Array([1]));
  await expect(c.copy()).rejects.toThrow('media changed');
});
