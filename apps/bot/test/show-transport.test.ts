import { readFileSync } from 'node:fs';
import { createDraft, newUlid, parseTenantConfig, showDraftDataSchema } from '@handmake/core';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createAiCostLedger } from '../src/ai-costs';
import { createApp } from '../src/composition';
import { createD1DraftStore } from '../src/draft-store';
import { createShowDraftFlow } from '../src/show-draft-flow';
import { createShowGenerationLocks } from '../src/show-generation-locks';
import { createR2ShowStorage, createR2MarkedShowStorage } from '../src/show-storage';
import { createShowTransport, showRequestSignature } from '../src/show-transport';
import { createShowRuntime } from '../src/show-runtime';
import type { Env } from '../src/env';
import { botTexts } from '../src/texts';
import { makeD1 } from './helpers';

const tenant = 'faden-und-stimmung';
const secret = 'local-test-show-secret';
const now = Date.parse('2026-11-02T12:00:00Z');
const providerId = '019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b';
const config = parseTenantConfig(
  readFileSync(new URL('../../../config/tenants/faden-und-stimmung.yaml', import.meta.url), 'utf8'),
);
config.ai = {
  monthlyTargetEur: 20,
  toleranceEur: 5,
  translation: { model: 'fixture', inputEurPerMillion: 1, outputEurPerMillion: 1 },
};
config.shows = {
  models: [],
  image: { model: 'image-v1', eurPerImage: 0.1 },
  video: { model: 'video-v1', eurPerSecond: 0.1 },
};
let mf: Miniflare, bucket: R2Bucket, db: D1Database;
let drafts: ReturnType<typeof createD1DraftStore>;
let transport: ReturnType<typeof createShowTransport>;
let flow: ReturnType<typeof createShowDraftFlow>;
let show: string, job: string, version: number, attempt: string;
const generator = { generateImage: vi.fn(), generateVideo: vi.fn() };
const media = new Uint8Array([1, 2, 3]);
beforeAll(async () => {
  mf = new Miniflare({ script: '', modules: true, r2Buckets: ['SHOW_MEDIA'] });
  bucket = (await mf.getR2Bucket('SHOW_MEDIA')) as unknown as R2Bucket;
  db = await makeD1();
  drafts = createD1DraftStore(db);
});
afterAll(async () => {
  await mf.dispose();
});
beforeEach(async () => {
  // One tenant lock per fixture, as in production. Retain prior raw evidence.
  await db.prepare('DELETE FROM show_generation_locks').run();
  await db.prepare('DELETE FROM ai_costs').run();
  show = newUlid();
  await drafts.create(createDraft(tenant, show, new Date(now), { kind: 'show' }), show);
  flow = createShowDraftFlow({
    drafts,
    configs: { load: async () => config },
    ledger: createAiCostLedger(db),
    locks: createShowGenerationLocks(db),
    generator,
    results: createR2ShowStorage(bucket).results,
    resolveImage: async () => ({ bytes: media, mimeType: 'image/png' }),
    now: () => new Date(now),
  });
  await flow.configure((await drafts.get(tenant, show))!, {
    workId: show,
    template: 'interior',
    originals: ['original'],
    imageCount: 3,
    provider: { image: config.shows!.image, video: config.shows!.video },
  });
  transport = createShowTransport({ bucket, secret, drafts, flow, now: () => now });
  version = (await drafts.get(tenant, show))!.version;
  job = (await transport.open(tenant, show, version)).id;
  attempt = 'next';
  vi.clearAllMocks();
});
async function request(
  operation: string,
  options: {
    body?: Uint8Array | string;
    receipt?: string;
    time?: number;
    nonce?: string;
    signingKey?: string;
    tenant?: string;
    show?: string;
    job?: string;
    version?: number;
    attempt?: string;
  } = {},
) {
  const bytes =
    typeof options.body === 'string'
      ? new TextEncoder().encode(options.body)
      : (options.body ?? new Uint8Array());
  const req = new Request(
    `https://local.invalid/internal/shows/${options.tenant ?? tenant}/${options.show ?? show}/${options.job ?? job}/${options.version ?? version}/${options.attempt ?? attempt}/${operation}`,
    {
      method: 'POST',
      body: bytes,
      headers: {
        'x-show-time': String(options.time ?? now),
        'x-show-nonce': options.nonce ?? crypto.randomUUID(),
        ...(options.receipt ? { 'x-show-receipt': options.receipt } : {}),
      },
    },
  );
  req.headers.set(
    'x-show-signature',
    await showRequestSignature(options.signingKey ?? secret, req, bytes),
  );
  return req;
}
async function call(operation: string, options: Parameters<typeof request>[1] = {}) {
  const response = await transport.handle(await request(operation, options));
  if (response.ok) {
    const header = response.headers.get('x-show-version');
    if (header) version = Number(header);
    else version = ((await response.clone().json()) as { version: number }).version;
  }
  return response;
}
async function authorize() {
  const response = await call('authorize');
  expect(response.status).toBe(200);
  const grant = ((await response.json()) as { value: { request: { attemptId: string } } }).value;
  attempt = grant.request.attemptId;
  return grant;
}
function receipt() {
  return JSON.stringify({
    attemptId: attempt,
    ref: `show-raw:v1:${tenant}:${show}:${attempt}`,
    callId: `fal:${providerId}`,
    model: 'image-v1',
    promptVersion: 'show-interior@1',
    costEur: 0.1,
    mimeType: 'image/png',
  });
}

it('runs grants, private source reads, journal, raw upload, checkpoint and separate marked storage', async () => {
  const grant = await authorize();
  expect(JSON.stringify(grant)).not.toMatch(/https?:|bytes|secret/);
  const source = await call('source-0');
  expect(new Uint8Array(await source.arrayBuffer())).toEqual(media);
  expect(source.headers.get('cache-control')).toBe('no-store');
  const reserve = { body: JSON.stringify({ fingerprint: 'a'.repeat(64) }) };
  expect(await (await call('reserve', reserve)).json()).toMatchObject({ value: { created: true } });
  expect(await (await call('reserve', reserve)).json()).toMatchObject({
    value: { created: false },
  });
  expect((await call('record', { body: JSON.stringify({ requestId: providerId }) })).status).toBe(
    200,
  );
  expect((await call('record', { body: JSON.stringify({ requestId: providerId }) })).status).toBe(
    200,
  );
  expect((await call('raw-put', { body: media, receipt: receipt() })).status).toBe(200);
  expect(await (await call('journal')).json()).toMatchObject({ value: { requestId: providerId } });
  expect((await call('raw-put', { body: media, receipt: receipt() })).status).toBe(200);
  expect((await call('marked-get')).status).toBe(409);
  const download = await call('raw-get');
  expect(new Uint8Array(await download.arrayBuffer())).toEqual(media);
  expect(download.headers.get('x-show-receipt')).toContain(providerId);
  expect((await call('checkpoint')).status).toBe(200);
  const data = showDraftDataSchema.parse((await drafts.get(tenant, show))!.draft.extras['show']);
  expect(data.pending).toBeUndefined();
  expect(data.outputs['image-0']?.attemptId).toBe(attempt);
  expect((await createAiCostLedger(db).summary(tenant, new Date(now))).total).toBe(0.1);
  expect((await call('checkpoint')).status).toBe(200);
  expect((await createAiCostLedger(db).summary(tenant, new Date(now))).total).toBe(0.1);
  expect((await call('marked-put', { body: new Uint8Array([4]), receipt: receipt() })).status).toBe(
    200,
  );
  expect(
    (await createR2MarkedShowStorage(bucket).get(tenant, show, attempt))!.result.bytes,
  ).toEqual(new Uint8Array([4]));
  expect(
    (await createR2ShowStorage(bucket).results.get(tenant, show, attempt))!.result.bytes,
  ).toEqual(media);
  expect(generator.generateImage).not.toHaveBeenCalled();
  expect(generator.generateVideo).not.toHaveBeenCalled();
});

it.each([
  { signingKey: 'wrong' },
  { time: now - 300_001 },
  { time: now + 300_001 },
  { nonce: '../unsafe' },
])('rejects invalid or expired authentication %j', async (options) => {
  expect((await call('authorize', options)).status).toBe(401);
  expect((await drafts.get(tenant, show))!.version).toBe(version);
});
it('binds body, path and receipt to the signature', async () => {
  await authorize();
  for (const change of ['body', 'path', 'receipt']) {
    const signed = await request('reserve', { body: '{"fingerprint":"a"}' });
    const headers = new Headers(signed.headers);
    if (change === 'receipt') headers.set('x-show-receipt', receipt());
    const modified = new Request(
      change === 'path' ? signed.url.replace('/reserve', '/record') : signed.url,
      {
        method: 'POST',
        headers,
        body: change === 'body' ? '{"fingerprint":"b"}' : '{"fingerprint":"a"}',
      },
    );
    expect((await transport.handle(modified)).status).toBe(401);
  }
});
it('atomically rejects concurrent replay across transport instances', async () => {
  await authorize();
  const signed = await request('reserve', {
    body: JSON.stringify({ fingerprint: 'a'.repeat(64) }),
  });
  const other = createShowTransport({ bucket, secret, drafts, flow, now: () => now });
  const responses = await Promise.all([
    transport.handle(signed.clone()),
    other.handle(signed.clone()),
  ]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
});
it.each([
  { tenant: 'another-tenant' },
  { show: 'another-show' },
  { job: 'another-job' },
  { version: 999 },
  { attempt: 'another-attempt' },
])('rejects cross-scope or stale requests %j', async (options) => {
  await authorize();
  expect((await call('raw-put', { ...options, body: media, receipt: receipt() })).status).toBe(409);
  expect(await createR2ShowStorage(bucket).results.get(tenant, show, attempt)).toBeUndefined();
});
it('recovers status and the same grant after an acknowledgement is lost', async () => {
  const oldVersion = version;
  const grant = await authorize();
  const response = await call('status', { version: oldVersion, attempt: 'next' });
  expect(await response.json()).toMatchObject({ version, pending: { attemptId: attempt } });
  expect(
    (await call('raw-put', { version: oldVersion, body: media, receipt: receipt() })).status,
  ).toBe(409);
  expect(await (await call('grant')).json()).toEqual({ version, value: grant });
  expect((await call('authorize', { attempt: 'next' })).status).toBe(409);
});
it('fences a previous job and a draft modified outside the job', async () => {
  const previous = job;
  job = (await transport.open(tenant, show, version)).id;
  expect((await call('authorize', { job: previous })).status).toBe(409);
  const stored = (await drafts.get(tenant, show))!;
  await drafts.updateShow(stored.draft, stored.version);
  expect((await call('authorize')).status).toBe(409);
});
it('expires a job independently of fresh request authentication', async () => {
  transport = createShowTransport({ bucket, secret, drafts, flow, now: () => now + 3_600_001 });
  expect((await call('authorize', { time: now + 3_600_001 })).status).toBe(409);
});
it('lets exactly one concurrent authorization persist a pending grant', async () => {
  const replies = await Promise.all([call('authorize'), call('authorize')]);
  expect(replies.map((r) => r.status).sort()).toEqual([200, 409]);
  const state = showDraftDataSchema.parse((await drafts.get(tenant, show))!.draft.extras['show']);
  expect(state.pending?.attemptId).toBeTruthy();
  expect(Object.keys(state.outputs)).toHaveLength(0);
});
it('requires journal identity and preserves receipts when uploads conflict', async () => {
  await authorize();
  expect((await call('raw-put', { body: media, receipt: receipt() })).status).toBe(409);
  await call('reserve', { body: JSON.stringify({ fingerprint: 'a'.repeat(64) }) });
  await call('record', { body: JSON.stringify({ requestId: providerId }) });
  expect(
    (await call('raw-put', { body: media, receipt: receipt().replace(providerId, 'another-id') }))
      .status,
  ).toBe(409);
  expect((await call('raw-put', { body: media, receipt: receipt() })).status).toBe(200);
  expect((await call('raw-put', { body: new Uint8Array([9]), receipt: receipt() })).status).toBe(
    409,
  );
  expect(
    (await call('marked-put', { body: media, receipt: receipt().replace('0.1', '0.2') })).status,
  ).toBe(409);
  expect(
    (await createR2ShowStorage(bucket).results.get(tenant, show, attempt))!.result.bytes,
  ).toEqual(media);
});
it('fences interrupted requests until the lease expires, then permits an internal recovery job', async () => {
  const key = `show-job/v1/${tenant}/${show}`;
  const stored = (await bucket.get(key))!;
  const interrupted = { ...(await stored.json<Record<string, unknown>>()), busy: now };
  await bucket.put(key, JSON.stringify(interrupted));
  expect((await call('authorize')).status).toBe(409);
  await expect(transport.open(tenant, show, version)).rejects.toThrow('recovery');
  const resumed = createShowTransport({ bucket, secret, drafts, flow, now: () => now + 600_001 });
  const next = await resumed.open(tenant, show, version);
  expect(next.id).not.toBe(job);
  expect((await resumed.handle(await request('authorize', { time: now + 600_001 }))).status).toBe(
    409,
  );
});
it('rejects corrupt job metadata and missing signatures', async () => {
  const signed = await request('authorize');
  signed.headers.delete('x-show-signature');
  expect((await transport.handle(signed)).status).toBe(401);
  await bucket.put(`show-job/v1/${tenant}/${show}`, JSON.stringify({ id: job, version }));
  expect((await call('authorize')).status).toBe(409);
});
it('bounds streamed media and JSON, rejects malformed receipts and never logs upstream errors', async () => {
  await authorize();
  const log = vi.spyOn(console, 'error');
  for (const [op, body, meta] of [
    ['raw-put', new Uint8Array(20_000_001), receipt()],
    ['reserve', new Uint8Array(4097), undefined],
    ['raw-put', media, '{}'],
    ['raw-put', media, receipt().replace(attempt, 'wrong-attempt')],
  ] as const) {
    const response = await call(op, { body, receipt: meta });
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain(secret);
  }
  expect(log).not.toHaveBeenCalled();
  log.mockRestore();
});
it('disables show composition when either optional binding is missing', async () => {
  const env = { DB: db, GITHUB_REPO: 'owner/repo' } as Env;
  expect(createShowRuntime(env)).toBeUndefined();
  expect(createShowRuntime({ ...env, SHOW_MEDIA: bucket })).toBeUndefined();
  expect(createShowRuntime({ ...env, SHOW_TRANSPORT_SECRET: secret })).toBeUndefined();
  expect((await createApp(env, botTexts).handle(await request('authorize'))).status).toBe(503);
});
