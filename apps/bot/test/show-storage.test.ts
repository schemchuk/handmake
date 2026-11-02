import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Miniflare } from 'miniflare';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { FalShowGenerator } from '@handmake/ai';
import type { ShowCallResult, ShowImageRequest } from '@handmake/core';
import { createR2ShowStorage, ShowStorageError } from '../src/show-storage';

const scope = { tenantId: 'tenant-a', showId: 'show-one', attemptId: 'attempt-one' };
const requestId = '019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b';
const otherId = '019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7c';
const fingerprint = 'a'.repeat(64);
const rawKey = 'show-raw/v1/tenant-a/show-one/attempt-one';
const ticketKey = 'show-attempt/v1/tenant-a/show-one/attempt-one';
const bytes = new Uint8Array([1, 2, 3]);
const result: ShowCallResult<'image/png'> = {
  callId: `fal:${requestId}`,
  model: 'fal-ai/edit/image',
  promptVersion: 'show-interior@1',
  costEur: 0.1,
  mimeType: 'image/png',
  bytes,
};
let miniflare: Miniflare;
let persist: string;
let bucket: R2Bucket;
let storage: ReturnType<typeof createR2ShowStorage>;
async function start() {
  miniflare = new Miniflare({
    script: '',
    modules: true,
    r2Buckets: ['SHOWS'],
    r2Persist: persist,
  });
  bucket = (await miniflare.getR2Bucket('SHOWS')) as unknown as R2Bucket;
  storage = createR2ShowStorage(bucket);
}
beforeAll(async () => {
  persist = await mkdtemp(path.join(tmpdir(), 'handmake-show-storage-'));
  await start();
});
afterEach(async () => {
  const objects = await bucket.list();
  if (objects.objects.length) await bucket.delete(objects.objects.map((o) => o.key));
});
afterAll(async () => {
  await miniflare?.dispose();
  await rm(persist, { recursive: true, force: true });
});
const put = (value = result) =>
  storage.results.put(scope.tenantId, scope.showId, scope.attemptId, value);
const get = () => storage.results.get(scope.tenantId, scope.showId, scope.attemptId);
async function rejects(promise: Promise<unknown>, code: ShowStorageError['code']) {
  const error = await promise.catch((error) => error);
  expect(error).toBeInstanceOf(ShowStorageError);
  if (!(error instanceof ShowStorageError)) throw new Error('expected storage error');
  expect(error.code).toBe(code);
  expect(error.message).not.toContain('upstream-secret');
  expect(error.cause).toBeUndefined();
}
/** Inject a failure into a real R2 bucket without replacing its conditional-write semantics. */
function faultyPut(
  run: (
    key: string,
    value: Parameters<R2Bucket['put']>[1],
    options?: R2PutOptions,
  ) => Promise<R2Object | null>,
) {
  return createR2ShowStorage(
    new Proxy(bucket, {
      get(target, name) {
        if (name === 'put') return run;
        const value = Reflect.get(target, name);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }),
  );
}

describe('durable raw show results', () => {
  it('returns undefined for a missing result', async () => {
    expect(await get()).toBeUndefined();
  });
  it('stores bytes, exact receipt and an explicitly raw reference', async () => {
    await put();
    expect(await get()).toEqual({ ref: 'show-raw:v1:tenant-a:show-one:attempt-one', result });
    expect(await storage.resolveRaw(scope.tenantId, (await get())!.ref)).toEqual(result);
    const objects = await bucket.list();
    expect(objects.objects.map((o) => o.key)).toEqual([rawKey]);
  });
  it('keeps both a result and journal identity after disposing and restarting the runtime', async () => {
    await storage.journal.reserve(scope, fingerprint);
    await storage.journal.record(scope, requestId);
    await put();
    await miniflare.dispose();
    await start();
    expect(await get()).toEqual({ ref: 'show-raw:v1:tenant-a:show-one:attempt-one', result });
    expect(await storage.journal.reserve(scope, fingerprint)).toEqual({
      created: false,
      fingerprint,
      requestId,
    });
  });
  it('deduplicates concurrent identical puts and ignores property ordering', async () => {
    const reordered = {
      bytes,
      mimeType: result.mimeType,
      costEur: result.costEur,
      promptVersion: result.promptVersion,
      model: result.model,
      callId: result.callId,
    };
    await Promise.all([put(), put(reordered), put()]);
    expect((await get())!.result).toEqual(result);
    expect((await bucket.list()).objects).toHaveLength(1);
  });
  it.each([
    { bytes: new Uint8Array([3, 2, 1]) },
    { callId: `fal:${otherId}` },
    { costEur: 0.2 },
    { model: 'other/model' },
    { promptVersion: 'show-interior@2' },
    { mimeType: 'image/jpeg' as const },
  ])('rejects collisions without changing the committed result: %j', async (change) => {
    await put();
    await rejects(put({ ...result, ...change } as typeof result), 'collision');
    expect((await get())!.result).toEqual(result);
  });
  it('allows only one of two concurrent conflicting results', async () => {
    const outcomes = await Promise.allSettled([put(), put({ ...result, costEur: 0.5 })]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const failed = outcomes.find((o) => o.status === 'rejected') as PromiseRejectedResult;
    expect(failed.reason).toMatchObject({ code: 'collision' });
    expect([0.1, 0.5]).toContain((await get())!.result.costEur);
  });
  it('isolates tenants, shows and attempts sharing other identifiers', async () => {
    await put();
    for (const next of [
      { ...scope, tenantId: 'tenant-b' },
      { ...scope, showId: 'show-two' },
      { ...scope, attemptId: 'attempt-two' },
    ]) {
      expect(await storage.results.get(next.tenantId, next.showId, next.attemptId)).toBeUndefined();
      await storage.results.put(next.tenantId, next.showId, next.attemptId, {
        ...result,
        costEur: 0.2,
      });
    }
    expect((await get())!.result.costEur).toBe(0.1);
  });
  it('never resolves another tenant or a marked/platform reference as raw', async () => {
    await put();
    const ref = (await get())!.ref;
    for (const bad of [
      ref.replace('tenant-a', 'tenant-b'),
      'show-marked:v1:tenant-a:show-one:attempt-one',
      'telegram-file-id',
      ref + ':extra',
      ref.replace('show-one', '..'),
    ])
      await rejects(storage.resolveRaw('tenant-a', bad), 'invalid-input');
    await rejects(storage.resolveRaw('tenant-b', ref), 'invalid-input');
    await rejects(storage.resolveRaw('tenant-a', ref.replace('attempt-one', 'missing')), 'missing');
  });
  it('cannot expose an incomplete receipt when a write fails before committing', async () => {
    const failing = faultyPut(async () => {
      throw new Error('upstream-secret');
    });
    await rejects(
      failing.results.put(scope.tenantId, scope.showId, scope.attemptId, result),
      'storage',
    );
    expect(await get()).toBeUndefined();
    expect((await bucket.list()).objects).toHaveLength(0);
    await put();
    expect((await get())!.result).toEqual(result);
  });
  it('recovers idempotently if the write commits but its acknowledgement is lost', async () => {
    const uncertain = faultyPut(async (key, value, options) => {
      await bucket.put(key, value, options);
      throw new Error('upstream-secret');
    });
    await rejects(
      uncertain.results.put(scope.tenantId, scope.showId, scope.attemptId, result),
      'storage',
    );
    expect((await get())!.result).toEqual(result);
    await put();
    expect((await bucket.list()).objects).toHaveLength(1);
  });
  it('snapshots caller-owned bytes before asynchronous ingestion', async () => {
    const input = new Uint8Array([1, 2, 3]);
    const pending = put({ ...result, bytes: input });
    input.fill(9);
    await pending;
    expect((await get())!.result.bytes).toEqual(bytes);
  });
  it.each([
    { bytes: new Uint8Array() },
    { costEur: NaN },
    { costEur: -1 },
    { costEur: Infinity },
    { mimeType: 'text/html' },
    { model: '' },
    { model: 'x'.repeat(1_801) },
  ])('rejects invalid/oversized result case %# before writing', async (change) => {
    await rejects(put({ ...result, ...change } as typeof result), 'invalid-input');
    expect((await bucket.list()).objects).toHaveLength(0);
  });
  it('rejects a result above the 20 MB limit before writing', async () => {
    await rejects(put({ ...result, bytes: new Uint8Array(20_000_001) }), 'invalid-input');
    expect((await bucket.list()).objects).toHaveLength(0);
  });
  it('supports the complete 20 MB result limit', async () => {
    const large = new Uint8Array(20_000_000);
    large[large.length - 1] = 7;
    await put({ ...result, bytes: large });
    const stored = (await get())!.result.bytes;
    expect(stored.length).toBe(large.length);
    expect(stored[stored.length - 1]).toBe(7);
    expect(stored.subarray(0, 8)).toEqual(new Uint8Array(8));
  }, 15_000);
  it('stores an MP4 receipt without pretending to decode or mark the video', async () => {
    const video = { ...result, mimeType: 'video/mp4' as const, bytes };
    await storage.results.put(scope.tenantId, scope.showId, scope.attemptId, video);
    expect((await get())!.result).toEqual(video);
    expect((await get())!.ref).toMatch(/^show-raw:/);
  });
  it('detects damaged bytes and fails closed on a retry', async () => {
    await put();
    const original = (await bucket.get(rawKey))!;
    await bucket.put(rawKey, new Uint8Array([9, 9, 9]), {
      customMetadata: original.customMetadata,
    });
    await rejects(get(), 'corrupt');
    await rejects(put(), 'corrupt');
  });
  it.each([
    { receipt: '{}' },
    { receipt: 'broken JSON' },
    { receipt: 'x'.repeat(1_801) },
    { sha256: 'bad' },
  ])('rejects incomplete or malformed metadata %j', async (metadata) => {
    await put();
    const original = (await bucket.get(rawKey))!;
    const patch: Record<string, string> = {};
    for (const [key, value] of Object.entries(metadata))
      if (value !== undefined) patch[key] = value;
    await bucket.put(rawKey, bytes, { customMetadata: { ...original.customMetadata, ...patch } });
    await rejects(get(), 'corrupt');
  });
  it('detects a modified receipt even when its schema and media digest are still valid', async () => {
    await put();
    const original = (await bucket.get(rawKey))!;
    const receipt = JSON.parse(original.customMetadata!['receipt']!);
    receipt.costEur = 0.7;
    await bucket.put(rawKey, bytes, {
      customMetadata: { ...original.customMetadata, receipt: JSON.stringify(receipt) },
    });
    await rejects(get(), 'corrupt');
  });
  it('rejects a receipt copied across tenants even when bytes are identical', async () => {
    await put();
    const original = (await bucket.get(rawKey))!;
    await bucket.put(rawKey.replace('tenant-a', 'tenant-b'), bytes, {
      customMetadata: original.customMetadata,
    });
    await rejects(storage.results.get('tenant-b', scope.showId, scope.attemptId), 'corrupt');
  });
  it.each(['../escape', 'a/b', 'a:b', '', 'x'.repeat(129)])(
    'rejects unsafe scope parts %j',
    async (unsafe) => {
      await rejects(
        storage.results.put(unsafe, scope.showId, scope.attemptId, result),
        'invalid-input',
      );
      await rejects(storage.results.get(scope.tenantId, unsafe, scope.attemptId), 'invalid-input');
      await rejects(
        storage.journal.reserve({ ...scope, attemptId: unsafe }, fingerprint),
        'invalid-input',
      );
      expect((await bucket.list()).objects).toHaveLength(0);
    },
  );
});

describe('durable fal attempt journal', () => {
  it('gives exactly one concurrent caller permission to submit', async () => {
    const replies = await Promise.all(
      Array.from({ length: 8 }, () => storage.journal.reserve(scope, fingerprint)),
    );
    expect(replies.filter((reply) => reply.created)).toHaveLength(1);
    expect(replies.every((reply) => reply.fingerprint === fingerprint && !reply.requestId)).toBe(
      true,
    );
  });
  it('returns the original fingerprint on an attempted reuse with different input', async () => {
    await storage.journal.reserve(scope, fingerprint);
    expect(await storage.journal.reserve(scope, 'b'.repeat(64))).toEqual({
      created: false,
      fingerprint,
    });
  });
  it('isolates journal reservations by tenant/show/attempt', async () => {
    await storage.journal.reserve(scope, fingerprint);
    for (const next of [
      { ...scope, tenantId: 'tenant-b' },
      { ...scope, showId: 'show-two' },
      { ...scope, attemptId: 'attempt-two' },
    ])
      expect((await storage.journal.reserve(next, fingerprint)).created).toBe(true);
  });
  it('records the id idempotently under concurrent writes', async () => {
    await storage.journal.reserve(scope, fingerprint);
    await Promise.all(Array.from({ length: 4 }, () => storage.journal.record(scope, requestId)));
    expect(await storage.journal.reserve(scope, fingerprint)).toEqual({
      created: false,
      fingerprint,
      requestId,
    });
  });
  it('lets only one of two different provider ids win and never changes it later', async () => {
    await storage.journal.reserve(scope, fingerprint);
    const outcomes = await Promise.allSettled([
      storage.journal.record(scope, requestId),
      storage.journal.record(scope, otherId),
    ]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const recorded = (await storage.journal.reserve(scope, fingerprint)).requestId;
    const losing = recorded === requestId ? otherId : requestId;
    await rejects(storage.journal.record(scope, losing), 'collision');
    expect((await storage.journal.reserve(scope, fingerprint)).requestId).toBe(recorded);
  });
  it('requires a reservation before recording', async () => {
    await rejects(storage.journal.record(scope, requestId), 'missing');
  });
  it('keeps an uncertain reservation when acknowledgement is lost', async () => {
    const uncertain = faultyPut(async (key, value, options) => {
      await bucket.put(key, value, options);
      throw new Error('upstream-secret');
    });
    await rejects(uncertain.journal.reserve(scope, fingerprint), 'storage');
    expect(await storage.journal.reserve(scope, fingerprint)).toEqual({
      created: false,
      fingerprint,
    });
  });
  it('recovers an id recorded before acknowledgement was lost', async () => {
    await storage.journal.reserve(scope, fingerprint);
    const uncertain = faultyPut(async (key, value, options) => {
      await bucket.put(key, value, options);
      throw new Error('upstream-secret');
    });
    await rejects(uncertain.journal.record(scope, requestId), 'storage');
    await storage.journal.record(scope, requestId);
    expect((await storage.journal.reserve(scope, fingerprint)).requestId).toBe(requestId);
  });
  it.each([
    'broken JSON',
    '{}',
    JSON.stringify({ fingerprint, requestId: 'bad' }),
    JSON.stringify({ fingerprint, extra: true }),
    'x'.repeat(513),
  ])('fails closed on a damaged ticket', async (value) => {
    await bucket.put(ticketKey, value);
    await rejects(storage.journal.reserve(scope, fingerprint), 'corrupt');
    await rejects(storage.journal.record(scope, requestId), 'corrupt');
  });
  it('rejects invalid fingerprints and request ids before writing', async () => {
    await rejects(storage.journal.reserve(scope, 'bad'), 'invalid-input');
    await rejects(storage.journal.record(scope, '../../bad'), 'invalid-input');
    expect((await bucket.list()).objects).toHaveLength(0);
  });
  it('uses the durable journal to resume fal reads after a runtime restart without a new POST', async () => {
    const png = new Uint8Array(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=',
        'base64',
      ),
    );
    const request: ShowImageRequest = {
      ...scope,
      providerModel: result.model,
      promptVersion: 'show-interior@1',
      template: 'interior',
      originals: [{ bytes: png, mimeType: 'image/png' }],
    };
    const options = () => ({
      journal: storage.journal,
      apiKey: 'test-key',
      allowPaidCalls: true,
      verifiedModels: [result.model],
      config: () => ({
        models: [],
        image: { model: result.model, eurPerImage: 0.1 },
        video: { model: 'unused/video', eurPerSecond: 0.1 },
      }),
    });
    let submissions = 0;
    const first = new FalShowGenerator({
      ...options(),
      fetch: async (_url, init) => {
        if (init?.method === 'POST') {
          submissions++;
          return new Response(JSON.stringify({ request_id: requestId }));
        }
        throw new Error('lost connection');
      },
    });
    await expect(first.generateImage(request)).rejects.toMatchObject({ requestId });
    await miniflare.dispose();
    await start();
    const next = new FalShowGenerator({
      ...options(),
      fetch: async (url, init) => {
        expect(init?.method).not.toBe('POST');
        if (String(url).endsWith('/status'))
          return new Response(JSON.stringify({ status: 'COMPLETED' }));
        if (String(url).includes('/requests/'))
          return new Response(
            JSON.stringify({ images: [{ url: 'https://fal.media/result.png' }] }),
          );
        return new Response(png, { headers: { 'content-type': 'image/png' } });
      },
    });
    const generated = await next.generateImage(request);
    await storage.results.put(scope.tenantId, scope.showId, scope.attemptId, generated);
    expect(submissions).toBe(1);
    expect((await get())!.result).toEqual(generated);
  });
});
