import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { PublishedCallbackBody } from '@handmake/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { DispatchPayload } from '../src/payload';
import { runPublish } from '../src/publish';
import { writeTelegramOnlyTenantConfig } from './helpers/tenant-config';

const id = '01JBCA1B2C3D4E5F6G7H8J9K0M';
const tenantId = 'faden-und-stimmung';
const origin = 'https://fadenundstimmung.de';
const de = {
  description: `${'Schal '.repeat(30)}\n${'Weich '.repeat(100)}`,
  provenance: 'human',
} as const;
const uk = { description: 'Шарф', provenance: 'human' } as const;
const payload: DispatchPayload = {
  tenantId,
  draftId: id,
  kind: 'work',
  type: 'free',
  fileIds: ['photo'],
  texts: { uk: uk.description, de: de.description },
  provenance: 'human',
  work: {
    kind: 'interior',
    date: '2026-11-22T10:00:00Z',
    collection: 'fixture',
    channels: ['pinterest'],
    versions: { uk, de },
    newCollection: {
      order: 1,
      versions: { uk: { ...uk, title: 'Шарфи' }, de: { ...de, title: 'Schals' } },
    },
  },
};
const secrets = {
  PINTEREST_APP_ID: 'app',
  PINTEREST_APP_SECRET: 'secret',
  PINTEREST_REFRESH_TOKEN: 'refresh',
  PINTEREST_BOARD_ID: '123',
};
const api = 'https://api.pinterest.com/v5';
const upload = 'https://example.invalid/upload';
const now = new Date('2026-11-22T18:30:00.000Z');
let root: string;
let current: DispatchPayload;
const video = new Uint8Array([1, 2, 3]);
vi.mock('../src/authentic-media', () => ({
  stripAuthenticVideo: async (bytes: Uint8Array) => bytes,
}));
const callback = { send: vi.fn(async (_body: PublishedCallbackBody) => {}) };
const logger = vi.fn();
const fetchImpl = vi.fn<typeof fetch>(async (input) => {
  switch (String(input)) {
    case `${api}/oauth/token`:
      return Response.json({ access_token: 'access' });
    case `${api}/media`:
      return Response.json({ media_id: '234', upload_url: upload, upload_parameters: {} });
    case upload:
      return new Response(null, { status: 204 });
    case `${api}/media/234`:
      return Response.json({ status: 'succeeded' });
    case `${api}/pins`:
      return Response.json({ id: '345' });
    default:
      throw new Error('Unexpected request');
  }
});

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'handmake-pinterest-'));
  current = structuredClone(payload);
  vi.clearAllMocks();
  const tenants = path.join(root, 'config/tenants');
  await writeTelegramOnlyTenantConfig(tenants);
  const file = path.join(tenants, `${tenantId}.yaml`);
  const raw = await readFile(file, 'utf8');
  await writeFile(
    file,
    raw.replace(
      'channels:\n',
      "channels:\n  pinterest:\n    language: de\n    boardId: PINTEREST_BOARD_ID\n    delay: { nextDayAt: '09:00' }\n",
    ),
  );
});

afterEach(async () => rm(root, { recursive: true, force: true }));

async function run(channels: string[], env: NodeJS.ProcessEnv = secrets) {
  const file = path.join(root, 'payload.json');
  await writeFile(file, JSON.stringify({ ...current, channels }));
  return runPublish(file, {
    root,
    now,
    logger,
    callback,
    fetchImpl,
    env: {
      PUBLISH_CALLBACK_URL: 'https://example.invalid/callback',
      PUBLISH_CALLBACK_SECRET: 'fixture',
      ...env,
    },
    git: { commit: async () => true, push: async () => {} },
    mediaSource: {
      fetchPhoto: async () => readFile(new URL('./fixtures/with-gps-exif.jpg', import.meta.url)),
    },
    showMediaSource: { fetchMedia: async () => video },
  });
}

it.each(['image', 'video'])(
  'publishes a delayed %s Pin once, with the canonical work link',
  async (kind) => {
    if (kind === 'video') {
      current.work!.videoFileId = 'video';
      current.work!.videoPeople = 'none';
    }

    const initial = await run([]);
    expect(initial.ledger.channels['pinterest']?.status).toBe('pending');
    expect(callback.send.mock.lastCall?.[0]).toMatchObject({
      pinterestPendingSince: now.toISOString(),
      channels: {},
    });
    expect(fetchImpl).not.toHaveBeenCalled();

    const followup = await run(['pinterest']);
    const pin = JSON.parse(String(fetchImpl.mock.lastCall?.[1]?.body));
    expect(fetchImpl.mock.lastCall?.[0]).toBe(`${api}/pins`);
    expect(pin).toMatchObject({
      board_id: '123',
      title: de.description.slice(0, 100),
      description: de.description.slice(0, 500),
      link: `${origin}/works/${id.toLowerCase()}/`,
    });
    const cover = expect.stringMatching(
      new RegExp(`^${origin}/work-media/${id.toLowerCase()}/photo-1\\.jpg/\\d+\\.webp$`),
    );
    expect(pin.media_source).toEqual(
      kind === 'video'
        ? { source_type: 'video_id', media_id: '234', cover_image_url: cover }
        : { source_type: 'image_url', url: cover },
    );
    expect(fetchImpl.mock.calls.some(([url]) => url === upload)).toBe(kind === 'video');
    expect(followup.ledger.channels['pinterest']).toMatchObject({
      status: 'done',
      remoteIds: ['345'],
    });
    expect(callback.send.mock.lastCall?.[0]).not.toHaveProperty('pinterestPendingSince');
    expect(callback.send.mock.lastCall?.[0].channels).toHaveProperty('pinterest');

    fetchImpl.mockClear();
    expect((await run(['pinterest'])).skipped).toEqual(['pinterest']);
    expect(fetchImpl).not.toHaveBeenCalled();
  },
);

it('skips without a required secret and omits the ledger channel and follow-up signal', async () => {
  const initial = await run([], { ...secrets, PINTEREST_BOARD_ID: '' });
  expect(initial.post.channels).toEqual([]);
  expect(initial.ledger.channels).toEqual({});
  expect(callback.send.mock.lastCall?.[0]).not.toHaveProperty('pinterestPendingSince');
  expect(logger.mock.calls.filter(([line]) => line.includes('pinterest:'))).toEqual([
    ['channel pinterest: skipped (secrets missing)'],
  ]);
  expect((await run(['pinterest'])).ledger.channels).toEqual({});
  expect(fetchImpl).not.toHaveBeenCalled();
});
