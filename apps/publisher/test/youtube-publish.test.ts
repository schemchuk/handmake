import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { createYoutubeAdapter } from '@handmake/channels';
import { ChannelRegistry } from '@handmake/core';
import type { PublishedCallbackBody, WorkPublication } from '@handmake/core';
import { FakeChannelAdapter, FakeNotifier } from '@handmake/core/testing';
import { GitRepoContentStore } from '@handmake/stores';
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { runPublish } from '../src/publish';
import type { DispatchPayload } from '../src/payload';
import { writeTelegramOnlyTenantConfig } from './helpers/tenant-config';

const exec = promisify(execFile);
const tenantId = 'faden-und-stimmung';
const id = '01JBCA1B2C3D4E5F6G7H8J9K0M';
const work: WorkPublication = {
  date: '2026-11-22T10:00:00Z',
  kind: 'interior',
  collection: 'fixture',
  channels: ['telegram', 'youtube'],
  videoFileId: 'opaque-video',
  videoPeople: 'none',
  versions: {
    uk: { description: 'Шарф', provenance: 'human' },
    de: { description: 'Winterschal\nWeich und warm. #stricken', provenance: 'human' },
  },
  newCollection: {
    order: 1,
    versions: {
      uk: { title: 'UA', description: 'UA collection', provenance: 'human' },
      de: { title: 'DE', description: 'DE collection', provenance: 'human' },
    },
  },
};
const payload: DispatchPayload = {
  tenantId,
  draftId: id,
  kind: 'work',
  type: 'free',
  fileIds: ['opaque-photo'],
  texts: { uk: 'Шарф', de: 'Winterschal\nWeich und warm. #stricken' },
  provenance: 'human',
  work,
};
const secrets = {
  YOUTUBE_CLIENT_ID: 'client',
  YOUTUBE_CLIENT_SECRET: 'secret',
  YOUTUBE_REFRESH_TOKEN: 'refresh',
};
const session = 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=fixture';

let videoBytes: Uint8Array;
let photoBytes: Uint8Array;
let videoDir: string;
let root: string;
let current: DispatchPayload;
let store: GitRepoContentStore;
let logs: string[];
const callback = { send: vi.fn(async (_body: PublishedCallbackBody) => {}) };
const git = { commit: vi.fn(async () => true), push: vi.fn(async () => {}) };

beforeAll(async () => {
  videoDir = await mkdtemp(path.join(tmpdir(), 'handmake-yt-video-'));
  const file = path.join(videoDir, 'input.mp4');
  await exec('ffmpeg', [
    ...['-v', 'error', '-f', 'lavfi', '-i', 'color=s=16x16:r=1', '-t', '1'],
    ...['-c:v', 'libx264', '-threads', '1', file],
  ]);
  videoBytes = new Uint8Array(await readFile(file));
  photoBytes = new Uint8Array(
    await readFile(new URL('./fixtures/with-gps-exif.jpg', import.meta.url)),
  );
});
afterAll(async () => {
  await rm(videoDir, { recursive: true, force: true });
});
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'handmake-yt-publish-'));
  const tenants = path.join(root, 'config/tenants');
  await writeTelegramOnlyTenantConfig(tenants);
  const file = path.join(tenants, 'faden-und-stimmung.yaml');
  const raw = await readFile(file, 'utf8');
  await writeFile(file, raw.replace(/^channels:\n/m, 'channels:\n  youtube:\n    language: de\n'));
  store = new GitRepoContentStore({ rootDir: root });
  current = structuredClone(payload);
  logs = [];
  callback.send.mockClear();
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function google(failUpload = false) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url.startsWith('https://oauth2.googleapis.com/'))
      return new Response(JSON.stringify({ access_token: 'access' }));
    if (url.includes('uploadType=resumable'))
      return failUpload
        ? new Response(JSON.stringify({ error: { errors: [{ reason: 'quotaExceeded' }] } }), {
            status: 403,
          })
        : new Response(null, { headers: { Location: session } });
    if (url === session)
      return new Response(JSON.stringify({ id: 'yt_video_01' }), { status: 201 });
    throw new Error(`unexpected ${url}`);
  });
}

async function run(
  options: { env?: NodeJS.ProcessEnv; fetchImpl?: ReturnType<typeof google> } = {},
) {
  const registry = new ChannelRegistry();
  const telegram = new FakeChannelAdapter({
    key: 'telegram',
    renderImpl: () => [{ kind: 'mediaGroup', photoIndexes: [0], caption: 'UA' }],
  });
  registry.register(telegram);
  const fetchImpl = options.fetchImpl ?? google();
  registry.register(createYoutubeAdapter({ fetchImpl, sleep: async () => {} }));
  const payloadPath = path.join(root, 'payload.json');
  await writeFile(payloadPath, JSON.stringify(current));
  const result = await runPublish(payloadPath, {
    root,
    env: {
      PUBLISH_CALLBACK_URL: 'https://example.invalid/callback',
      PUBLISH_CALLBACK_SECRET: 'fixture',
      ...(options.env ?? secrets),
    },
    git,
    callback,
    registry,
    mediaSource: { fetchPhoto: async () => photoBytes },
    showMediaSource: { fetchMedia: async () => videoBytes },
    notifier: new FakeNotifier(),
    logger: (line) => logs.push(line),
  });
  return { result, telegram, fetchImpl };
}

describe('YouTube Shorts (T78)', () => {
  it('uploads a work video once and records the video id', async () => {
    const { fetchImpl } = await run();
    const uploads = fetchImpl.mock.calls.filter(([url]) => String(url) === session);
    expect(uploads).toHaveLength(1);
    expect((uploads[0]![1]!.body as Uint8Array).length).toBe(videoBytes.length);
    const start = fetchImpl.mock.calls.find(([url]) => String(url).includes('resumable'))!;
    expect(JSON.parse(String(start[1]!.body)).snippet).toMatchObject({ title: 'Winterschal' });
    expect((await store.readLedger(tenantId, id))?.channels.youtube).toMatchObject({
      status: 'done',
      remoteIds: ['yt_video_01'],
    });
    expect(callback.send.mock.calls.at(-1)![0].channels).toHaveProperty('youtube');

    const again = await run();
    expect(again.fetchImpl).not.toHaveBeenCalled();
    expect(again.result.skipped).toContain('youtube');
  });

  it('leaves YouTube out without secrets or without a video, with one log line', async () => {
    const { fetchImpl, result } = await run({ env: {} });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.post.channels).toEqual(['telegram']);
    expect(Object.keys((await store.readLedger(tenantId, id))!.channels)).toEqual(['telegram']);
    expect(logs.filter((line) => line.includes('youtube'))).toEqual([
      'channel youtube: skipped (secrets missing)',
    ]);
    expect(Object.keys(callback.send.mock.calls.at(-1)![0].channels)).toEqual(['telegram']);

    // A retry with the secrets keeps the first run's channel set.
    const retry = await run();
    expect(retry.fetchImpl).not.toHaveBeenCalled();
    expect(logs).toContain('channel youtube: skipped (not in the first run)');

    await rm(path.join(root, 'content'), { recursive: true, force: true });
    delete current.work!.videoFileId;
    delete current.work!.videoPeople;
    const noVideo = await run();
    expect(noVideo.fetchImpl).not.toHaveBeenCalled();
    expect(noVideo.result.post.channels).toEqual(['telegram']);
    expect(logs).toContain('channel youtube: skipped (no video)');
  });

  it('a YouTube render failure still lets the other channels post the video', async () => {
    const long = `Schal\n${'ü'.repeat(2600)}`;
    current.work!.versions.de!.description = long;
    current.texts.de = long;
    await expect(run()).rejects.toThrow(/youtube.*render failed/);
    expect((await store.readLedger(tenantId, `${id}-video`))?.channels.telegram?.status).toBe(
      'done',
    );
  });

  it('a YouTube failure still lets the other channels post the video', async () => {
    await expect(run({ fetchImpl: google(true) })).rejects.toThrow(/quotaExceeded/);
    const ledger = await store.readLedger(tenantId, id);
    expect(ledger?.channels.youtube?.status).toBe('failed');
    expect(ledger?.channels.telegram?.status).toBe('done');
    expect((await store.readLedger(tenantId, `${id}-video`))?.channels.telegram?.status).toBe(
      'done',
    );
    expect(callback.send).not.toHaveBeenCalled();
  });
});
