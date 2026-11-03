import { describe, expect, it, vi } from 'vitest';
import type { ShowConfig, ShowImageRequest, ShowVideoRequest } from '@handmake/core';
import {
  FalShowGenerator,
  type FalAttemptJournal,
  type FalShowGeneratorOptions,
} from './fal-show-generator';
import { FalShowError, maxFalMediaBytes } from './fal-http';
import { showImagePrompt, showVideoPrompt } from './show-prompts';

const png = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=',
    'base64',
  ),
);
// Header probe only; full decoding is deliberately a separate T44d3 gate.
const mp4 = new Uint8Array(Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex'));
const image = { bytes: png, mimeType: 'image/png' as const };
const persona = {
  model: {
    id: 'model-one',
    name: 'Model One',
    look: 'a fictional adult with short brown hair',
    referenceImage: 'reference-one',
    adult: true as const,
    fictional: true as const,
  },
  reference: image,
};
const config: ShowConfig = {
  models: [persona.model],
  image: { model: 'fal-ai/test-edit/edit', eurPerImage: 0.1 },
  video: { model: 'fal-ai/test-video/pro/image-to-video', eurPerSecond: 0.07 },
};
const request: ShowImageRequest = {
  tenantId: 'tenant-a',
  showId: 'show-a',
  attemptId: 'attempt-a',
  providerModel: config.image.model,
  promptVersion: 'show-worn@1',
  template: 'worn',
  originals: [image, image],
  persona,
};
const videoRequest: ShowVideoRequest = {
  ...request,
  providerModel: config.video.model,
  promptVersion: 'show-video@1',
  image,
  durationSeconds: 5,
};
const id = '019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b';
const queue =
  'https://queue.fal.run/fal-ai/test-edit/requests/019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b';
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

/** Test double only: a shared journal simulates a durable store across adapter instances. */
function journal(): FalAttemptJournal {
  const entries = new Map<string, { fingerprint: string; requestId?: string }>();
  return {
    async reserve(scope, fingerprint) {
      const key = JSON.stringify(scope);
      const found = entries.get(key);
      if (found) return { created: false, ...found };
      entries.set(key, { fingerprint });
      return { created: true, fingerprint };
    },
    async record(scope, requestId) {
      const entry = entries.get(JSON.stringify(scope))!;
      if (entry.requestId && entry.requestId !== requestId) throw new Error('immutable');
      entry.requestId = requestId;
    },
  };
}
function setup(
  overrides: Partial<FalShowGeneratorOptions> = {},
  responses?: Array<Response | Error>,
) {
  const replies = responses ?? [
    json({ request_id: id }),
    json({ status: 'COMPLETED' }),
    json({ images: [{ url: 'https://v3.fal.media/output.png', content_type: 'image/png' }] }),
    new Response(png, { headers: { 'content-type': 'image/png' } }),
  ];
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    const reply = replies.shift();
    if (!reply) throw new Error('unexpected HTTP request');
    if (reply instanceof Error) throw reply;
    return reply;
  });
  const options: FalShowGeneratorOptions = {
    apiKey: 'test-fal-secret',
    allowPaidCalls: true,
    verifiedModels: [config.image.model, config.video.model],
    config: () => config,
    journal: journal(),
    fetch,
    sleep: vi.fn(async () => {}),
    maxPolls: 3,
    ...overrides,
  };
  return { generator: new FalShowGenerator(options), fetch, options, replies };
}
async function failure(run: Promise<unknown>, code: FalShowError['code'], requestId?: string) {
  const error: unknown = await run.catch((e) => e);
  expect(error).toBeInstanceOf(FalShowError);
  expect(error).toMatchObject({ code, requestId });
  expect(String(error)).not.toContain('test-fal-secret');
  expect((error as Error).cause).toBeUndefined();
}

describe('FalShowGenerator', () => {
  it('submits config-selected model, reference bytes and prompt; downloads without credentials', async () => {
    const { generator, fetch } = setup();
    const result = await generator.generateImage(request);
    expect(result).toEqual({
      callId: `fal:${id}`,
      model: config.image.model,
      promptVersion: 'show-worn@1',
      costEur: 0.1,
      bytes: png,
      mimeType: 'image/png',
    });
    expect(fetch.mock.calls.map((c) => c[0])).toEqual([
      `https://queue.fal.run/${config.image.model}`,
      `${queue}/status`,
      queue,
      'https://v3.fal.media/output.png',
    ]);
    const init = fetch.mock.calls[0]![1]!;
    expect(init).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: {
        Authorization: 'Key test-fal-secret',
        'X-Fal-No-Retry': '1',
        'x-app-fal-disable-fallback': 'true',
      },
    });
    const payload = JSON.parse(init.body as string);
    expect(payload).toMatchObject({
      num_images: 1,
      output_format: 'png',
      resolution: '1K',
      prompt: showImagePrompt(request),
    });
    expect(payload.image_urls).toHaveLength(3);
    expect(payload.image_urls[0]).toBe(
      `data:image/png;base64,${Buffer.from(png).toString('base64')}`,
    );
    expect(fetch.mock.calls[3]![1]).toMatchObject({ headers: {}, redirect: 'error' });
  });

  it('uses app-level queue routes for nested video endpoints and estimates five seconds', async () => {
    const { generator, fetch } = setup({}, [
      json({ request_id: id }),
      json({ status: 'IN_QUEUE' }),
      json({ status: 'IN_PROGRESS' }),
      json({ status: 'COMPLETED' }),
      json({ video: { url: 'https://storage.googleapis.com/falserverless/result.mp4' } }),
      new Response(mp4, { headers: { 'content-type': 'video/mp4' } }),
    ]);
    expect(await generator.generateVideo(videoRequest)).toMatchObject({
      callId: `fal:${id}`,
      costEur: 0.35000000000000003,
      mimeType: 'video/mp4',
    });
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toEqual({
      prompt: showVideoPrompt('show-video@1'),
      image_url: `data:image/png;base64,${Buffer.from(png).toString('base64')}`,
      duration: '5',
    });
    expect(fetch.mock.calls[1]![0]).toBe(
      `https://queue.fal.run/fal-ai/test-video/requests/${id}/status`,
    );
  });

  it('can switch compatible model ids using configuration only', async () => {
    const next = { ...config, image: { model: 'another-owner/edit-v2/edit', eurPerImage: 0.2 } };
    const { generator, fetch } = setup({ config: () => next, verifiedModels: [next.image.model] });
    expect(
      await generator.generateImage({ ...request, providerModel: next.image.model }),
    ).toMatchObject({ model: next.image.model, costEur: 0.2 });
    expect(fetch.mock.calls[0]![0]).toBe(`https://queue.fal.run/${next.image.model}`);
  });

  it('resumes a journalled request across adapter instances without another POST', async () => {
    const first = setup({}, [json({ request_id: id }), new Error('test-fal-secret')]);
    await failure(first.generator.generateImage(request), 'reconcile', id);
    const next = setup({ journal: first.options.journal }, [
      json({ status: 'COMPLETED' }),
      json({ images: [{ url: 'https://fal.media/result.png' }] }),
      new Response(png, { headers: { 'content-type': 'image/png' } }),
    ]);
    expect(await next.generator.generateImage(request)).toMatchObject({ callId: `fal:${id}` });
    expect(next.fetch.mock.calls.every((c) => c[1]?.method !== 'POST')).toBe(true);
  });

  it('retains the attempt reservation after an uncertain POST and refuses to resubmit', async () => {
    const { generator, fetch } = setup({}, [new Error('test-fal-secret')]);
    await failure(generator.generateImage(request), 'reconcile');
    await failure(generator.generateImage(request), 'reconcile');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not duplicate concurrent paid submissions', async () => {
    const { generator, fetch } = setup();
    const outcomes = await Promise.allSettled([
      generator.generateImage(request),
      generator.generateImage(request),
    ]);
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(fetch.mock.calls.filter((c) => c[1]?.method === 'POST')).toHaveLength(1);
  });

  it('rejects reused attempts with changed payload or rate before HTTP', async () => {
    const { generator, fetch, options } = setup();
    await generator.generateImage(request);
    const before = fetch.mock.calls.length;
    await failure(generator.generateImage({ ...request, originals: [image] }), 'reconcile');
    options.config = () => ({ ...config, image: { ...config.image, eurPerImage: 0.3 } });
    await failure(generator.generateImage(request), 'reconcile');
    expect(fetch).toHaveBeenCalledTimes(before);
  });

  it('retains provider id when durable ticket recording fails', async () => {
    const store = journal();
    store.record = async () => {
      throw new Error('test-fal-secret');
    };
    const { generator, fetch } = setup({ journal: store });
    await failure(generator.generateImage(request), 'reconcile', id);
    await failure(generator.generateImage(request), 'reconcile');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([401, 429, 500])('does not retry a POST with HTTP %i', async (status) => {
    const { generator, fetch } = setup({}, [json({ detail: 'test-fal-secret' }, status)]);
    await failure(generator.generateImage(request), 'provider');
    await failure(generator.generateImage(request), 'reconcile');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('bounds polls and preserves request identity on timeout', async () => {
    const { generator, fetch, options } = setup({}, [
      json({ request_id: id }),
      ...Array.from({ length: 3 }, () => json({ status: 'IN_QUEUE' })),
    ]);
    await failure(generator.generateImage(request), 'timeout', id);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(options.sleep).toHaveBeenCalledTimes(2);
  });

  it('aborts a stalled HTTP request without exposing the transport error', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('test-fal-secret')), {
            once: true,
          });
        }),
    );
    const { generator } = setup({ fetch, timeoutMs: 5 });
    await failure(generator.generateImage(request), 'reconcile');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('also times out while streaming the response body', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async (_url, init) =>
        new Response(
          new ReadableStream({
            start(controller) {
              init?.signal?.addEventListener(
                'abort',
                () => controller.error(new Error('test-fal-secret')),
                { once: true },
              );
            },
          }),
        ),
    );
    const { generator } = setup({ fetch, timeoutMs: 5 });
    await failure(generator.generateImage(request), 'reconcile');
  });

  it.each([undefined, false])('defaults paid calls to disabled (%s)', async (allowPaidCalls) => {
    const { generator, fetch } = setup({ allowPaidCalls });
    await failure(generator.generateImage(request), 'disabled');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('requires terms verification for the exact configured model', async () => {
    const { generator, fetch } = setup({ verifiedModels: [] });
    await failure(generator.generateImage(request), 'disabled');
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    { promptVersion: 'show-worn@2' },
    { originals: [] },
    { originals: [{ bytes: new Uint8Array(), mimeType: 'image/png' }] },
    { originals: Array.from({ length: 14 }, () => image) },
    { tenantId: '' },
    { persona: undefined },
    { persona: { ...persona, model: { ...persona.model, adult: false } } },
  ])('rejects invalid image input before reservation or HTTP: %j', async (change) => {
    const store = journal();
    const reserve = vi.spyOn(store, 'reserve');
    const { generator, fetch } = setup({ journal: store });
    await failure(
      generator.generateImage({ ...request, ...change } as ShowImageRequest),
      'invalid-input',
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
  });
  it('limits total reference bytes before encoding or HTTP', async () => {
    const oversized = { ...image, bytes: new Uint8Array(maxFalMediaBytes) };
    const { generator, fetch } = setup();
    await failure(generator.generateImage({ ...request, originals: [oversized] }), 'invalid-input');
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['fal-ai/../edit', 'fal-ai/test/../../edit', 'https://evil.invalid/edit'])(
    'rejects unsafe configured model paths %s',
    async (model) => {
      const { generator, fetch } = setup({
        config: () => ({ ...config, image: { ...config.image, model } }),
        verifiedModels: [model],
      });
      await failure(generator.generateImage({ ...request, providerModel: model }), 'invalid-input');
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it('sanitizes journal failures before submission', async () => {
    const store = journal();
    store.reserve = async () => {
      throw new Error('test-fal-secret');
    };
    const { generator, fetch } = setup({ journal: store });
    await failure(generator.generateImage(request), 'reconcile');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects a model mismatch even if its terms were verified', async () => {
    const { generator, fetch } = setup();
    await failure(
      generator.generateImage({ ...request, providerModel: config.video.model }),
      'invalid-input',
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([0, 10, NaN])('rejects unsupported video duration %s', async (durationSeconds) => {
    const { generator, fetch } = setup();
    await failure(generator.generateVideo({ ...videoRequest, durationSeconds }), 'invalid-input');
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([0, -1, NaN, Infinity])(
    'rejects invalid EUR estimate %s before submission',
    async (eurPerImage) => {
      const { generator, fetch } = setup({
        config: () => ({ ...config, image: { ...config.image, eurPerImage } }),
      });
      await failure(generator.generateImage(request), 'invalid-input');
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('ignores hostile returned queue URLs and never sends credentials to them', async () => {
    const { generator, fetch } = setup({}, [
      json({
        request_id: id,
        status_url: 'https://evil.invalid/status',
        response_url: 'https://evil.invalid/result',
      }),
      json({ status: 'COMPLETED' }),
      json({ images: [{ url: 'https://fal.media/result.png' }] }),
      new Response(png, { headers: { 'content-type': 'image/png' } }),
    ]);
    await generator.generateImage(request);
    expect(fetch.mock.calls.every((c) => !String(c[0]).includes('evil.invalid'))).toBe(true);
  });
  it.each([
    'https://evil.invalid/a',
    'http://fal.media/a',
    'https://fal.media.evil.invalid/a',
    'https://user:pass@fal.media/a',
    'https://fal.media:444/a',
    'https://127.0.0.1/a',
    'https://storage.googleapis.com/private/a',
    'file:///tmp/media',
    'https://fal.media/a#fragment',
  ])('rejects unsafe output URL %s', async (url) => {
    const { generator, fetch } = setup({}, [
      json({ request_id: id }),
      json({ status: 'COMPLETED' }),
      json({ images: [{ url }] }),
    ]);
    await failure(generator.generateImage(request), 'invalid-media', id);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it.each(['../../escape', 'test-fal-secret\nrequest', ''])(
    'rejects malformed provider identity %j without logging it',
    async (request_id) => {
      const { generator, fetch } = setup({}, [json({ request_id })]);
      await failure(generator.generateImage(request), 'reconcile');
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    { status: 'FAILED', error: 'test-fal-secret' },
    {},
    { status: 'COMPLETED', ignored: true },
  ])('handles failed/malformed provider responses safely: %j', async (status) => {
    const { generator } = setup({}, [
      json({ request_id: id }),
      json(status),
      json({ error: 'test-fal-secret' }),
    ]);
    await failure(generator.generateImage(request), 'reconcile', id);
  });
  it('handles provider error results even after COMPLETED', async () => {
    const { generator } = setup({}, [
      json({ request_id: id }),
      json({ status: 'COMPLETED' }),
      json({ detail: 'test-fal-secret' }, 422),
    ]);
    await failure(generator.generateImage(request), 'provider', id);
  });
  it.each([
    () => new Response('test-fal-secret', { headers: { 'content-type': 'image/png' } }),
    () => new Response(png, { headers: { 'content-type': 'text/html' } }),
    () =>
      new Response(png, {
        headers: { 'content-type': 'image/png', 'content-length': String(maxFalMediaBytes + 1) },
      }),
    () =>
      new Response(new Uint8Array(maxFalMediaBytes + 1), {
        headers: { 'content-type': 'image/png' },
      }),
    () => new Response(null, { status: 302, headers: { location: 'https://evil.invalid' } }),
    () => new Response(new Uint8Array(), { headers: { 'content-type': 'image/png' } }),
  ])('rejects bad/oversized/redirected media and preserves the paid identity', async (response) => {
    const { generator } = setup({}, [
      json({ request_id: id }),
      json({ status: 'COMPLETED' }),
      json({ images: [{ url: 'https://fal.media/result.png' }] }),
      response(),
    ]);
    await failure(generator.generateImage(request), 'invalid-media', id);
  });
  it('rejects declared and downloaded MIME mismatch', async () => {
    const { generator } = setup({}, [
      json({ request_id: id }),
      json({ status: 'COMPLETED' }),
      json({ images: [{ url: 'https://fal.media/result.png', content_type: 'image/jpeg' }] }),
      new Response(png, { headers: { 'content-type': 'image/png' } }),
    ]);
    await failure(generator.generateImage(request), 'invalid-media', id);
  });
  it('bounds JSON response size without trusting content-length', async () => {
    const { generator } = setup({}, [new Response('x'.repeat(1_000_001))]);
    await failure(generator.generateImage(request), 'reconcile');
  });
});

describe('versioned show prompts', () => {
  it.each(['worn', 'closeup', 'interior'] as const)(
    'supports %s with explicit real-work fidelity and persona placement',
    (template) => {
      const prompt = showImagePrompt({ ...request, template, promptVersion: `show-${template}@1` });
      expect(prompt).toContain('do not add, remove, rearrange or restyle embroidery');
      expect(prompt).toContain('The final reference shows a fictional adult model');
      if (template !== 'interior') expect(prompt).toContain(persona.model.look);
    },
  );
  it('supports an interior without a persona', () => {
    const prompt = showImagePrompt({
      ...request,
      template: 'interior',
      persona: undefined,
      promptVersion: 'show-interior@1',
    });
    expect(prompt).toContain('sofa, wall');
    expect(prompt).not.toContain('undefined');
    expect(prompt).not.toContain('final reference');
  });
  it('rejects unversioned/unknown prompts', () => {
    expect(() => showVideoPrompt('show-video@2')).toThrow('unsupported');
    expect(() => showImagePrompt({ ...request, promptVersion: 'unknown' })).toThrow('unsupported');
  });
});

it('resumes a journal identity using GETs without source bytes or permission to submit', async () => {
  const fixture = setup({ allowPaidCalls: false, verifiedModels: [] }, [
    json({ status: 'COMPLETED' }),
    json({ images: [{ url: 'https://v3.fal.media/output.png' }] }),
    new Response(png, { headers: { 'content-type': 'image/png' } }),
  ]);
  const reserve = vi.spyOn(fixture.options.journal, 'reserve');
  const result = await fixture.generator.resume({
    requestId: id,
    providerModel: config.image.model,
    promptVersion: request.promptVersion,
    costEur: 0.1,
    video: false,
  });
  expect(result.callId).toBe(`fal:${id}`);
  expect(fixture.fetch.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(
    true,
  );
  expect(reserve).not.toHaveBeenCalled();
});
