import { renderFacebookShow } from '@handmake/channels';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createFacebookAdapter,
  renderFacebook,
  renderInstagram,
  renderTelegram,
  renderThreads,
} from '@handmake/channels';
import { ChannelRegistry, showSchema } from '@handmake/core';
import type {
  ChannelAdapter,
  ChannelCapabilities,
  DeliverContext,
  DeliverProgress,
  Post,
  RemoteId,
  SendOperation,
  Show,
  ShowRenderContext,
} from '@handmake/core';
import { FakeMediaSource, FakeNotifier } from '@handmake/core/testing';
import { GitRepoContentStore, postFolderName } from '@handmake/stores';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

import { runPublish, PublishError, contestErrorCode } from '../src/publish';
import { runCopyShow } from '../src/copy-show';
import type { DispatchPayload } from '../src/payload';
import { markingFixtures } from './fixtures/show-marking';

const realTenantConfig = new URL(
  '../../../config/tenants/faden-und-stimmung.yaml',
  import.meta.url,
);

const now = new Date('2026-11-09T10:00:00.000Z');
const draftId = '01JBCA1B2C3D4E5F6G7H8J9K0M';
const tenantId = 'faden-und-stimmung';

const CAPABILITIES: ChannelCapabilities = {
  maxPhotos: 10,
  captionLimit: 63206,
  messageLimit: 63206,
  polls: false,
  pollMaxOptions: 0,
  pollQuestionLimit: 0,
  pollOptionLimit: 0,
};

/** Records the DeliverContext of every deliver; no network. */
class RecordingAdapter implements ChannelAdapter {
  readonly contexts: DeliverContext[] = [];

  constructor(
    readonly key: string,
    private readonly renderImpl: (post: Post, settings: unknown) => SendOperation[],
    private readonly renderShowImpl?: (show: Show, context: ShowRenderContext) => SendOperation[],
  ) {}

  get capabilities(): ChannelCapabilities {
    return CAPABILITIES;
  }

  render(post: Post, settings: unknown): SendOperation[] {
    return this.renderImpl(post, settings);
  }

  renderShow(show: Show, context: ShowRenderContext): SendOperation[] {
    if (!this.renderShowImpl) throw new Error(`${this.key} does not support shows`);
    return this.renderShowImpl(show, context);
  }

  async deliver(
    ops: SendOperation[],
    ctx: DeliverContext,
    progress?: DeliverProgress,
  ): Promise<RemoteId[]> {
    this.contexts.push(ctx);
    const ids: RemoteId[] = [...(progress?.knownIds ?? [])];
    for (let i = progress?.startAt ?? 0; i < ops.length; i++) {
      const remoteId = `${this.key}-remote-${i}`;
      ids.push(remoteId);
      await progress?.onDelivered(i, remoteId);
    }
    return ids;
  }
}

const telegramAdapter = () =>
  new RecordingAdapter(
    'telegram',
    (post) => renderTelegram(post, { channelId: 'TEST_CHANNEL', languages: ['uk', 'de'] }),
    (show) => [
      { kind: 'mediaGroup', photoIndexes: show.images.map((_, index) => index) },
      { kind: 'video', replyToOp: 0 },
    ],
  );

const instagramAdapter = () =>
  new RecordingAdapter(
    'instagram',
    (post, settings) => renderInstagram(post, settings),
    (show) => [
      {
        kind: 'mediaGroup',
        photoIndexes: show.images.map((_, index) => index),
        caption: 'Show copy',
        captionLang: 'de',
      },
    ],
  );

const facebookAdapter = () =>
  new RecordingAdapter(
    'facebook',
    (post, settings) => renderFacebook(post, settings),
    (show) => [
      {
        kind: 'mediaGroup',
        photoIndexes: show.images.map((_, index) => index),
        caption: 'Show copy',
        captionLang: 'de',
      },
    ],
  );

const gitMock = () => ({
  commit: vi.fn(async (_paths: string[], _message: string) => true),
  push: vi.fn(async (_ref: string) => {}),
});

const basePayload: DispatchPayload = {
  tenantId,
  draftId,
  kind: 'post',
  type: 'free',
  texts: { uk: 'Тестовий допис (T26b).', de: 'Testbeitrag (T26b).' },
  fileIds: ['file-1', 'file-2'],
  provenance: 'human',
};

const tmpDirs: string[] = [];
let root: string;
let telegram: RecordingAdapter;
let instagram: RecordingAdapter;
let facebook: RecordingAdapter;
let git: ReturnType<typeof gitMock>;
let notifier: FakeNotifier;

async function freshDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

async function jpeg(width: number, height: number): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width, height, channels: 3, background: '#7a6a55' } })
      .jpeg()
      .toBuffer(),
  );
}

beforeEach(async () => {
  root = await freshDir('handmake-facebook-publish-');
  await mkdir(path.join(root, 'config', 'tenants'), { recursive: true });
  await writeFile(
    path.join(root, 'config', 'tenants', 'faden-und-stimmung.yaml'),
    (await readFile(realTenantConfig, 'utf8')).replace(/  threads:\n    language: de\n/, ''),
  );
  telegram = telegramAdapter();
  instagram = instagramAdapter();
  facebook = facebookAdapter();
  git = gitMock();
  notifier = new FakeNotifier();
});

afterAll(async () => {
  await Promise.all(tmpDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

function registry() {
  const registry = new ChannelRegistry();
  registry.register(telegram);
  registry.register(instagram);
  registry.register(facebook);
  return registry;
}

async function mediaSource(): Promise<FakeMediaSource> {
  const source = new FakeMediaSource();
  source.photos.set('file-1', await jpeg(900, 600));
  source.photos.set('file-2', await jpeg(600, 900));
  return source;
}

async function runPost(
  payload: DispatchPayload,
  env: NodeJS.ProcessEnv = { CONTENT_RAW_BASE_URL: 'https://raw.example/base' },
) {
  const payloadPath = path.join(root, 'payload.json');
  await writeFile(payloadPath, JSON.stringify(payload));
  return runPublish(payloadPath, {
    root,
    env,
    now,
    registry: registry(),
    mediaSource: await mediaSource(),
    git,
    notifier,
    logger: () => {},
  });
}

describe('runPublish with Facebook enabled (T26b)', () => {
  it('delivers the item photos by plain raw-GitHub URLs, no framed copies', async () => {
    const result = await runPost(basePayload);

    expect(Object.keys(result.delivered).sort()).toEqual(['facebook', 'instagram', 'telegram']);
    const folder = postFolderName(result.post);
    expect(facebook.contexts).toHaveLength(1);
    expect(facebook.contexts[0]!.photoUrls).toEqual([
      `https://raw.example/base/content/posts/${folder}/photo-1.jpg`,
      `https://raw.example/base/content/posts/${folder}/photo-2.jpg`,
    ]);
    // Facebook keeps the processed original bytes aligned with the photos.
    expect(facebook.contexts[0]!.photos).toEqual(telegram.contexts[0]!.photos);
    // No Facebook-specific files: beside the post sit only the photos and
    // the Instagram 4:5 framed copies (the full tenant config enables
    // Instagram in the same run).
    const files = await readdir(path.join(root, 'content', 'posts', folder));
    expect(files.sort()).toEqual([
      'index.md',
      'photo-1.ig.jpg',
      'photo-1.jpg',
      'photo-2.ig.jpg',
      'photo-2.jpg',
    ]);
    const framedCommit = git.commit.mock.calls.find((call) =>
      call[0].every((p: string) => p.endsWith('.fb.jpg')),
    );
    expect(framedCommit).toBeUndefined();
    expect(result.delivered['facebook']).toEqual(['facebook-remote-0']);
    // Without the workflow opt-in nothing is pushed.
    expect(git.push).not.toHaveBeenCalled();
  });

  it('pushes the content commit once before the Meta deliveries with the workflow opt-in', async () => {
    await runPost(basePayload, {
      CONTENT_RAW_BASE_URL: 'https://raw.example/base',
      CONTENT_PUSH_BEFORE_DELIVERY: 'true',
      GITHUB_REF_NAME: 'main',
    });

    expect(git.push).toHaveBeenCalledTimes(1);
    expect(git.push).toHaveBeenCalledWith('main');
  });

  it('announces on Facebook with zero ops and never pushes', async () => {
    const result = await runPost(
      {
        ...basePayload,
        fileIds: [],
        type: 'announcement',
        texts: { uk: 'Оголошення.', de: 'Ankündigung.' },
      },
      {
        CONTENT_RAW_BASE_URL: 'https://raw.example/base',
        CONTENT_PUSH_BEFORE_DELIVERY: 'true',
        GITHUB_REF_NAME: 'main',
      },
    );

    expect(result.delivered['facebook']).toEqual([]);
    expect(facebook.contexts[0]!.photoUrls).toEqual([]);
    expect(git.push).not.toHaveBeenCalled();
  });

  it('fails only the Facebook channel on a delivery error; earlier channels stay done', async () => {
    const failing = new RecordingAdapter('facebook', (post, settings) =>
      renderFacebook(post, settings),
    );
    failing.deliver = async () => {
      throw new Error('simulated facebook failure');
    };
    const registry = new ChannelRegistry();
    registry.register(telegram);
    registry.register(instagram);
    registry.register(failing);
    const payloadPath = path.join(root, 'payload.json');
    await writeFile(payloadPath, JSON.stringify(basePayload));

    await expect(
      runPublish(payloadPath, {
        root,
        env: { CONTENT_RAW_BASE_URL: 'https://raw.example/base' },
        now,
        registry,
        mediaSource: await mediaSource(),
        git,
        notifier,
        logger: () => {},
      }),
    ).rejects.toThrow(PublishError);

    const ledger = (await new GitRepoContentStore({ rootDir: root }).readLedger(
      tenantId,
      draftId,
    ))!;
    expect(ledger.channels['telegram']!.status).toBe('done');
    expect(ledger.channels['instagram']!.status).toBe('done');
    expect(ledger.channels['facebook']!.status).toBe('failed');
    expect(ledger.channels['facebook']!.error).toMatch(/simulated facebook failure/);
    expect(
      notifier.messages.some(
        (m) => m.target === 'operator' && m.message.includes('simulated facebook failure'),
      ),
    ).toBe(true);
  });

  it('continues to Facebook after an Instagram preparation failure', async () => {
    // A rejected first push must not prevent Facebook from trying its own preparation.
    git.push.mockRejectedValueOnce(new Error('push rejected'));

    const env = {
      CONTENT_RAW_BASE_URL: 'https://raw.example/base',
      CONTENT_PUSH_BEFORE_DELIVERY: 'true',
      GITHUB_REF_NAME: 'main',
    };
    await expect(runPost(basePayload, env)).rejects.toThrow(PublishError);

    expect(instagram.contexts).toHaveLength(0);
    expect(facebook.contexts).toHaveLength(1);
    let ledger = (await new GitRepoContentStore({ rootDir: root }).readLedger(tenantId, draftId))!;
    expect(ledger.channels['telegram']!.status).toBe('done');
    expect(ledger.channels['instagram']!.status).toBe('failed');
    expect(ledger.channels['instagram']!.error).toMatch(/push rejected/);
    expect(ledger.channels['facebook']!.status).toBe('done');
    expect(notifier.messages.some((m) => m.target === 'operator')).toBe(true);

    // Resume retries Instagram and skips the successful Facebook delivery.
    const resumed = await runPost(basePayload, env);
    expect(resumed.delivered['instagram']).toEqual(['instagram-remote-0']);
    expect(resumed.skipped).toContain('facebook');
    ledger = (await new GitRepoContentStore({ rootDir: root }).readLedger(tenantId, draftId))!;
    expect(ledger.channels['instagram']!.status).toBe('done');
    expect(ledger.channels['facebook']!.status).toBe('done');
    expect(git.push).toHaveBeenCalledTimes(3);
  });

  it('skips Facebook on a re-run via the ledger and does not deliver again', async () => {
    const env = {
      CONTENT_RAW_BASE_URL: 'https://raw.example/base',
      CONTENT_PUSH_BEFORE_DELIVERY: 'true',
      GITHUB_REF_NAME: 'main',
    };
    const first = await runPost(basePayload, env);
    expect(first.skipped).toEqual([]);

    const rerun = await runPost(basePayload, env);
    expect(rerun.skipped.sort()).toEqual(['facebook', 'instagram', 'telegram']);
    expect(facebook.contexts).toHaveLength(1);
  });
});

describe('runCopyShow with Facebook enabled (T26b)', () => {
  const showFixture = new URL('../../../packages/core/test/fixtures/show.json', import.meta.url);

  async function publishShow(withAuthentic = false) {
    const show = showSchema.parse(JSON.parse(await readFile(showFixture, 'utf8')));
    if (withAuthentic)
      show.authentic = [
        {
          fileName: 'authentic.jpg',
          kind: 'photo',
          provenance: 'human',
          people: 'none',
        },
      ];
    const fixtures = await markingFixtures();
    const original = new Uint8Array(await sharp(fixtures.image).jpeg().toBuffer());
    const image = new Uint8Array(fixtures.markedImage.result.bytes);
    const video = new Uint8Array(fixtures.markedVideo.result.bytes);
    for (const entry of show.images) entry.marker = fixtures.markedImage.marker;
    show.video.marker = fixtures.markedVideo.marker;
    const store = new GitRepoContentStore({ rootDir: root });
    await store.saveWork(
      {
        id: show.workId,
        tenant: show.tenant,
        date: show.date,
        collection: 'fixture',
        kind: 'interior',
        photos: ['original.jpg'],
        versions: show.versions,
      },
      [{ fileName: 'original.jpg', data: image }],
    );
    const payload: DispatchPayload = {
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
        media: [...show.images, show.video, ...(show.authentic ?? [])].map(({ fileName }) => ({
          fileName,
          ref: fileName,
        })),
      },
    };
    const source = {
      fetchMedia: vi.fn(async (ref: string) =>
        ref === 'authentic.jpg' ? original : ref.endsWith('.mp4') ? video : image,
      ),
    };
    const payloadPath = path.join(root, 'show-payload.json');
    await writeFile(payloadPath, JSON.stringify(payload));
    await runPublish(payloadPath, {
      root,
      env: {},
      now,
      showMediaSource: source,
      git: gitMock(),
      notifier,
      logger: () => {},
    });
    return show;
  }

  it('aligns authentic-first bytes and URLs for show copies', async () => {
    const show = await publishShow(true);
    const original = (await new GitRepoContentStore({ rootDir: root }).readShowMedia(
      show.tenant,
      show.id,
      'authentic.jpg',
    ))!;
    vi.spyOn(facebook, 'renderShow').mockImplementation(renderFacebookShow);
    await runCopyShow(show.tenant, show.id, {
      root,
      env: { CONTENT_RAW_BASE_URL: 'https://raw.example/base' },
      now,
      registry: registry(),
      git,
      notifier,
      logger: () => {},
    });
    expect(facebook.contexts[0]!.photos[0]).toEqual(original);
    expect(facebook.contexts[0]!.photoUrls).toEqual([
      `https://raw.example/base/content/shows/${show.id}/authentic.jpg`,
      ...show.images.map(
        (item) => `https://raw.example/base/content/shows/${show.id}/${item.fileName}`,
      ),
    ]);
  });

  it('delivers the show images by plain raw-GitHub URLs', async () => {
    const show = await publishShow();

    const result = await runCopyShow(show.tenant, show.id, {
      root,
      env: { CONTENT_RAW_BASE_URL: 'https://raw.example/base' },
      now,
      registry: registry(),
      git,
      notifier,
      logger: () => {},
    });

    expect(result.skipped).toEqual([]);
    expect(facebook.contexts).toHaveLength(1);
    expect(facebook.contexts[0]!.photoUrls).toEqual(
      show.images.map(
        (image) => `https://raw.example/base/content/shows/${show.id}/${image.fileName}`,
      ),
    );
    const ledger = result.ledger;
    expect(ledger.channels['facebook']!.status).toBe('done');
  });
});

it('delivers a stored-shape three-entry ballot through the real Facebook album adapter', async () => {
  const stored = await readFile(new URL('./fixtures/ballot-post.md', import.meta.url), 'utf8');
  const ids = [...stored.matchAll(/\{entry:([^}]+)\}/g)].slice(0, 3).map((match) => match[1]!);
  const requests: Record<string, unknown>[] = [];
  const facebook = createFacebookAdapter({
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({ id: `remote-${requests.length}` });
    },
  });
  const threads = new RecordingAdapter('threads', renderThreads);
  const registry = new ChannelRegistry();
  for (const adapter of [telegram, instagram, facebook, threads]) registry.register(adapter);
  const configPath = path.join(root, 'config', 'tenants', 'faden-und-stimmung.yaml');
  await writeFile(configPath, await readFile(realTenantConfig, 'utf8'));
  const source = await mediaSource();
  source.photos.set('file-3', await jpeg(800, 600));
  const payloadPath = path.join(root, 'payload.json');
  await writeFile(
    payloadPath,
    JSON.stringify({
      ...basePayload,
      type: 'wotw-poll',
      fileIds: ['file-1', 'file-2', 'file-3'],
      texts: {
        uk: ids.map((id) => `{entry:${id}}`).join('\n'),
        de: ids.map((id) => `{entry:${id}}`).join('\n'),
      },
      poll: { question: 'Favorite?', options: ['No 1', 'No 2', 'No 3'] },
    }),
  );
  const logs: string[] = [];
  const deps = {
    root,
    now,
    registry,
    git,
    notifier,
    mediaSource: source,
    env: {
      CONTENT_RAW_BASE_URL: 'https://raw.example/base',
      PUBLISH_CALLBACK_URL: 'https://fixture.test/callback',
      NAMES_ENDPOINT_SECRET: 'fixture',
    },
    fetchImpl: (async () =>
      Response.json(Object.fromEntries(ids.map((id) => [id, null])))) as typeof fetch,
    secrets: { resolve: async () => 'fixture-secret' },
    logger: (line: string) => logs.push(line),
  };
  const result = await runPublish(payloadPath, deps);
  expect(Object.keys(result.delivered)).toEqual(['telegram', 'instagram', 'facebook', 'threads']);
  expect(requests).toHaveLength(4);
  expect(requests.slice(0, 3).every((request) => request.published === false)).toBe(true);
  expect(requests[3]!.attached_media).toHaveLength(3);
  expect(JSON.stringify(requests)).not.toContain('{entry:');
  expect(threads.contexts[0]!.photos).toEqual(telegram.contexts[0]!.photos);
  const folder = postFolderName(result.post);
  const committed = await readFile(path.join(root, 'content/posts', folder, 'photo-1.jpg'));
  expect(committed).toEqual(Buffer.from(telegram.contexts[0]!.photos[0]!));
  // The actual adapter receives a rejected album request; Threads must still run.
  const retryRoot = await freshDir('handmake-ballot-retry-');
  await mkdir(path.join(retryRoot, 'config/tenants'), { recursive: true });
  await writeFile(
    path.join(retryRoot, 'config/tenants/faden-und-stimmung.yaml'),
    await readFile(realTenantConfig, 'utf8'),
  );
  const failing = createFacebookAdapter({
    fetchImpl: async () =>
      Response.json(
        { error: { code: 200, message: 'Secret name https://example.test/?access_token=secret' } },
        { status: 403 },
      ),
  });
  const failedRegistry = new ChannelRegistry();
  for (const adapter of [telegram, instagram, failing, threads]) failedRegistry.register(adapter);
  await expect(
    runPublish(payloadPath, { ...deps, root: retryRoot, registry: failedRegistry }),
  ).rejects.toThrow(PublishError);
  const ledger = (await new GitRepoContentStore({ rootDir: retryRoot }).readLedger(
    tenantId,
    draftId,
  ))!;
  expect(ledger.channels.facebook!.status).toBe('failed');
  expect(ledger.channels.threads!.status).toBe('done');
  expect(logs.join('\n')).toContain('FacebookAdapterError code=200');
  expect(logs.join('\n')).not.toMatch(/Secret name|access_token/);
});

it('never includes arbitrary error names or messages in contest diagnostics', () => {
  const error = new Error('https://example.test/?token=secret Private name');
  error.name = 'Private name';
  expect(contestErrorCode(error)).toBe('Error');
});
