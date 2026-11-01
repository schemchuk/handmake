import { readFileSync } from 'node:fs';
import { createDraft, parseTenantConfig, showDraftDataSchema } from '@handmake/core';
import type {
  ShowDraftPlan,
  ShowGenerator,
  ShowResultStore,
  ShowImageRequest,
  ShowVideoRequest,
} from '@handmake/core';
import { FakeClock } from '@handmake/core/testing';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createD1DraftStore } from '../src/draft-store';
import type { D1DraftStore } from '../src/draft-store';
import { createAiCostLedger } from '../src/ai-costs';
import type { AiCostLedger } from '../src/ai-costs';
import { createShowGenerationLocks } from '../src/show-generation-locks';
import { createShowDraftFlow, maxShowMediaBytes } from '../src/show-draft-flow';
import { makeD1 } from './helpers';

const tenant = 'faden-und-stimmung',
  id = '01JBCA1B2C3D4E5F6G7H8J9K0M',
  other = '01JBCA1B2C3D4E5F6G7H8J9K0Z';
const persona = {
  id: 'studio-one',
  name: 'Studio One',
  look: 'Fictional adult',
  referenceImage: 'persona-ref',
  fictional: true as const,
  adult: true as const,
};
let drafts: D1DraftStore, ledger: AiCostLedger, clock: FakeClock;
let locks: ReturnType<typeof createShowGenerationLocks>;
let config: ReturnType<typeof parseTenantConfig>;
let plan: ShowDraftPlan;
let assets: Map<string, Awaited<ReturnType<ShowResultStore['get']>>>;
let results: ShowResultStore;
const image = vi.fn<ShowGenerator['generateImage']>();
const video = vi.fn<ShowGenerator['generateVideo']>();
const resolveImage = vi.fn(async () => ({
  bytes: new Uint8Array([1]),
  mimeType: 'image/png' as const,
}));
const receipt = (request: ShowImageRequest | ShowVideoRequest, clip = false) => ({
  callId: request.attemptId,
  model: request.providerModel,
  promptVersion: request.promptVersion,
  costEur: clip ? 0.5 : 0.1,
  bytes: new Uint8Array([1, 2]),
});
const flow = () =>
  createShowDraftFlow({
    drafts,
    ledger,
    locks,
    configs: { load: async () => config },
    generator: { generateImage: image, generateVideo: video },
    results,
    resolveImage,
    now: () => clock.now(),
  });
const get = async (draftId = id) => (await drafts.get(tenant, draftId))!;
const data = async () => showDraftDataSchema.parse((await get()).draft.extras['show']);
async function create(draftId = id, tenantId = tenant) {
  await drafts.create(createDraft(tenantId, draftId, clock.now(), { kind: 'show' }), draftId);
  await flow().configure((await drafts.get(tenantId, draftId))!, plan);
}
async function spend(amountEur: number) {
  await ledger.recordCost(tenant, {
    id: 'existing',
    at: clock.now(),
    service: 'fixture',
    unit: 'image',
    amountEur,
    ref: 'show:previous',
  });
}
beforeEach(async () => {
  const db = await makeD1();
  drafts = createD1DraftStore(db);
  ledger = createAiCostLedger(db);
  locks = createShowGenerationLocks(db);
  clock = new FakeClock(new Date('2026-11-01T12:00:00Z'));
  config = parseTenantConfig(
    readFileSync(
      new URL('../../../config/tenants/faden-und-stimmung.yaml', import.meta.url),
      'utf8',
    ),
  );
  config.ai = {
    monthlyTargetEur: 20,
    toleranceEur: 5,
    translation: { model: 'fixture', inputEurPerMillion: 1, outputEurPerMillion: 1 },
  };
  config.shows = {
    models: [persona],
    image: { model: 'image-v1', eurPerImage: 0.1 },
    video: { model: 'video-v1', eurPerSecond: 0.1 },
  };
  plan = {
    workId: id,
    template: 'worn',
    model: persona,
    originals: ['work-ref'],
    imageCount: 3,
    provider: { image: config.shows.image, video: config.shows.video },
  };
  assets = new Map();
  results = {
    put: async (t, s, a, result) => {
      assets.set(`${t}/${s}/${a}`, { ref: `durable-${a}`, result: structuredClone(result) });
    },
    get: async (t, s, a) => structuredClone(assets.get(`${t}/${s}/${a}`)),
  };
  image
    .mockReset()
    .mockImplementation(async (request) => ({ ...receipt(request), mimeType: 'image/png' }));
  video
    .mockReset()
    .mockImplementation(async (request) => ({ ...receipt(request, true), mimeType: 'video/mp4' }));
  resolveImage.mockClear();
  await create();
});
afterEach(() => vi.restoreAllMocks());

it('checkpoints 3 images and a video with config models, prompt versions and costs; ready retry is a no-op', async () => {
  expect(await flow().generate(tenant, id)).toBe(true);
  expect((await get()).draft.state).toBe('ready');
  expect(Object.keys((await data()).outputs)).toEqual(['image-0', 'image-1', 'image-2', 'video']);
  expect((await data()).pending).toBeUndefined();
  expect(JSON.stringify((await get()).draft.extras)).not.toContain('bytes');
  expect(image).toHaveBeenCalledTimes(3);
  expect(video).toHaveBeenCalledTimes(1);
  expect(image.mock.calls[0]![0]).toMatchObject({
    providerModel: 'image-v1',
    template: 'worn',
    persona: { model: persona },
  });
  expect((await ledger.summary(tenant, clock.now())).shows[`show:${id}`]).toBeCloseTo(0.8);
  expect(await flow().generate(tenant, id)).toBe(false);
});
it('regenerates the selected image and dependent video, charging both without repeating other images', async () => {
  await flow().generate(tenant, id);
  const original = (await data()).outputs['image-0'];
  await flow().generate(tenant, id, 'image-1');
  expect(image).toHaveBeenCalledTimes(4);
  expect(video).toHaveBeenCalledTimes(2);
  expect((await data()).outputs['image-0']).toEqual(original);
  expect((await data()).retired).toHaveLength(2);
  expect((await ledger.summary(tenant, clock.now())).total).toBeCloseTo(1.4);
});
it('recovers stored output after failed cost booking without another paid call or duplicate cost', async () => {
  vi.spyOn(ledger, 'recordCost').mockRejectedValueOnce(new Error('bookkeeping unavailable'));
  await expect(flow().generate(tenant, id)).rejects.toThrow('bookkeeping');
  expect((await data()).pending).toBeDefined();
  expect(assets.size).toBe(1);
  await flow().generate(tenant, id);
  expect(image).toHaveBeenCalledTimes(3);
  expect((await ledger.summary(tenant, clock.now())).total).toBeCloseTo(0.8);
});
it('recovers a lost output checkpoint using the durable result and deduplicated ledger', async () => {
  const update = drafts.updateShow.bind(drafts);
  let interrupted = false;
  vi.spyOn(drafts, 'updateShow').mockImplementation(async (draft, version) => {
    const value = showDraftDataSchema.parse(draft.extras['show']);
    if (!interrupted && value.outputs['image-0'] && !value.pending) {
      interrupted = true;
      return false;
    }
    return update(draft, version);
  });
  await expect(flow().generate(tenant, id)).rejects.toThrow('changed');
  await flow().generate(tenant, id);
  expect(image).toHaveBeenCalledTimes(3);
  expect((await ledger.summary(tenant, clock.now())).total).toBeCloseTo(0.8);
});
it('retains an uncertain call and blocks automatic retry, including after the stale timeout', async () => {
  image.mockRejectedValueOnce(new Error('provider disconnected'));
  await expect(flow().generate(tenant, id)).rejects.toThrow('disconnected');
  clock.advance(20 * 60_000);
  await expect(flow().generate(tenant, id)).rejects.toThrow('reconciliation');
  expect(image).toHaveBeenCalledTimes(1);
  await create(other);
  expect(await flow().generate(tenant, other)).toBe(false);
});
it('books a paid call even when durable result storage fails, then requires reconciliation', async () => {
  vi.spyOn(results, 'put').mockRejectedValueOnce(new Error('storage failed'));
  await expect(flow().generate(tenant, id)).rejects.toThrow('storage failed');
  expect((await ledger.summary(tenant, clock.now())).total).toBeCloseTo(0.1);
  await expect(flow().generate(tenant, id)).rejects.toThrow('reconciliation');
  expect(image).toHaveBeenCalledTimes(1);
});
it('serializes concurrent calls for the same draft and different shows of one tenant', async () => {
  await create(other);
  let release!: () => void, started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const pause = new Promise<void>((resolve) => {
    release = resolve;
  });
  image.mockImplementationOnce(async (request) => {
    started();
    await pause;
    return { ...receipt(request), mimeType: 'image/png' };
  });
  const running = flow().generate(tenant, id);
  await entered;
  expect(await flow().generate(tenant, id)).toBe(false);
  expect(await flow().generate(tenant, other)).toBe(false);
  release();
  await running;
  expect(image).toHaveBeenCalledTimes(3);
});
it('rejects an unaffordable next call and permits no paid attempts at the cap', async () => {
  await spend(24.95);
  await expect(flow().generate(tenant, id)).rejects.toThrow('cap');
  expect(image).not.toHaveBeenCalled();
  expect((await data()).pending).toBeUndefined();
});
it('checks the remaining budget between calls and keeps completed checkpoints when the cap stops progress', async () => {
  await spend(24.8);
  await expect(flow().generate(tenant, id)).rejects.toThrow();
  expect(image).toHaveBeenCalledTimes(2);
  expect(video).not.toHaveBeenCalled();
  expect(Object.keys((await data()).outputs)).toHaveLength(2);
  expect((await ledger.summary(tenant, clock.now())).total).toBe(25);
});
it('releases a claim after a pre-call input failure so recovery is safe', async () => {
  resolveImage.mockRejectedValueOnce(new Error('input missing'));
  await expect(flow().generate(tenant, id)).rejects.toThrow('input missing');
  expect(image).not.toHaveBeenCalled();
  await flow().generate(tenant, id);
  expect(image).toHaveBeenCalledTimes(3);
});
it.each(['model', 'empty', 'oversize'] as const)(
  'accounts for invalid %s output but blocks approval and regeneration',
  async (fault) => {
    image.mockImplementationOnce(async (request) => ({
      ...receipt(request),
      mimeType: 'image/png',
      ...(fault === 'model'
        ? { model: 'wrong-model' }
        : { bytes: new Uint8Array(fault === 'empty' ? 0 : maxShowMediaBytes + 1) }),
    }));
    await expect(flow().generate(tenant, id)).rejects.toThrow('reconciliation');
    expect((await ledger.summary(tenant, clock.now())).total).toBeCloseTo(0.1);
    expect((await get()).draft.state).toBe('failed');
    await expect(flow().generate(tenant, id, 'image-0')).rejects.toThrow('regeneration');
    expect(image).toHaveBeenCalledTimes(1);
  },
);
it('rejects foreign tenant access and unconfigured model/provider changes', async () => {
  expect(await flow().generate('other', id)).toBe(false);
  const extra = '01JBCA1B2C3D4E5F6G7H8J9K0A';
  await drafts.create(createDraft(tenant, extra, clock.now(), { kind: 'show' }), extra);
  const stored = (await drafts.get(tenant, extra))!;
  await expect(
    flow().configure(stored, { ...plan, model: { ...persona, id: 'unknown' } }),
  ).rejects.toThrow('tenant models');
  await expect(
    flow().configure(stored, {
      ...plan,
      provider: { ...plan.provider, image: { model: 'wrong', eurPerImage: 0.1 } },
    }),
  ).rejects.toThrow('tenant models');
});

it('resumes a stale translating checkpoint with durable output without another paid attempt', async () => {
  vi.spyOn(ledger, 'recordCost').mockRejectedValueOnce(new Error('interrupted'));
  await expect(flow().generate(tenant, id)).rejects.toThrow();
  const stored = await get();
  await drafts.updateShow({ ...stored.draft, state: 'translating' }, stored.version);
  clock.advance(20 * 60_000);
  await flow().generate(tenant, id);
  expect(image).toHaveBeenCalledTimes(3);
});
it('keeps an uncertain tenant isolated from another tenant', async () => {
  image.mockRejectedValueOnce(new Error('unknown billing'));
  await expect(flow().generate(tenant, id)).rejects.toThrow();
  config = { ...config, id: 'other' };
  await create(other, 'other');
  expect(await flow().generate('other', other)).toBe(true);
  expect((await ledger.summary('other', clock.now())).total).toBeCloseTo(0.8);
  expect((await ledger.summary(tenant, clock.now())).total).toBe(0);
});
it('accounts for a returned call even if the durable store loses its just-written result', async () => {
  vi.spyOn(results, 'get').mockResolvedValue(undefined);
  await expect(flow().generate(tenant, id)).rejects.toThrow('durable show result is missing');
  expect((await ledger.summary(tenant, clock.now())).total).toBeCloseTo(0.1);
  expect((await data()).pending).toBeDefined();
});
