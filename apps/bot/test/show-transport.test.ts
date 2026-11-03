import { createShowApproval } from '../src/show-approval';
import type { AppContext } from '../src/context';
import type { InputFile } from 'grammy';
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
import { createShowVerificationStore, resolveVerifiedShowSnapshot } from '../src/show-verification';
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
  image: { model: 'fixture/image', eurPerImage: 0.1 },
  video: { model: 'fixture/video', eurPerSecond: 0.1 },
};
let mf: Miniflare, bucket: R2Bucket, db: D1Database;
let drafts: ReturnType<typeof createD1DraftStore>;
let transport: ReturnType<typeof createShowTransport>;
let flow: ReturnType<typeof createShowDraftFlow>;
let show: string, job: string, version: number, attempt: string;
const generator = { generateImage: vi.fn(), generateVideo: vi.fn() };
let media = new Uint8Array([1, 2, 3]);
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
  media = new Uint8Array([1, 2, 3]);
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
    originals: ['original', 'second', 'third'],
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
    model: 'fixture/image',
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

// Node uses the real HTTP protocol and real marking gate against private R2/D1.
async function nodeClient() {
  const { createShowClient } = await import('../../publisher/src/show-executor');
  return createShowClient({
    origin: 'https://worker.test',
    secret,
    job: { tenantId: tenant, showId: show, jobId: job, version },
    now: () => now,
    fetch: async (url, init) => transport.handle(new Request(url, init)),
  });
}
async function nodeFixture() {
  const { markingFixtures } = await import('../../publisher/test/fixtures/show-marking');
  const fixtures = await markingFixtures();
  let client = await nodeClient();
  const { executeShow } = await import('../../publisher/src/show-executor');
  let submissions = 0;
  const generate = async (
    input: {
      tenantId: string;
      showId: string;
      attemptId: string;
      providerModel: string;
      promptVersion: string;
    },
    video: boolean,
  ) => {
    const reservation = await client.journal.reserve(input, 'a'.repeat(64));
    if (reservation.created) {
      submissions++;
      await client.journal.record(input, providerId);
    } else if (!reservation.requestId) throw new Error('reconciliation required');
    return {
      callId: `fal:${providerId}`,
      model: input.providerModel,
      promptVersion: input.promptVersion,
      costEur: video ? 0.5 : 0.1,
      bytes: video ? fixtures.video : fixtures.image,
      mimeType: video ? ('video/mp4' as const) : ('image/png' as const),
    };
  };
  // Distinct provider identities, as required by per-call accounting.
  let id = 0;
  const generateUnique = async (input: Parameters<typeof generate>[0], video: boolean) => {
    const result = await generate(input, video);
    const ticket = await createR2ShowStorage(bucket).readAttempt(input);
    return { ...result, callId: `fal:${ticket.requestId}` };
  };
  const journalRecord = client.journal.record;
  client.journal.record = async (scope) =>
    journalRecord(scope, `019a1b2c-3d4e-7f80-9a1b-${String(++id).padStart(12, '0')}`);
  const generator = {
    generateImage: vi.fn(async (input) => ({
      ...(await generateUnique(input, false)),
      mimeType: 'image/png' as const,
    })),
    generateVideo: vi.fn(async (input) => ({
      ...(await generateUnique(input, true)),
      mimeType: 'video/mp4' as const,
    })),
  };
  return {
    client,
    generator,
    run: () => executeShow(client, generator),
    submissions: () => submissions,
    resumeWith: (next: typeof client) => {
      client = next;
    },
  };
}
it('executes and replays a Node job with separate raw/verified marked results', async () => {
  const fixture = await nodeFixture();
  await fixture.run();
  expect(fixture.submissions()).toBe(4);
  await fixture.run();
  expect(fixture.submissions()).toBe(4);
  const status = await fixture.client.call('status');
  expect(Object.keys(status.outputs)).toHaveLength(4);
  const snapshot = await verifiedSnapshot();
  expect(snapshot.media.map((m) => m.slot)).toEqual(['image-0', 'image-1', 'image-2', 'video']);
  expect(snapshot.media.every((m) => m.evidence.markedSha256 !== m.evidence.rawSha256)).toBe(true);
  for (const output of Object.values(status.outputs) as { attemptId: string }[]) {
    const raw = await fixture.client.raw.get(tenant, show, output.attemptId);
    const marked = await fixture.client.marked.get(tenant, show, output.attemptId);
    expect(marked!.ref).not.toBe(raw!.ref);
    expect(marked!.result.bytes).not.toEqual(raw!.result.bytes);
  }
}, 60_000);
it('resumes after a lost raw upload acknowledgement and a lost marked acknowledgement', async () => {
  const fixture = await nodeFixture();
  for (const store of [fixture.client.raw, fixture.client.marked]) {
    const put = store.put;
    const spy = vi.spyOn(store, 'put').mockImplementationOnce(async (...args) => {
      await put(...args);
      throw new Error('lost acknowledgement');
    });
    await expect(fixture.run()).rejects.toThrow();
    expect(fixture.submissions()).toBe(1);
    spy.mockRestore();
  }
  await fixture.run();
  expect(fixture.submissions()).toBe(4);
}, 60_000);
it('resumes a recorded provider request after job expiry without another submission', async () => {
  const fixture = await nodeFixture();
  const generate = fixture.generator.generateImage.getMockImplementation()!;
  fixture.generator.generateImage.mockImplementationOnce(async (input) => {
    await generate(input);
    throw new Error('provider wait interrupted');
  });
  await expect(fixture.run()).rejects.toThrow('interrupted');
  const current = (await drafts.get(tenant, show))!;
  const later = createShowTransport({ bucket, secret, drafts, flow, now: () => now + 3_600_001 });
  job = (await later.open(tenant, show, current.version)).id;
  version = current.version;
  const { createShowClient, executeShow } = await import('../../publisher/src/show-executor');
  const resumed = createShowClient({
    origin: 'https://worker.test',
    secret,
    job: { tenantId: tenant, showId: show, jobId: job, version },
    now: () => now + 3_600_001,
    fetch: async (url, init) => later.handle(new Request(url, init)),
  });
  // Recovery only reads the recorded identity; no new paid submission for this attempt.
  const record = resumed.journal.record;
  let recoveredId = 10;
  resumed.journal.record = async (scope) =>
    record(scope, `019a1b2c-3d4e-7f80-9a1b-${String(++recoveredId).padStart(12, '0')}`);
  fixture.resumeWith(resumed);
  const pending = (await resumed.call('status')).pending.attemptId;
  const grant = await resumed.grant(pending);
  expect(grant.kind).toBe('image');
  const result = await generate(grant.request as Parameters<typeof generate>[0]);
  await resumed.raw.put(tenant, show, pending, result);
  await executeShow(resumed, fixture.generator);
  expect(fixture.submissions()).toBe(4);
}, 60_000);
it('rejects stale duplicate jobs and sanitizes errors containing secrets', async () => {
  const client = await nodeClient();
  job = (await transport.open(tenant, show, version)).id;
  await expect(client.call('status')).rejects.toThrow(
    'show transport rejected; resume from durable state',
  );
  const { createShowClient } = await import('../../publisher/src/show-executor');
  const broken = createShowClient({
    origin: 'https://worker.test',
    secret,
    job: { tenantId: tenant, showId: show, jobId: job, version },
    fetch: async () => {
      throw new Error(secret);
    },
  });
  await expect(broken.call('status')).rejects.not.toThrow(secret);
});
it('retains billed raw evidence and stops new submissions when marking fails', async () => {
  const fixture = await nodeFixture();
  const generate = fixture.generator.generateImage.getMockImplementation()!;
  fixture.generator.generateImage.mockImplementationOnce(async (input) => ({
    ...(await generate(input)),
    bytes: Buffer.from([1, 2, 3]),
  }));
  await expect(fixture.run()).rejects.toThrow('marking failed');
  const status = await fixture.client.call('status');
  expect(status.pending).toBeUndefined();
  expect(Object.keys(status.outputs)).toHaveLength(1);
  await expect(fixture.run()).rejects.toThrow('marking failed');
  expect(fixture.submissions()).toBe(1);
  const costs = await createAiCostLedger(db).summary(tenant, new Date(now));
  expect(costs.total).toBe(0.1);
}, 30_000);
it('resumes the actual fal adapter through HTTP journal without repeating POST', async () => {
  const { FalShowGenerator } = await import('@handmake/ai');
  const { markingFixtures } = await import('../../publisher/test/fixtures/show-marking');
  media = new Uint8Array((await markingFixtures()).image);
  const client = await nodeClient();
  const authorized = await client.call('authorize');
  const pending = authorized.value.request.attemptId;
  const grant = await client.grant(pending);
  if (grant.kind !== 'image') throw new Error('expected image');
  let posts = 0,
    interrupted = true;
  const adapter = new FalShowGenerator({
    apiKey: 'fixture-key',
    journal: client.journal,
    config: () => config.shows!,
    allowPaidCalls: true,
    verifiedModels: ['fixture/image'],
    maxPolls: 1,
    fetch: async (url, init) => {
      const target = String(url);
      if (init?.method === 'POST') {
        posts++;
        return Response.json({ request_id: providerId });
      }
      if (target.endsWith('/status')) {
        if (interrupted) {
          interrupted = false;
          throw new Error('secret upstream error');
        }
        return Response.json({ status: 'COMPLETED' });
      }
      if (target.startsWith('https://fal.media/'))
        return new Response(media, { headers: { 'content-type': 'image/png' } });
      return Response.json({ images: [{ url: 'https://fal.media/fixture.png' }] });
    },
  });
  await expect(adapter.generateImage(grant.request)).rejects.toThrow('fal show: reconcile');
  expect((await client.call('journal', pending)).value.requestId).toBe(providerId);
  const result = await adapter.generateImage(grant.request);
  await client.raw.put(tenant, show, pending, result);
  expect((await client.call('checkpoint', pending)).value).toBe(true);
  expect(posts).toBe(1);
  expect((await createAiCostLedger(db).summary(tenant, new Date(now))).total).toBe(0.1);
});

it('reopens expired jobs without authorizing another unknown paid submission', async () => {
  await authorize();
  const pending = showDraftDataSchema.parse(
    (await drafts.get(tenant, show))!.draft.extras['show'],
  ).pending;
  await call('reserve', { body: JSON.stringify({ fingerprint: 'a'.repeat(64) }) });
  await call('record', { body: JSON.stringify({ requestId: providerId }) });
  const oldJob = job;
  const resumed = createShowTransport({ bucket, secret, drafts, flow, now: () => now + 3_600_001 });
  const fresh = await resumed.open(tenant, show, version, true);
  expect(fresh.id).not.toBe(oldJob);
  const grant = await bucket.get(`show-grant/v1/${fresh.id}/${attempt}`);
  expect(grant).toBeTruthy();
  job = fresh.id;
  const response = await resumed.handle(
    await request('authorize', { time: now + 3_600_001, attempt: 'next' }),
  );
  expect(response.status).toBe(409);
  expect(
    showDraftDataSchema.parse((await drafts.get(tenant, show))!.draft.extras['show']).pending,
  ).toEqual(pending);
  const ticket = await createR2ShowStorage(bucket).readAttempt({
    tenantId: tenant,
    showId: show,
    attemptId: attempt,
  });
  expect(ticket.requestId).toBe(providerId);
  expect(generator.generateImage).not.toHaveBeenCalled();
});
it('keeps a stable live job identity for duplicate dispatch and refuses missing grants on expiry', async () => {
  expect((await transport.open(tenant, show, version, true)).id).toBe(job);
  await authorize();
  await bucket.delete(`show-grant/v1/${job}/${attempt}`);
  const resumed = createShowTransport({ bucket, secret, drafts, flow, now: () => now + 3_600_001 });
  await expect(resumed.open(tenant, show, version, true)).rejects.toThrow('reconciliation');
  expect(
    showDraftDataSchema.parse((await drafts.get(tenant, show))!.draft.extras['show']).pending
      ?.attemptId,
  ).toBe(attempt);
});

it('recovers a lost grant and unavailable sources via journal GETs with paid gates closed', async () => {
  const { FalShowGenerator } = await import('@handmake/ai');
  const { executeShow } = await import('../../publisher/src/show-executor');
  const { markingFixtures } = await import('../../publisher/test/fixtures/show-marking');
  media = new Uint8Array((await markingFixtures()).image);
  await authorize();
  const pending = attempt;
  await call('reserve', { body: JSON.stringify({ fingerprint: 'b'.repeat(64) }) });
  await call('record', { body: JSON.stringify({ requestId: providerId }) });
  await bucket.delete(`show-grant/v1/${job}/${pending}`);
  await bucket.delete(`show-source/v1/${job}/${pending}/source-0`);
  job = (await transport.open(tenant, show, version, true, true)).id;
  const client = await nodeClient();
  const http = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    expect(init?.method ?? 'GET').toBe('GET');
    if (String(url).endsWith('/status')) return Response.json({ status: 'COMPLETED' });
    if (String(url).startsWith('https://fal.media/'))
      return new Response(media, { headers: { 'content-type': 'image/png' } });
    return Response.json({ images: [{ url: 'https://fal.media/recovered.png' }] });
  });
  const adapter = new FalShowGenerator({
    apiKey: 'fixture',
    journal: client.journal,
    config: () => config.shows!,
    allowPaidCalls: false,
    fetch: http,
    maxPolls: 1,
  });
  await executeShow(client, adapter);
  expect(http).toHaveBeenCalledTimes(3);
  expect((await client.call('status')).pending).toBeUndefined();
  expect((await client.call('status')).outputs['image-0'].attemptId).toBe(pending);
  expect(await createR2MarkedShowStorage(bucket).get(tenant, show, pending)).toBeTruthy();
  expect((await createAiCostLedger(db).summary(tenant, new Date(now))).total).toBe(0.1);
  await expect(client.call('authorize')).rejects.toThrow('transport rejected');
  await expect(
    client.journal.reserve({ tenantId: tenant, showId: show, attemptId: pending }, 'c'.repeat(64)),
  ).rejects.toThrow('transport rejected');
  expect(generator.generateImage).not.toHaveBeenCalled();
}, 60_000);

it('retains an unknown journal reservation and tenant lock when GET recovery has no request id', async () => {
  const { executeShow } = await import('../../publisher/src/show-executor');
  await authorize();
  await call('reserve', { body: JSON.stringify({ fingerprint: 'c'.repeat(64) }) });
  job = (await transport.open(tenant, show, version, true, true)).id;
  const client = await nodeClient();
  const resume = vi.fn();
  await expect(executeShow(client, { ...generator, resume })).rejects.toThrow('transport rejected');
  expect(resume).not.toHaveBeenCalled();
  expect((await client.call('status')).pending.attemptId).toBe(attempt);
  expect(
    await db
      .prepare('SELECT * FROM show_generation_locks WHERE tenant_id = ?')
      .bind(tenant)
      .first(),
  ).toBeTruthy();
});

it('rejects old signed callbacks after cancellation while retaining journal and billing evidence', async () => {
  await authorize();
  await call('reserve', { body: JSON.stringify({ fingerprint: 'd'.repeat(64) }) });
  await call('record', { body: JSON.stringify({ requestId: providerId }) });
  const before = (await drafts.get(tenant, show))!;
  await drafts.updateShow(
    { ...before.draft, extras: { ...before.draft.extras, showCancelled: true } },
    before.version,
  );
  expect((await transport.handle(await request('checkpoint'))).status).toBe(409);
  const confirmation = {
    operatorConfirmed: true as const,
    note: 'Provider invoice checked',
    billing: { callId: `fal:${providerId}`, model: 'fixture/image', costEur: 0.1 },
  };
  expect(await flow.reconcile(tenant, show, attempt, confirmation)).toBe(true);
  expect((await createAiCostLedger(db).summary(tenant, new Date(now))).total).toBe(0.1);
  expect(
    (
      await createR2ShowStorage(bucket).readAttempt({
        tenantId: tenant,
        showId: show,
        attemptId: attempt,
      })
    ).requestId,
  ).toBe(providerId);
  await drafts.deleteOlderThan(new Date('2030-01-01'));
  const retained = (await drafts.get(tenant, show))!;
  expect(showDraftDataSchema.parse(retained.draft.extras['show']).reconciled).toHaveLength(1);
  expect(retained.draft.extras['showCancelled']).toBe(true);
  await expect(transport.open(tenant, show, retained.version, true, true)).rejects.toThrow('stale');
});

async function verifiedSnapshot(stored?: NonNullable<Awaited<ReturnType<typeof drafts.get>>>) {
  return resolveVerifiedShowSnapshot(
    { drafts, verified: createShowVerificationStore(bucket) },
    stored ?? (await drafts.get(tenant, show))!,
  );
}

it('recovers an interrupted verification acknowledgement without new paid submissions', async () => {
  const fixture = await nodeFixture();
  const call = fixture.client.call;
  let interrupted = false;
  vi.spyOn(fixture.client, 'call').mockImplementation(async (...args) => {
    const value = await call(...args);
    if (args[0] === 'verified-put' && !interrupted) {
      interrupted = true;
      throw new Error('lost verification acknowledgement');
    }
    return value;
  });
  await expect(fixture.run()).rejects.toThrow('lost verification');
  expect(fixture.submissions()).toBe(1);
  await expect(verifiedSnapshot()).rejects.toThrow();
  await fixture.run();
  await verifiedSnapshot();
  expect(fixture.submissions()).toBe(4);
}, 60_000);

it('rejects missing evidence, altered receipts, altered bytes and cross-tenant attestations', async () => {
  const fixture = await nodeFixture();
  await fixture.run();
  const snapshot = await verifiedSnapshot();
  const output = snapshot.media[0]!;
  const evidence = output.evidence;
  const key = `show-verified/v1/${tenant}/${show}/${evidence.attemptId}`;
  const original = JSON.stringify(evidence);
  await bucket.delete(key);
  await expect(verifiedSnapshot()).rejects.toThrow('verification missing');
  const verified = createShowVerificationStore(bucket);
  await expect(verified.attest({ ...evidence, tenantId: 'other' })).rejects.toThrow();
  await expect(verified.attest({ ...evidence, rawSha256: '0'.repeat(64) })).rejects.toThrow();
  // Recovery can redeliver identical evidence, never a different claim.
  await verified.attest(evidence);
  await verified.attest(evidence);
  await bucket.put(
    key,
    JSON.stringify({ ...evidence, markedReceipt: { ...evidence.markedReceipt, costEur: 99 } }),
  );
  await expect(verifiedSnapshot()).rejects.toThrow('integrity');
  await expect(verified.attest(evidence)).rejects.toThrow('collision');
  await bucket.put(key, original);
  const mediaKey = `show-marked/v1/${tenant}/${show}/${evidence.attemptId}`;
  const mediaObject = (await bucket.get(mediaKey))!;
  const bytes = new Uint8Array(await mediaObject.arrayBuffer());
  const metadata = mediaObject.customMetadata;
  // Even a self-consistent storage checksum cannot replace attested marked bytes.
  const { createHash } = await import('node:crypto');
  const changed = bytes.slice();
  changed[changed.length - 1] = changed[changed.length - 1]! ^ 1;
  await bucket.put(mediaKey, changed, {
    customMetadata: { ...metadata, sha256: createHash('sha256').update(changed).digest('hex') },
  });
  await expect(verifiedSnapshot()).rejects.toThrow('integrity');
  await bucket.put(mediaKey, bytes, { customMetadata: metadata });
  const rawKey = `show-raw/v1/${tenant}/${show}/${evidence.attemptId}`;
  const rawObject = (await bucket.get(rawKey))!;
  await bucket.put(rawKey, await rawObject.arrayBuffer(), {
    customMetadata: {
      ...rawObject.customMetadata,
      receipt: '{}',
    },
  });
  await expect(verifiedSnapshot()).rejects.toThrow();
}, 60_000);

it('rejects raw or stripped media and never attests a failed Node marking gate', async () => {
  const fixture = await nodeFixture();
  const put = fixture.client.marked.put;
  const { stripImageMetadata } = await import('../../publisher/test/fixtures/show-marking');
  vi.spyOn(fixture.client.marked, 'put').mockImplementationOnce(async (t, s, a, result) => {
    // Re-encode without XMP, retaining the visible footer.
    await put(t, s, a, { ...result, bytes: await stripImageMetadata(result.bytes) });
  });
  await expect(fixture.run()).rejects.toThrow('marking failed');
  const stored = (await drafts.get(tenant, show))!;
  const output = Object.values(showDraftDataSchema.parse(stored.draft.extras['show']).outputs)[0]!;
  expect(await bucket.get(`show-verified/v1/${tenant}/${show}/${output.attemptId}`)).toBeNull();
  await expect(verifiedSnapshot()).rejects.toThrow();
  const raw = (await fixture.client.raw.get(tenant, show, output.attemptId))!;
  const { describeShowVerification } = await import('@handmake/core');
  await expect(
    describeShowVerification(tenant, show, output.attemptId, raw, {
      ...raw,
      ref: raw.ref.replace('show-raw:', 'show-marked:'),
    }),
  ).rejects.toThrow();
}, 60_000);

it('fences cancellation, incomplete outputs and a generation changing during resolution', async () => {
  const fixture = await nodeFixture();
  await fixture.run();
  const stored = (await drafts.get(tenant, show))!;
  const verified = createShowVerificationStore(bucket);
  const resolve = (current: typeof stored, get = verified.get) =>
    resolveVerifiedShowSnapshot(
      {
        drafts: { get: async () => current },
        verified: { get },
      },
      current,
    );
  const cancelled = structuredClone(stored);
  cancelled.draft.extras['showCancelled'] = true;
  await expect(resolve(cancelled)).rejects.toThrow('stale');
  const incomplete = structuredClone(stored);
  const data = showDraftDataSchema.parse(incomplete.draft.extras['show']);
  delete data.outputs['image-0'];
  incomplete.draft.extras['show'] = data;
  await expect(resolve(incomplete)).rejects.toThrow('incomplete');
  let reads = 0;
  await expect(
    resolveVerifiedShowSnapshot(
      {
        drafts: {
          get: async () => (++reads === 1 ? stored : { ...stored, version: stored.version + 1 }),
        },
        verified,
      },
      stored,
    ),
  ).rejects.toThrow('stale');
  const superseded = structuredClone(stored);
  const staleData = showDraftDataSchema.parse(superseded.draft.extras['show']);
  staleData.outputs['image-0']!.attemptId = 'superseded';
  superseded.draft.extras['show'] = staleData;
  await expect(resolve(superseded)).rejects.toThrow('missing');
  const wrongTenant = structuredClone(stored);
  wrongTenant.draft.tenantId = 'other';
  await expect(resolve(wrongTenant)).rejects.toThrow('missing');
}, 60_000);

it('backfills a legacy ready show through a fresh recovery job and offers approval without spending', async () => {
  const fixture = await nodeFixture();
  await fixture.run();
  const initial = (await drafts.get(tenant, show))!;
  const before = await verifiedSnapshot();
  for (const item of before.media)
    await bucket.delete(`show-verified/v1/${tenant}/${show}/${item.evidence.attemptId}`);
  const costs = (await db.prepare('SELECT * FROM ai_costs').all()).results;
  const reply = vi.fn(async () => ({}));
  const upload = vi.fn(async (file: InputFile) => ({
    document: {
      file_id: `tg-${file.filename}`,
      file_unique_id: `unique-${file.filename}`,
      file_name: file.filename,
      file_size: ((await file.toRaw()) as Uint8Array).length,
      mime_type: file.filename!.endsWith('.mp4') ? 'video/mp4' : 'image/png',
    },
  }));
  await drafts.setChatSession(tenant, show, { kind: 'show', draftId: show }, new Date(now));
  const ctx = {
    tenantId: tenant,
    chat: { id: show, type: 'private' },
    reply,
    replyWithDocument: upload,
  } as unknown as AppContext;
  const backfill = vi.fn(async () => {
    const next = await transport.open(tenant, show, initial.version, true, true);
    expect(next.id).not.toBe(job);
    job = next.id;
    version = initial.version;
  });
  const approval = createShowApproval({
    drafts,
    verified: createShowVerificationStore(bucket),
    backfill,
    works: {
      readWork: async () => ({
        id: show,
        tenant,
        date: new Date(now).toISOString(),
        collection: 'fixture',
        kind: 'interior',
        photos: ['original.jpg'],
        versions: { de: { description: 'Fixture', provenance: 'human' } },
      }),
      listWorks: async () => [],
    },
  });
  await approval.present(ctx, initial);
  expect(backfill).toHaveBeenCalledOnce();
  expect(upload).not.toHaveBeenCalled();
  expect(reply).toHaveBeenCalledWith(
    expect.stringContaining('без повторної генерації'),
    expect.anything(),
  );
  const { executeShow } = await import('../../publisher/src/show-executor');
  const client = await nodeClient();
  await executeShow(client, fixture.generator);
  expect(await flow.authorize(tenant, show)).toBeUndefined();
  await expect(client.call('authorize')).rejects.toThrow('transport rejected');
  expect((await db.prepare('SELECT * FROM ai_costs').all()).results).toEqual(costs);
  expect(fixture.submissions()).toBe(4);
  expect((await drafts.get(tenant, show))!.version).toBe(initial.version);
  expect((await verifiedSnapshot()).media.map((i) => i.evidence.attemptId)).toEqual(
    before.media.map((i) => i.evidence.attemptId),
  );
  await approval.present(ctx, initial);
  expect(upload.mock.calls.map(([file]) => file.filename)).toEqual([
    'image-0.png',
    'image-1.png',
    'image-2.png',
    'video.mp4',
  ]);
  expect(reply).toHaveBeenCalledWith(expect.stringContaining('Схвалити'), expect.anything());
  expect(backfill).toHaveBeenCalledOnce();
  // Missing evidence must never bless a marked file whose bytes no longer match its raw source.
  const item = before.media[0]!;
  await bucket.delete(`show-verified/v1/${tenant}/${show}/${item.evidence.attemptId}`);
  await bucket.put(
    `show-marked/v1/${tenant}/${show}/${item.evidence.attemptId}`,
    new Uint8Array([1, 2, 3]),
  );
  version = (await drafts.get(tenant, show))!.version;
  job = (await transport.open(tenant, show, version, true, true)).id;
  const tampered = await nodeClient();
  await expect(executeShow(tampered, fixture.generator)).rejects.toThrow();
  expect(
    await bucket.get(`show-verified/v1/${tenant}/${show}/${item.evidence.attemptId}`),
  ).toBeNull();
  await expect(verifiedSnapshot()).rejects.toThrow();
  expect((await db.prepare('SELECT * FROM ai_costs').all()).results).toEqual(costs);
  expect(fixture.submissions()).toBe(4);
}, 60_000);
