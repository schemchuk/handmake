import { readFileSync } from 'node:fs';
import { createDraft, newUlid, parseTenantConfig, showDraftDataSchema } from '@handmake/core';
import type { Work } from '@handmake/core';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createD1DraftStore } from '../src/draft-store';
import { createShowDraftFlow } from '../src/show-draft-flow';
import { createShowGenerationLocks } from '../src/show-generation-locks';
import { createAiCostLedger } from '../src/ai-costs';
import { createR2ShowStorage } from '../src/show-storage';
import { createShowTransport, showRequestSignature } from '../src/show-transport';
import { createShowStart, readShowImage } from '../src/show-start';
import type { ShowInput } from '../src/show-input';
import { makeD1 } from './helpers';

const tenant = 'faden-und-stimmung';
const base = parseTenantConfig(
  readFileSync(new URL('../../../config/tenants/faden-und-stimmung.yaml', import.meta.url), 'utf8'),
);
let config: typeof base;
let mf: Miniflare, bucket: R2Bucket, db: D1Database;
let drafts: ReturnType<typeof createD1DraftStore>;
let flow: ReturnType<typeof createShowDraftFlow>;
let transport: ReturnType<typeof createShowTransport>;
let start: ReturnType<typeof createShowStart>;
let id: string, work: Work, input: ShowInput;
const fetchImpl = vi.fn<typeof fetch>();
const telegram = vi.fn(async (_id: string) => ({
  bytes: new Uint8Array([1, 2]),
  mimeType: 'image/png' as const,
}));
const works = { readWork: vi.fn(), listWorks: vi.fn() };
const generator = { generateImage: vi.fn(), generateVideo: vi.fn() };
const get = () => drafts.get(tenant, id).then((s) => s!);
async function saveInput() {
  const stored = await get();
  await drafts.updateShow(
    { ...stored.draft, extras: { showSelection: { workId: work.id }, showInput: input } },
    stored.version,
  );
}
beforeAll(async () => {
  mf = new Miniflare({ script: '', modules: true, r2Buckets: ['SHOW_MEDIA'] });
  bucket = (await mf.getR2Bucket('SHOW_MEDIA')) as unknown as R2Bucket;
  db = await makeD1();
  drafts = createD1DraftStore(db);
});
afterAll(async () => mf.dispose());
beforeEach(async () => {
  vi.clearAllMocks();
  config = structuredClone(base);
  config.shows = {
    models: [
      {
        id: 'fixture',
        name: 'Fixture',
        look: 'Fixture',
        referenceImage: 'persona',
        fictional: true,
        adult: true,
      },
    ],
    image: { model: 'fixture-image', eurPerImage: 0.1 },
    video: { model: 'fixture-video', eurPerSecond: 0.1 },
  };
  id = newUlid();
  work = {
    id,
    tenant,
    date: new Date().toISOString(),
    collection: 'fixture',
    kind: 'worn',
    photos: ['original.png'],
    versions: { uk: { description: 'Unchanged author text', provenance: 'human' } },
  };
  works.readWork.mockResolvedValue(work);
  telegram.mockResolvedValue({ bytes: new Uint8Array([1, 2]), mimeType: 'image/png' });
  fetchImpl.mockResolvedValue(new Response(null, { status: 204 }));
  await bucket.put(`show-input/v1/${tenant}/persona`, new Uint8Array([3, 4]), {
    httpMetadata: { contentType: 'image/png' },
  });
  input = {
    originals: [
      { kind: 'telegram', fileId: 'first' },
      { kind: 'telegram', fileId: 'second' },
    ],
    template: 'worn',
    model: config.shows.models[0],
    ready: true,
    menuConfig: JSON.stringify(config.shows),
  };
  await drafts.create(createDraft(tenant, id, new Date(), { kind: 'show' }), id);
  await saveInput();
  flow = createShowDraftFlow({
    drafts,
    configs: { load: async () => config },
    ledger: createAiCostLedger(db),
    locks: createShowGenerationLocks(db),
    generator,
    results: createR2ShowStorage(bucket).results,
    resolveImage: async (t, ref) => {
      const object = (await bucket.get(`show-input/v1/${t}/${ref}`))!;
      return { bytes: new Uint8Array(await object.arrayBuffer()), mimeType: 'image/png' };
    },
  });
  transport = createShowTransport({ bucket, secret: 'fixture', drafts, flow });
  start = createShowStart({
    bucket,
    drafts,
    configs: { load: async () => config },
    works,
    flow,
    open: (t, s, v) => transport.open(t, s, v, true),
    telegram,
    repo: 'fixture/repo',
    token: 'fixture-token',
    fetchImpl,
  });
});
it('freezes private originals/persona and dispatches canonical coordinates without paid execution', async () => {
  await start(await get());
  const stored = await get();
  const data = showDraftDataSchema.parse(stored.draft.extras['show']);
  expect(data.plan.originals).toHaveLength(2);
  for (const ref of [...data.plan.originals, data.plan.model!.referenceImage]) {
    expect(ref).toMatch(/^snapshot-[a-f0-9]{64}$/);
    expect(await bucket.get(`show-input/v1/${tenant}/${ref}`)).toBeTruthy();
  }
  expect(data.plan.model!.referenceImage).not.toBe('persona');
  const request = JSON.parse(fetchImpl.mock.calls[0]![1]!.body as string);
  const job = await transport.open(tenant, id, stored.version, true);
  expect(request).toEqual({
    ref: 'main',
    inputs: {
      payload: JSON.stringify({
        tenantId: tenant,
        showId: id,
        jobId: job.id,
        version: stored.version,
      }),
    },
  });
  expect(generator.generateImage).not.toHaveBeenCalled();
  // The existing Worker grant boundary resolves the prepared snapshots for Node.
  const requestToWorker = new Request(
    `https://fixture.invalid/internal/shows/${tenant}/${id}/${job.id}/${stored.version}/next/authorize`,
    {
      method: 'POST',
      headers: { 'x-show-time': String(Date.now()), 'x-show-nonce': crypto.randomUUID() },
    },
  );
  requestToWorker.headers.set(
    'x-show-signature',
    await showRequestSignature('fixture', requestToWorker, new Uint8Array()),
  );
  const response = await transport.handle(requestToWorker);
  expect(response.status).toBe(200);
  const grant = (await response.json()) as { kind: string };
  expect(JSON.stringify(grant)).toContain('source-');
  expect(generator.generateImage).not.toHaveBeenCalled();
  expect(work.versions.uk!.description).toBe('Unchanged author text');
});
it.each([
  'unready',
  'one',
  'four',
  'missing-work',
  'wrong-tenant',
  'config',
  'persona',
  'original',
  'template',
])('rejects invalid %s before media preparation', async (change) => {
  if (change === 'unready') input.ready = false;
  if (change === 'one') input.originals.pop();
  if (change === 'four')
    input.originals.push(
      { kind: 'telegram', fileId: 'third' },
      { kind: 'telegram', fileId: 'fourth' },
    );
  if (change === 'missing-work') works.readWork.mockResolvedValue(undefined);
  if (change === 'wrong-tenant') works.readWork.mockResolvedValue({ ...work, tenant: 'other' });
  if (change === 'config') config.shows!.image.eurPerImage = 2;
  if (change === 'persona') input.model = undefined;
  if (change === 'original')
    input.originals[0] = { kind: 'work', workId: work.id, fileName: 'removed.png' };
  if (change === 'template') input.template = 'invalid' as ShowInput['template'];
  await saveInput();
  await expect(start(await get())).rejects.toThrow();
  expect(fetchImpl).not.toHaveBeenCalled();
  expect((await get()).draft.extras['show']).toBeUndefined();
});
it('downloads work originals from the work photos folder', async () => {
  work.photos = ['photo-1.jpg', 'photo-2.jpg'];
  input.originals = work.photos.map((fileName) => ({ kind: 'work', workId: work.id, fileName }));
  await saveInput();
  fetchImpl.mockImplementation(async (url) =>
    String(url).startsWith('https://raw.githubusercontent.com/')
      ? new Response(new Uint8Array([String(url).charCodeAt(String(url).length - 5)]), {
          headers: { 'content-type': 'image/jpeg' },
        })
      : new Response(null, { status: 204 }),
  );
  await start(await get());
  expect(fetchImpl.mock.calls.slice(0, 2).map(([url]) => url)).toEqual(
    work.photos.map(
      (name) =>
        `https://raw.githubusercontent.com/fixture/repo/main/content/works/${id}/photos/${name}`,
    ),
  );
  expect(fetchImpl.mock.calls[0]![1]).toEqual({ redirect: 'manual' });
  expect(fetchImpl).toHaveBeenCalledTimes(3);
});
it('refuses redirected work originals', async () => {
  input.originals = [
    { kind: 'work', workId: work.id, fileName: 'original.png' },
    { kind: 'telegram', fileId: 'second' },
  ];
  await saveInput();
  fetchImpl.mockResolvedValueOnce(
    new Response(null, { status: 302, headers: { location: 'https://elsewhere.invalid/' } }),
  );
  await expect(start(await get())).rejects.toThrow('show input download failed');
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
it('retains references after failed preparation and can retry', async () => {
  telegram.mockRejectedValueOnce(new Error('offline'));
  await expect(start(await get())).rejects.toThrow();
  expect((await get()).draft.extras['showInput']).toEqual(input);
  expect((await get()).draft.extras['show']).toBeUndefined();
  await start(await get());
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
it('retries lost dispatch with identical job coordinates and immutable media', async () => {
  fetchImpl.mockRejectedValueOnce(new Error('lost response'));
  await expect(start(await get())).rejects.toThrow();
  const configured = await get();
  await bucket.put(`show-input/v1/${tenant}/persona`, new Uint8Array([9]), {
    httpMetadata: { contentType: 'image/png' },
  });
  await start(configured);
  expect(fetchImpl.mock.calls[0]![1]!.body).toEqual(fetchImpl.mock.calls[1]![1]!.body);
  expect(await get()).toEqual(configured);
  expect(telegram).toHaveBeenCalledTimes(2);
});
it('allows only one competing preparation to configure/dispatch', async () => {
  const stored = await get();
  const outcomes = await Promise.allSettled([start(stored), start(stored)]);
  expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  await expect(start(stored)).rejects.toThrow();
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
it.each(['missing', 'oversize', 'type'])('fails closed for %s persona storage', async (mode) => {
  if (mode === 'missing') await bucket.delete(`show-input/v1/${tenant}/persona`);
  if (mode === 'oversize')
    await bucket.put(`show-input/v1/${tenant}/persona`, new Uint8Array(20_000_001));
  if (mode === 'type')
    await bucket.put(`show-input/v1/${tenant}/persona`, new Uint8Array([1]), {
      httpMetadata: { contentType: 'text/plain' },
    });
  await expect(start(await get())).rejects.toThrow();
  expect(fetchImpl).not.toHaveBeenCalled();
});
it('bounds streamed downloads and rejects invalid media', async () => {
  for (const response of [
    new Response(''),
    new Response('x', { headers: { 'content-type': 'text/plain' } }),
    new Response(new Uint8Array(20_000_001), { headers: { 'content-type': 'image/png' } }),
  ])
    await expect(readShowImage(response)).rejects.toThrow();
});

it('dispatches regeneration once across concurrent stale starts and resumes a failed dispatch without more paid calls', async () => {
  await db.prepare('DELETE FROM show_generation_locks').run();
  await start(await get());
  generator.generateImage.mockImplementation(async (request) => ({
    bytes: new Uint8Array([1]),
    mimeType: 'image/png',
    callId: request.attemptId,
    model: request.providerModel,
    promptVersion: request.promptVersion,
    costEur: 0.1,
  }));
  generator.generateVideo.mockImplementation(async (request) => ({
    bytes: new Uint8Array([2]),
    mimeType: 'video/mp4',
    callId: request.attemptId,
    model: request.providerModel,
    promptVersion: request.promptVersion,
    costEur: 0.5,
  }));
  await flow.generate(tenant, id);
  const ready = await get();
  fetchImpl.mockClear();
  fetchImpl.mockResolvedValueOnce(new Response(null, { status: 503 }));
  const attempts = await Promise.allSettled([start(ready, 'image-1'), start(ready, 'video')]);
  expect(attempts.every((r) => r.status === 'rejected')).toBe(true);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  const prepared = await get();
  expect(prepared.draft.state).toBe('failed');
  const payload = JSON.parse(fetchImpl.mock.calls[0]![1]!.body as string);
  fetchImpl.mockResolvedValue(new Response(null, { status: 204 }));
  await start(prepared);
  expect(JSON.parse(fetchImpl.mock.calls[1]![1]!.body as string)).toEqual(payload);
  expect(generator.generateImage).toHaveBeenCalledTimes(3);
  expect(generator.generateVideo).toHaveBeenCalledTimes(1);
});
it('rejects a superseded start snapshot before dispatch or private preparation', async () => {
  const stale = await get();
  await drafts.updateShow(stale.draft, stale.version);
  await expect(start(stale)).rejects.toThrow('stale');
  expect(telegram).not.toHaveBeenCalled();
  expect(fetchImpl).not.toHaveBeenCalled();
});
