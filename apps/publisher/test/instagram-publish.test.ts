import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { renderFacebook, renderInstagram, renderTelegram } from '@handmake/channels';
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

import { runPublish, PublishError } from '../src/publish';
import { runCopyShow } from '../src/copy-show';
import type { DispatchPayload } from '../src/payload';
import { markingFixtures } from './fixtures/show-marking';

const realTenantConfig = new URL(
  '../../../config/tenants/faden-und-stimmung.yaml',
  import.meta.url,
);

const now = new Date('2026-10-24T10:00:00.000Z');
const draftId = '01JBCA1B2C3D4E5F6G7H8J9K0M';
const tenantId = 'faden-und-stimmung';

const CAPABILITIES: ChannelCapabilities = {
  maxPhotos: 10,
  captionLimit: 2200,
  messageLimit: 4096,
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
  texts: { uk: 'Тестовий допис (T26a3).', de: 'Testbeitrag (T26a3).' },
  fileIds: ['file-1', 'file-2', 'file-3'],
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
  root = await freshDir('handmake-instagram-publish-');
  await mkdir(path.join(root, 'config', 'tenants'), { recursive: true });
  await copyFile(realTenantConfig, path.join(root, 'config', 'tenants', 'faden-und-stimmung.yaml'));
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
  source.photos.set('file-3', await jpeg(400, 400));
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

describe('runPublish with Instagram enabled (T26a3)', () => {
  it('delivers framed 4:5 carousel URLs to Instagram and the original bytes to Telegram', async () => {
    const result = await runPost(basePayload);

    expect(Object.keys(result.delivered).sort()).toEqual(['facebook', 'instagram', 'telegram']);
    const folder = postFolderName(result.post);
    expect(instagram.contexts).toHaveLength(1);
    expect(instagram.contexts[0]!.photoUrls).toEqual([
      `https://raw.example/base/content/posts/${folder}/photo-1.ig.jpg`,
      `https://raw.example/base/content/posts/${folder}/photo-2.ig.jpg`,
      `https://raw.example/base/content/posts/${folder}/photo-3.ig.jpg`,
    ]);
    // Facebook fetches the item's own committed photos: plain URLs, no
    // framed copies.
    expect(facebook.contexts).toHaveLength(1);
    expect(facebook.contexts[0]!.photoUrls).toEqual([
      `https://raw.example/base/content/posts/${folder}/photo-1.jpg`,
      `https://raw.example/base/content/posts/${folder}/photo-2.jpg`,
      `https://raw.example/base/content/posts/${folder}/photo-3.jpg`,
    ]);
    // Telegram receives the processed original bytes, aligned with
    // post.photos; the framing happens only in the committed copies Meta
    // fetches by URL.
    expect(telegram.contexts[0]!.photos).toHaveLength(3);
    expect(instagram.contexts[0]!.photos).toEqual(telegram.contexts[0]!.photos);
    expect(facebook.contexts[0]!.photos).toEqual(telegram.contexts[0]!.photos);
    // The framed copies sit beside the item, committed by the publisher, and
    // differ from the originals Meta never sees.
    for (const name of ['photo-1.ig.jpg', 'photo-2.ig.jpg', 'photo-3.ig.jpg']) {
      const framedPath = path.join(root, 'content', 'posts', folder, name);
      const metadata = await sharp(await readFile(framedPath)).metadata();
      expect(metadata).toMatchObject({ format: 'jpeg', width: 1080, height: 1350 });
      const original = await readFile(
        path.join(root, 'content', 'posts', folder, name.replace('.ig.jpg', '.jpg')),
      );
      expect(await readFile(framedPath)).not.toEqual(original);
    }
    const framedCommit = git.commit.mock.calls.find((call) =>
      call[0].every((p: string) => p.endsWith('.ig.jpg')),
    );
    expect(framedCommit).toBeDefined();
    // Without the workflow opt-in nothing is pushed.
    expect(git.push).not.toHaveBeenCalled();
  });

  it('frames a single 3:4 photo for the feed aspect and skips a push without the opt-in', async () => {
    const result = await runPost({ ...basePayload, fileIds: ['file-2'] }); // 600x900 portrait

    expect(result.delivered['instagram']).toEqual(['instagram-remote-0']);
    const folder = postFolderName(result.post);
    expect(instagram.contexts[0]!.photoUrls).toEqual([
      `https://raw.example/base/content/posts/${folder}/photo-1.ig.jpg`,
    ]);
    const framed = await sharp(
      await readFile(path.join(root, 'content', 'posts', folder, 'photo-1.ig.jpg')),
    ).metadata();
    expect(framed).toMatchObject({ format: 'jpeg', width: 1080, height: 1350 });
    expect(git.push).not.toHaveBeenCalled();
  });

  it('pushes the content commit before delivery with the workflow opt-in', async () => {
    await runPost(basePayload, {
      CONTENT_RAW_BASE_URL: 'https://raw.example/base',
      CONTENT_PUSH_BEFORE_DELIVERY: 'true',
      GITHUB_REF_NAME: 'main',
    });

    // One push per run covers both Meta channels (the second preparation
    // skips the no-op push); without the opt-in nothing is pushed.
    expect(git.push).toHaveBeenCalledTimes(1);
    expect(git.push).toHaveBeenCalledWith('main');
  });

  it('announces on Instagram with zero ops and never frames or pushes', async () => {
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

    expect(result.delivered['instagram']).toEqual([]);
    expect(result.delivered['facebook']).toEqual([]);
    expect(instagram.contexts[0]!.photoUrls).toEqual([]);
    expect(facebook.contexts[0]!.photoUrls).toEqual([]);
    expect(git.push).not.toHaveBeenCalled();
    const framedCommit = git.commit.mock.calls.find((call) =>
      call[0].every((p: string) => p.endsWith('.ig.jpg')),
    );
    expect(framedCommit).toBeUndefined();
  });

  it('fails only the Instagram channel when the pre-delivery push is rejected; Telegram stays done', async () => {
    git.push.mockRejectedValue(new Error('push rejected'));

    await expect(
      runPost(basePayload, {
        CONTENT_RAW_BASE_URL: 'https://raw.example/base',
        CONTENT_PUSH_BEFORE_DELIVERY: 'true',
        GITHUB_REF_NAME: 'main',
      }),
    ).rejects.toThrow(PublishError);

    const ledger = (await new GitRepoContentStore({ rootDir: root }).readLedger(
      tenantId,
      draftId,
    ))!;
    expect(ledger.channels['telegram']!.status).toBe('done');
    expect(ledger.channels['instagram']!.status).toBe('failed');
    expect(notifier.messages.some((m) => m.target === 'operator')).toBe(true);
  });

  it('fails Instagram cleanly without public photo URLs, after Telegram delivered', async () => {
    await expect(runPost(basePayload, {})).rejects.toThrow(PublishError);

    expect(telegram.contexts).toHaveLength(1);
    expect(instagram.contexts).toHaveLength(0);
    const ledger = (await new GitRepoContentStore({ rootDir: root }).readLedger(
      tenantId,
      draftId,
    ))!;
    expect(ledger.channels['telegram']!.status).toBe('done');
    expect(ledger.channels['instagram']!.status).toBe('failed');
    expect(ledger.channels['instagram']!.error).toMatch(/public photo URLs/);
    expect(notifier.messages.some((m) => m.target === 'operator')).toBe(true);
  });

  it('skips Instagram on a re-run via the ledger and does not push again', async () => {
    const env = {
      CONTENT_RAW_BASE_URL: 'https://raw.example/base',
      CONTENT_PUSH_BEFORE_DELIVERY: 'true',
      GITHUB_REF_NAME: 'main',
    };
    const first = await runPost(basePayload, env);
    expect(first.skipped).toEqual([]);

    const rerun = await runPost(basePayload, env);
    expect(rerun.skipped.sort()).toEqual(['facebook', 'instagram', 'telegram']);
    expect(instagram.contexts).toHaveLength(1);
    expect(facebook.contexts).toHaveLength(1);
    // One push in the first run; the re-run skips every channel and never
    // reaches a Meta preparation.
    expect(git.push).toHaveBeenCalledTimes(1);
  });
});

describe('runCopyShow with Instagram enabled (T26a3)', () => {
  const showFixture = new URL('../../../packages/core/test/fixtures/show.json', import.meta.url);

  async function publishShow() {
    const show = showSchema.parse(JSON.parse(await readFile(showFixture, 'utf8')));
    const fixtures = await markingFixtures();
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
        media: [...show.images, show.video].map(({ fileName }) => ({ fileName, ref: fileName })),
      },
    };
    const source = {
      fetchMedia: vi.fn(async (ref: string) => (ref.endsWith('.mp4') ? video : image)),
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

  it('frames the show carousel beside the show and delivers framed URLs', async () => {
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
    expect(instagram.contexts).toHaveLength(1);
    expect(facebook.contexts).toHaveLength(1);
    const framedUrls = show.images.map(
      (image) =>
        `https://raw.example/base/content/shows/${show.id}/${image.fileName.replace(/\.[^.]+$/, '')}.ig.jpg`,
    );
    expect(instagram.contexts[0]!.photoUrls).toEqual(framedUrls);
    // Facebook fetches the show's own committed images by plain URL.
    expect(facebook.contexts[0]!.photoUrls).toEqual(
      show.images.map(
        (image) => `https://raw.example/base/content/shows/${show.id}/${image.fileName}`,
      ),
    );
    // Telegram still gets the marked image bytes themselves.
    expect(telegram.contexts[0]!.photos).toHaveLength(show.images.length);
    for (const image of show.images) {
      const framedName = image.fileName.replace(/\.[^.]+$/, '') + '.ig.jpg';
      const metadata = await sharp(
        await readFile(path.join(root, 'content', 'shows', show.id, framedName)),
      ).metadata();
      expect(metadata).toMatchObject({ format: 'jpeg', width: 1080, height: 1350 });
    }
    const ledger = result.ledger;
    expect(ledger.channels['instagram']!.status).toBe('done');
    expect(ledger.channels['facebook']!.status).toBe('done');
    expect(ledger.channels['telegram']!.status).toBe('done');
  });
});
