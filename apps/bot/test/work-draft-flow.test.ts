import { buildApprovedWorkJob, createDraft, readWorkDraftData } from '@handmake/core';
import type {
  GeneratedWorkText,
  TextGenerationRequest,
  TextGenerator,
  WorkDraftConfig,
} from '@handmake/core';
import { FakeClock } from '@handmake/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createD1DraftStore, translationStaleMs } from '../src/draft-store';
import type { D1DraftStore } from '../src/draft-store';
import { createWorkDraftFlow } from '../src/work-draft-flow';
import { makeD1 } from './helpers';

const tenant = 'tenant';
const id = '01JBCA1B2C3D4E5F6G7H8J9K0M';
const uk: GeneratedWorkText = {
  version: {
    description: 'UA fixture',
    provenance: 'ai-assisted',
    model: 'ua-model',
    prompt: 'ua@1',
  },
  notes: 'UA note',
};
const de: GeneratedWorkText = {
  version: {
    description: 'DE fixture',
    provenance: 'ai-assisted',
    model: 'de-model',
    prompt: 'de@1',
  },
  notes: 'DE note',
};
const config: WorkDraftConfig = { kind: 'worn', collection: 'fixture', channels: [] };
let store: D1DraftStore;
let db: D1Database;
let clock: FakeClock;
let generator: TextGenerator;
const generateUa = vi.fn<(request: TextGenerationRequest) => Promise<GeneratedWorkText>>();
const translateDe = vi.fn<(text: string) => Promise<GeneratedWorkText>>();
const factory = vi.fn<(tenantId: string, workId: string) => Promise<TextGenerator>>();
const flow = () =>
  createWorkDraftFlow({ drafts: store, textGeneratorFor: factory, now: () => clock.now() });
const get = async () => (await store.get(tenant, id))!;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(async () => {
  db = await makeD1();
  store = createD1DraftStore(db);
  clock = new FakeClock();
  generateUa.mockReset().mockResolvedValue(uk);
  translateDe.mockReset().mockResolvedValue(de);
  generator = { generateUkrainian: generateUa, translateUkrainian: translateDe, generate: vi.fn() };
  factory.mockReset().mockResolvedValue(generator);
  await store.create(
    {
      ...createDraft(tenant, id, clock.now(), { kind: 'work' }),
      texts: { uk: 'Author note' },
      photoRefs: ['opaque-photo'],
    },
    '11',
  );
  expect(await flow().configure(await get(), config)).toBe(true);
});
afterEach(() => vi.restoreAllMocks());

describe('work draft generation recovery', () => {
  it('persists UA before calling DE and stores both baselines, notes and metadata', async () => {
    translateDe.mockImplementationOnce(async (text) => {
      const stored = await get();
      const data = readWorkDraftData(stored.draft);
      expect(stored.draft.state).toBe('translating');
      expect(data.generated?.['uk']).toEqual(uk.version);
      expect(stored.draft.texts['uk']).toBe(text);
      expect(data.uaPending).toBe(false);
      return de;
    });
    expect(await flow().generate(tenant, id)).toBe(true);
    const stored = await get();
    expect(stored.draft.state).toBe('ready');
    expect(readWorkDraftData(stored.draft)).toMatchObject({
      generated: { uk: uk.version, de: de.version },
      notes: { uk: uk.notes, de: de.notes },
    });
    expect(factory).toHaveBeenCalledExactlyOnceWith(tenant, id);
    expect(buildApprovedWorkJob(stored.draft).work?.versions['uk']?.provenance).toBe(
      'ai-generated',
    );
  });

  it('restarts after DE failure using only the persisted UA and the paid translator', async () => {
    translateDe.mockRejectedValueOnce(new Error('DE unavailable'));
    await expect(flow().generate(tenant, id)).rejects.toThrow('DE unavailable');
    expect((await get()).draft.state).toBe('failed');
    // A fresh flow and store instance model a new Worker invocation.
    const resumed = createWorkDraftFlow({
      drafts: createD1DraftStore(db),
      textGeneratorFor: factory,
      now: () => clock.now(),
    });
    expect(await resumed.generate(tenant, id)).toBe(true);
    expect(generateUa).toHaveBeenCalledOnce();
    expect(translateDe).toHaveBeenCalledTimes(2);
    expect(translateDe.mock.calls).toEqual([[uk.version.description], [uk.version.description]]);
  });

  it('allows only one active claim without paying for a racing request', async () => {
    const entered = deferred<void>();
    const ready = deferred<TextGenerator>();
    factory.mockImplementationOnce(async () => {
      entered.resolve();
      return ready.promise;
    });
    const first = flow().generate(tenant, id);
    await entered.promise;
    expect(await flow().generate(tenant, id)).toBe(false);
    ready.resolve(generator);
    await first;
    expect(factory).toHaveBeenCalledOnce();
    expect(generateUa).toHaveBeenCalledOnce();
  });

  it('fences a late DE result after a newer stale claim succeeds', async () => {
    const entered = deferred<void>();
    const late = deferred<GeneratedWorkText>();
    translateDe.mockImplementationOnce(async () => {
      entered.resolve();
      return late.promise;
    });
    const first = flow().generate(tenant, id);
    await entered.promise;
    clock.advance(translationStaleMs + 1);
    const newerDe = { ...de, version: { ...de.version, description: 'New DE' } };
    translateDe.mockResolvedValueOnce(newerDe);
    expect(await flow().generate(tenant, id)).toBe(true);
    late.resolve(de);
    await expect(first).rejects.toThrow(/changed/);
    expect((await get()).draft.texts['de']).toBe('New DE');
    expect((await get()).draft.state).toBe('ready');
    expect(generateUa).toHaveBeenCalledOnce();
  });

  it.each(['discard', 'edit'] as const)(
    'never overwrites a %s while DE is in flight',
    async (action) => {
      const entered = deferred<void>();
      const late = deferred<GeneratedWorkText>();
      translateDe.mockImplementationOnce(async () => {
        entered.resolve();
        return late.promise;
      });
      const first = flow().generate(tenant, id);
      await entered.promise;
      if (action === 'discard') await store.delete(tenant, id);
      else {
        await store.markTranslationFailed(tenant, id, clock.now());
        await store.writeGermanByHand(tenant, id, 'Manual DE', clock.now());
        await store.setPendingEdit(tenant, id, 'uk', clock.now());
        await store.replaceText(tenant, id, 'uk', 'Author edit', clock.now());
      }
      late.resolve(de);
      await expect(first).rejects.toThrow(/changed/);
      if (action === 'discard') expect(await store.get(tenant, id)).toBeUndefined();
      else expect((await get()).draft.texts).toEqual({ uk: 'Author edit', de: 'Manual DE' });
    },
  );

  it('blocks a new UA call after an uncertain paid outcome', async () => {
    generateUa.mockRejectedValueOnce(new Error('accounting failed'));
    await expect(flow().generate(tenant, id)).rejects.toThrow('accounting failed');
    expect(readWorkDraftData((await get()).draft).uaPending).toBe(true);
    clock.advance(translationStaleMs + 1);
    await expect(flow().generate(tenant, id)).rejects.toThrow(/reconciliation/);
    expect(generateUa).toHaveBeenCalledOnce();
    expect(translateDe).not.toHaveBeenCalled();
  });

  it('keeps the uncertainty marker when checkpoint persistence fails after a paid UA result', async () => {
    const update = store.updateWork.bind(store);
    let count = 0;
    vi.spyOn(store, 'updateWork').mockImplementation(async (...args) => {
      if (++count === 3) throw new Error('checkpoint unavailable');
      return update(...args);
    });
    await expect(flow().generate(tenant, id)).rejects.toThrow('checkpoint unavailable');
    await expect(flow().generate(tenant, id)).rejects.toThrow(/reconciliation/);
    expect(generateUa).toHaveBeenCalledOnce();
    expect(translateDe).not.toHaveBeenCalled();
  });

  it('preserves UA when DE accounting fails and allows explicit DE-only regeneration after author edits', async () => {
    translateDe.mockRejectedValueOnce(new Error('DE accounting failed'));
    await expect(flow().generate(tenant, id)).rejects.toThrow('DE accounting failed');
    await flow().generate(tenant, id);
    await store.setPendingEdit(tenant, id, 'uk', clock.now());
    await store.replaceText(tenant, id, 'uk', 'Edited UA', clock.now());
    await flow().generate(tenant, id, true);
    expect(translateDe).toHaveBeenLastCalledWith('Edited UA');
    expect(generateUa).toHaveBeenCalledOnce();
    const job = buildApprovedWorkJob((await get()).draft);
    expect(job.work?.versions['uk']?.provenance).toBe('ai-assisted');
    expect(job.work?.versions['de']?.provenance).toBe('ai-assisted');
    expect(job.work?.versions['uk']?.model).toBe('ua-model');
  });

  it('retries configuration failure without claiming that an unmade UA call was paid', async () => {
    factory.mockRejectedValueOnce(new Error('config unavailable'));
    await expect(flow().generate(tenant, id)).rejects.toThrow('config unavailable');
    expect(readWorkDraftData((await get()).draft).uaPending).toBe(false);
    expect(await flow().generate(tenant, id)).toBe(true);
    expect(generateUa).toHaveBeenCalledOnce();
  });

  it('guards configuration against stale versions and preserves generated baselines', async () => {
    const stale = await get();
    await store.appendText(tenant, id, 'More facts', clock.now());
    expect(await flow().configure(stale, { ...config, channels: ['telegram'] })).toBe(false);
    await flow().generate(tenant, id);
    expect(await flow().configure(await get(), { ...config, channels: ['telegram'] })).toBe(true);
    expect(readWorkDraftData((await get()).draft).generated?.['uk']).toEqual(uk.version);
    await expect(flow().configure(await get(), { ...config, kind: 'interior' })).rejects.toThrow(
      /cannot be changed/,
    );
  });

  it('isolates tenant/kind and refuses incomplete input without calling AI', async () => {
    expect(await flow().generate('other', id)).toBe(false);
    await store.create(createDraft(tenant, 'post-id', clock.now()), '11');
    expect(await flow().generate(tenant, 'post-id')).toBe(false);
    const current = await get();
    current.draft.texts = {};
    await store.updateWork(current.draft, current.version);
    await expect(flow().generate(tenant, id)).rejects.toThrow(/note and photos/);
    expect(factory).not.toHaveBeenCalled();
  });
});

it('never starts another UA call while an interrupted-looking UA attempt remains unresolved', async () => {
  const entered = deferred<void>();
  const late = deferred<GeneratedWorkText>();
  generateUa.mockImplementationOnce(async () => {
    entered.resolve();
    return late.promise;
  });
  const first = flow().generate(tenant, id);
  await entered.promise;
  clock.advance(translationStaleMs + 1);
  await expect(flow().generate(tenant, id)).rejects.toThrow(/reconciliation/);
  late.resolve(uk);
  expect(await first).toBe(true);
  expect(generateUa).toHaveBeenCalledOnce();
  expect(factory).toHaveBeenCalledOnce();
});

it('never resurrects a draft discarded while UA was in flight or starts DE afterwards', async () => {
  const entered = deferred<void>();
  const late = deferred<GeneratedWorkText>();
  generateUa.mockImplementationOnce(async () => {
    entered.resolve();
    return late.promise;
  });
  const first = flow().generate(tenant, id);
  await entered.promise;
  await store.delete(tenant, id);
  late.resolve(uk);
  await expect(first).rejects.toThrow(/changed/);
  expect(await store.get(tenant, id)).toBeUndefined();
  expect(translateDe).not.toHaveBeenCalled();
});

it('work checkpoint writes cannot change regular posts, foreign tenants or published drafts', async () => {
  const post = createDraft(tenant, 'post-id', clock.now());
  await store.create(post, '11');
  expect(await store.updateWork({ ...post, kind: 'work', extras: { altered: true } }, 0)).toBe(
    false,
  );
  const work = await get();
  expect(await store.updateWork({ ...work.draft, tenantId: 'other' }, work.version)).toBe(false);
  await flow().generate(tenant, id);
  await store.claimPublishing(tenant, id, clock.now());
  await store.markPublished(tenant, id, clock.now());
  const published = await get();
  expect(await store.updateWork({ ...published.draft, state: 'ready' }, published.version)).toBe(
    false,
  );
  expect((await get()).draft.state).toBe('published');
});
