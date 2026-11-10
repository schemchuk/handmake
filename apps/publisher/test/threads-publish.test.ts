import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  renderThreads,
  renderThreadsShow,
  renderInstagram,
  renderTelegram,
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

import { runPublish, PublishError, defaultRegistry } from '../src/publish';
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

const threadsAdapter = () => new RecordingAdapter('threads', renderThreads, renderThreadsShow);

const gitMock = () => ({
  commit: vi.fn(async (_paths: string[], _message: string) => true),
  push: vi.fn(async (_ref: string) => {}),
});

const basePayload: DispatchPayload = {
  tenantId,
  draftId,
  kind: 'post',
  type: 'free',
  texts: { uk: 'Тестовий допис (T26c).', de: 'Testbeitrag (T26c).' },
  fileIds: ['file-1', 'file-2'],
  provenance: 'human',
};

const tmpDirs: string[] = [];
let root: string;
let telegram: RecordingAdapter;
let instagram: RecordingAdapter;
let threads: RecordingAdapter;
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
  root = await freshDir('handmake-threads-publish-');
  await mkdir(path.join(root, 'config', 'tenants'), { recursive: true });
  await writeFile(
    path.join(root, 'config', 'tenants', 'faden-und-stimmung.yaml'),
    (await readFile(realTenantConfig, 'utf8')).replace(/  facebook:\n    language: de\n/, ''),
  );
  telegram = telegramAdapter();
  instagram = instagramAdapter();
  threads = threadsAdapter();
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
  registry.register(threads);
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

describe('runPublish with Threads enabled (T26c)', () => {
  it('delivers the item photos by plain raw-GitHub URLs, no framed copies', async () => {
    const result = await runPost(basePayload);

    expect(Object.keys(result.delivered).sort()).toEqual(['instagram', 'telegram', 'threads']);
    const folder = postFolderName(result.post);
    expect(threads.contexts).toHaveLength(1);
    expect(threads.contexts[0]!.photoUrls).toEqual([
      `https://raw.example/base/content/posts/${folder}/photo-1.jpg`,
      `https://raw.example/base/content/posts/${folder}/photo-2.jpg`,
    ]);
    // Threads keeps the processed original bytes aligned with the photos.
    expect(threads.contexts[0]!.photos).toEqual(telegram.contexts[0]!.photos);
    // No Threads-specific files: beside the post sit only the photos and
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
    expect(result.delivered['threads']).toEqual(['threads-remote-0']);
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

  it('announces on Threads with zero ops and never pushes', async () => {
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

    expect(result.delivered['threads']).toEqual([]);
    expect(threads.contexts[0]!.photoUrls).toEqual([]);
    expect(git.push).not.toHaveBeenCalled();
  });

  it('fails only the Threads channel on a delivery error; earlier channels stay done', async () => {
    const failing = new RecordingAdapter('threads', (post, settings) =>
      renderThreads(post, settings),
    );
    failing.deliver = async () => {
      throw new Error('simulated threads failure');
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
    expect(ledger.channels['threads']!.status).toBe('failed');
    expect(ledger.channels['threads']!.error).toMatch(/simulated threads failure/);
    expect(
      notifier.messages.some(
        (m) => m.target === 'operator' && m.message.includes('simulated threads failure'),
      ),
    ).toBe(true);
  });

  it('fails Instagram when the one pre-delivery push is rejected; Threads resumes on the next run', async () => {
    // One push per run happens at the FIRST Meta preparation (Instagram,
    // first in the tenant order). Its rejection fails Instagram before any
    // Instagram network write; Threads stays pending and delivers on the
    // resume run, whose own push covers it.
    git.push.mockRejectedValueOnce(new Error('push rejected'));

    const env = {
      CONTENT_RAW_BASE_URL: 'https://raw.example/base',
      CONTENT_PUSH_BEFORE_DELIVERY: 'true',
      GITHUB_REF_NAME: 'main',
    };
    await expect(runPost(basePayload, env)).rejects.toThrow(PublishError);

    expect(instagram.contexts).toHaveLength(0);
    expect(threads.contexts).toHaveLength(0);
    let ledger = (await new GitRepoContentStore({ rootDir: root }).readLedger(tenantId, draftId))!;
    expect(ledger.channels['telegram']!.status).toBe('done');
    expect(ledger.channels['instagram']!.status).toBe('failed');
    expect(ledger.channels['instagram']!.error).toMatch(/push rejected/);
    expect(ledger.channels['threads']!.status).not.toBe('done');
    expect(notifier.messages.some((m) => m.target === 'operator')).toBe(true);

    // Resume: the re-run pushes once and delivers both Meta channels.
    const resumed = await runPost(basePayload, env);
    expect(resumed.delivered['instagram']).toEqual(['instagram-remote-0']);
    expect(resumed.delivered['threads']).toEqual(['threads-remote-0']);
    ledger = (await new GitRepoContentStore({ rootDir: root }).readLedger(tenantId, draftId))!;
    expect(ledger.channels['instagram']!.status).toBe('done');
    expect(ledger.channels['threads']!.status).toBe('done');
    expect(git.push).toHaveBeenCalledTimes(2);
  });

  it('skips Threads on a re-run via the ledger and does not deliver again', async () => {
    const env = {
      CONTENT_RAW_BASE_URL: 'https://raw.example/base',
      CONTENT_PUSH_BEFORE_DELIVERY: 'true',
      GITHUB_REF_NAME: 'main',
    };
    const first = await runPost(basePayload, env);
    expect(first.skipped).toEqual([]);

    const rerun = await runPost(basePayload, env);
    expect(rerun.skipped.sort()).toEqual(['instagram', 'telegram', 'threads']);
    expect(threads.contexts).toHaveLength(1);
  });
});

describe('runCopyShow with Threads enabled (T26c)', () => {
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
    expect(threads.contexts).toHaveLength(1);
    expect(threads.contexts[0]!.photoUrls).toEqual(
      show.images.map(
        (image) => `https://raw.example/base/content/shows/${show.id}/${image.fileName}`,
      ),
    );
    const ledger = result.ledger;
    expect(ledger.channels['threads']!.status).toBe('done');
  });
});

it('registers the real Threads adapter for a Threads-only tenant', async () => {
  const { parseTenantConfig } = await import('@handmake/core');
  const tenant = parseTenantConfig(await readFile(realTenantConfig, 'utf8'));
  expect(defaultRegistry(tenant, {}, ['threads']).get('threads').key).toBe('threads');
});
it('publishes a photo-free site post to Threads without public media hosting', async () => {
  // Instagram/Facebook are disabled here; Telegram + Threads remain enabled.
  const configPath = path.join(root, 'config', 'tenants', 'faden-und-stimmung.yaml');
  await writeFile(
    configPath,
    (await readFile(configPath, 'utf8')).replace(/  instagram:\n    language: de\n/, ''),
  );
  const result = await runPost({ ...basePayload, fileIds: [] }, {});
  expect(result.delivered['threads']).toEqual(['threads-remote-0']);
  expect(threads.contexts[0]?.photoUrls).toEqual([]);
  expect(git.push).not.toHaveBeenCalled();
});
