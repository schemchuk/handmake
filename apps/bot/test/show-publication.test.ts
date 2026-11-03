import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  createDraft,
  describeShowVerification,
  newUlid,
  parseTenantConfig,
  serializeWork,
} from '@handmake/core';
import type { PublishJob, ShowReceipt, Work } from '@handmake/core';
import { FakeTranslator } from '@handmake/core/testing';
import { Miniflare } from 'miniflare';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { GitRepoContentStore } from '../../../packages/stores/src/index';
import { runPublish } from '../../publisher/src/publish';
import { createGitCommitter } from '../../publisher/src/git';
import { TelegramMediaSource } from '../../publisher/src/photos/telegram-media-source';
import {
  markingFixtures,
  stripImageMetadata,
  stripVideoMetadata,
  tamperImageMetadata,
} from '../../publisher/test/fixtures/show-marking';
import { createShowMarkingGate } from '../../publisher/src/marking';
import { createBot } from '../src/bot';
import { createD1DraftStore } from '../src/draft-store';
import { createShowApproval } from '../src/show-approval';
import { createGitHubActionsRunner } from '../src/publish-runner';
import { createGitHubWorkReader } from '../src/work-reader';
import { createR2MarkedShowStorage, createR2ShowStorage } from '../src/show-storage';
import { createShowVerificationStore } from '../src/show-verification';
import { handlePublishedCallback } from '../src/published-callback';
import { botTexts } from '../src/texts';
import type { Env } from '../src/env';
import { callbackQueryUpdate, makeD1, mockTelegramApi, textUpdate } from './helpers';

const exec = promisify(execFile);
const tenant = 'faden-und-stimmung';
const secret = 'fixture-callback-secret';
let mf: Miniflare, bucket: R2Bucket, root: string, id: string;
let drafts: ReturnType<typeof createD1DraftStore>, store: GitRepoContentStore;
let bot: ReturnType<typeof createBot>,
  work: Work,
  fixtures: Awaited<ReturnType<typeof markingFixtures>>;
let env: Env, version: number;
let tasks: Promise<void>[], dispatches: Record<string, unknown>[];
let documents: Map<string, { name: string; bytes: Uint8Array }>;
let callbackLost: boolean, dispatchLost: boolean;
let corrupt: (bytes: Uint8Array, name: string) => Promise<Uint8Array>;
const configPath = new URL('../../../config/tenants/faden-und-stimmung.yaml', import.meta.url);
const stored = async () => (await drafts.get(tenant, id))!;
const drain = async () => {
  await Promise.all(tasks);
  tasks = [];
};
const consent = async () => {
  await bot.handleUpdate(callbackQueryUpdate(11, 11, `show:${id}:approve:${version}`));
  await drain();
};
beforeAll(async () => {
  mf = new Miniflare({ script: '', modules: true, r2Buckets: ['SHOW_MEDIA'] });
  bucket = (await mf.getR2Bucket('SHOW_MEDIA')) as unknown as R2Bucket;
  fixtures = await markingFixtures();
});
afterAll(async () => {
  await mf.dispose();
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'handmake-show-integration-'));
  await mkdir(path.join(root, 'config/tenants'), { recursive: true });
  await copyFile(configPath, path.join(root, `config/tenants/${tenant}.yaml`));
  await exec('git', ['init', '-q'], { cwd: root });
  const config = parseTenantConfig(await readFile(configPath, 'utf8'));
  config.shows = {
    models: [],
    image: { model: 'fixture', eurPerImage: 0.1 },
    video: { model: 'fixture', eurPerSecond: 0.1 },
  };
  id = newUlid();
  work = {
    id: newUlid(),
    tenant,
    date: '2026-11-03T00:00:00.000Z',
    collection: 'fixture',
    kind: 'interior',
    photos: ['original.png'],
    versions: {
      uk: { description: 'Author description', provenance: 'human' },
      de: { description: 'Approved translation', provenance: 'ai-assisted' },
    },
  };
  store = new GitRepoContentStore({ rootDir: root });
  await store.saveWork(work, [{ fileName: 'original.png', data: fixtures.image }]);
  await createGitCommitter({ repoDir: root }).commit(
    [`content/works/${work.id}`],
    'content: add fixture work',
  );
  const db = await makeD1();
  drafts = createD1DraftStore(db);
  env = { DB: db, PUBLISH_CALLBACK_SECRET: secret } as Env;
  const raw = createR2ShowStorage(bucket).results;
  const marked = createR2MarkedShowStorage(bucket);
  const verified = createShowVerificationStore(bucket);
  const gate = createShowMarkingGate(raw, marked);
  const outputs: Record<string, ShowReceipt> = {};
  for (const slot of ['image-0', 'image-1', 'image-2', 'video']) {
    const metadata = { callId: slot, model: 'fixture', promptVersion: 'fixture@1', costEur: 0.1 };
    await raw.put(tenant, id, slot, {
      ...metadata,
      mimeType: slot === 'video' ? 'video/mp4' : 'image/png',
      bytes: slot === 'video' ? fixtures.video : fixtures.image,
    });
    await marked.put(tenant, id, slot, {
      ...(slot === 'video' ? fixtures.markedVideo.result : fixtures.markedImage.result),
      ...metadata,
    });
    const output = await gate.prepare(tenant, id, slot);
    const original = (await raw.get(tenant, id, slot))!;
    const evidence = await describeShowVerification(tenant, id, slot, original, output);
    await verified.attest(evidence);
    outputs[slot] = evidence.rawReceipt;
  }
  await drafts.create(
    {
      ...createDraft(tenant, id, new Date(), { kind: 'show' }),
      state: 'ready',
      extras: {
        show: {
          plan: {
            workId: work.id,
            template: 'interior',
            originals: ['first', 'second'],
            imageCount: 3,
            provider: { image: config.shows.image, video: config.shows.video },
          },
          outputs,
        },
      },
    },
    '11',
  );
  await drafts.setChatSession(tenant, '11', { kind: 'show', draftId: id }, new Date());
  tasks = [];
  dispatches = [];
  documents = new Map();
  callbackLost = false;
  dispatchLost = false;
  corrupt = async (bytes) => bytes;
  const works = createGitHubWorkReader({
    repo: 'fixture/repo',
    ref: 'main',
    fetchImpl: async () => new Response(serializeWork(work)),
  });
  const runner = createGitHubActionsRunner({
    repo: 'fixture/repo',
    token: 'fixture-token',
    live: false,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.event_type).toBe('publish-post');
      const { live, ...payload } = body.client_payload;
      expect(live).toBe(false); // publish.yml strips this routing key before the strict publisher schema.
      dispatches.push(payload);
      if (dispatchLost) {
        dispatchLost = false;
        throw new Error('lost dispatch acknowledgement');
      }
      return new Response(null, { status: 204 });
    },
  });
  bot = createBot({
    token: 'TEST_TOKEN',
    drafts,
    texts: botTexts,
    resolveTenant: (user) => (user === 11 ? tenant : 'another-tenant'),
    translator: new FakeTranslator(),
    publishRunner: runner,
    background: (task) => {
      tasks.push(task());
    },
    show: {
      configs: { load: async () => config },
      works,
      approval: createShowApproval({ drafts, works, verified }),
    },
  });
  mockTelegramApi(bot);
  bot.api.config.use(async (previous, method, payload, signal) => {
    if (method !== 'sendDocument') return previous(method, payload, signal);
    const file = (payload as { document: import('grammy').InputFile }).document;
    const bytes = await file.toRaw();
    if (!(bytes instanceof Uint8Array)) throw new Error('expected exact document bytes');
    const ref = `document-${documents.size}`;
    documents.set(ref, { name: file.filename!, bytes: new Uint8Array(bytes) });
    return {
      ok: true,
      result: {
        message_id: documents.size,
        date: 1,
        chat: { id: 11, type: 'private' },
        document: {
          file_id: ref,
          file_unique_id: ref,
          file_name: file.filename,
          file_size: bytes.length,
          mime_type: file.filename!.endsWith('.mp4') ? 'video/mp4' : 'image/png',
        },
      },
    } as never;
  });
  await bot.init();
  await bot.handleUpdate(textUpdate(11, '/show'));
  await drain();
  version = (await stored()).version;
  expect(documents.size).toBe(4);
});

async function publish(payload = dispatches.at(-1)!, overrides = {}) {
  const payloadPath = path.join(root, 'payload.json');
  await writeFile(payloadPath, JSON.stringify(payload));
  const media = new TelegramMediaSource({
    token: 'fixture-token',
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      if (parsed.pathname.endsWith('/getFile')) {
        const ref = parsed.searchParams.get('file_id')!;
        if (!documents.has(ref)) throw new Error('unexpected document');
        return Response.json({ ok: true, result: { file_path: `documents/${ref}` } });
      }
      const document = documents.get(parsed.pathname.split('/').at(-1)!)!;
      return new Response(new Uint8Array(await corrupt(document.bytes, document.name)));
    },
  });
  return runPublish(payloadPath, {
    root,
    logger: () => {},
    showMediaSource: media,
    env: {
      PUBLISH_CALLBACK_URL: 'https://worker.test/callbacks/published',
      PUBLISH_CALLBACK_SECRET: secret,
    },
    fetchImpl: async (url, init) => {
      if (callbackLost) {
        callbackLost = false;
        return new Response(null, { status: 503 });
      }
      return handlePublishedCallback(env, new Request(url, init));
    },
    ...overrides,
  });
}

it('publishes exact approved documents and retries lost dispatch and callback without changing Git content', async () => {
  dispatchLost = true;
  await consent();
  const approved = structuredClone((await stored()).draft.extras['showApproved']) as PublishJob;
  expect((await stored()).draft.state).toBe('ready');
  await bot.handleUpdate(callbackQueryUpdate(11, 11, `show:${id}:regen:${version}.image-0`));
  await consent();
  expect(dispatches).toHaveLength(2);
  expect(dispatches[1]).toEqual(dispatches[0]);
  callbackLost = true;
  const result = await publish();
  expect((await stored()).draft.state).toBe('publishing');
  const head = (await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout;
  await publish();
  await publish(); // Duplicate signed completion is harmless.
  expect((await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout).toBe(head);
  expect((await stored()).draft.state).toBe('published');
  expect((await stored()).draft.extras['showApproved']).toEqual(approved);
  expect(result.show?.workId).toBe(work.id);
  expect(result.show?.versions).toEqual(work.versions);
  expect(await store.listShows(tenant)).toEqual([result.show]);
  expect(await store.listPosts(tenant)).toEqual([]);
  expect(await store.listWorks(tenant)).toEqual([work]);
  expect(await store.readShow('another-tenant', id)).toBeUndefined();
  for (const document of documents.values()) {
    expect(document.bytes).toEqual(
      new Uint8Array(
        document.name.endsWith('.mp4')
          ? fixtures.markedVideo.result.bytes
          : fixtures.markedImage.result.bytes,
      ),
    );
    expect(await store.readShowMedia(tenant, id, document.name)).toEqual(document.bytes);
  }
});
it.each(['strip-image', 'strip-video', 'alter-marker'] as const)(
  'rejects %s after Telegram download before writing or completing',
  async (mode) => {
    await consent();
    corrupt = async (bytes, name) => {
      if (mode === 'strip-video' && name.endsWith('.mp4')) return stripVideoMetadata(bytes);
      if (mode === 'strip-image' && name.endsWith('.png')) return stripImageMetadata(bytes);
      if (mode === 'alter-marker' && name.endsWith('.png')) return tamperImageMetadata(bytes);
      return bytes;
    };
    await expect(publish()).rejects.toThrow('marking failed');
    expect(await store.readShow(tenant, id)).toBeUndefined();
    expect((await stored()).draft.state).toBe('publishing');
    corrupt = async (bytes) => bytes;
    await publish();
    expect((await stored()).draft.state).toBe('published');
  },
);
it('resumes interrupted persistence using the frozen payload and rejects a different tenant', async () => {
  await bot.handleUpdate(callbackQueryUpdate(12, 12, `show:${id}:approve:${version}`));
  expect(dispatches).toEqual([]);
  await consent();
  const payload = structuredClone(dispatches[0]!);
  await expect(
    publish(payload, {
      git: {
        commit: async () => {
          throw new Error('commit interrupted');
        },
      },
    }),
  ).rejects.toThrow('commit interrupted');
  expect((await stored()).draft.state).toBe('publishing');
  await expect(publish({ ...payload, tenantId: 'another-tenant' })).rejects.toThrow();
  await publish(payload);
  expect((await stored()).draft.state).toBe('published');
  expect(await store.listShows(tenant)).toHaveLength(1);
});
