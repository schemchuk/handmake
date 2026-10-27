import { createDraft, maxDraftPhotos, transitionDraft } from '@handmake/core';
import { describe, expect, it } from 'vitest';

import { createD1DraftStore } from '../src/draft-store';
import type { D1DraftStore } from '../src/draft-store';
import { makeD1 } from './helpers';

const t0 = new Date('2026-10-27T10:00:00.000Z');
const t1 = new Date('2026-10-27T10:05:00.000Z');

const tenantA = 'faden-und-stimmung';
const tenantB = 'other-circle';

async function makeStore(): Promise<D1DraftStore> {
  return createD1DraftStore(await makeD1());
}

/** The same atomic append the bot runs, as a test helper. */
async function appendPhoto(
  store: D1DraftStore,
  tenantId: string,
  chatId: string,
  fileId: string,
): Promise<'added' | 'limit'> {
  const stored = await store.getOrCreateCollecting(tenantId, chatId, t0);
  const result = await store.appendPhoto(
    tenantId,
    stored.draft.draftId,
    fileId,
    maxDraftPhotos,
    t1,
  );
  if (result === 'not-collecting') {
    throw new Error('draft vanished in test helper');
  }
  return result;
}

async function appendText(
  store: D1DraftStore,
  tenantId: string,
  chatId: string,
  text: string,
): Promise<void> {
  const stored = await store.getOrCreateCollecting(tenantId, chatId, t0);
  if (!(await store.appendText(tenantId, stored.draft.draftId, text, t1))) {
    throw new Error('draft vanished in test helper');
  }
}

describe('createD1DraftStore', () => {
  it('create + get round-trips content, state and version', async () => {
    const store = await makeStore();
    let draft = createDraft(tenantA, 'd1', t0);
    draft = transitionDraft(draft, { type: 'addText', text: 'Привіт!' }, t1);
    draft = transitionDraft(draft, { type: 'addPhoto', fileId: 'file-1' }, t1);
    await store.create(draft, 'chat-1');

    const loaded = await store.get(tenantA, 'd1');
    expect(loaded?.draft).toEqual(draft);
    expect(loaded?.version).toBe(0);
  });

  it('get returns undefined for a missing draft', async () => {
    const store = await makeStore();
    expect(await store.get(tenantA, 'nope')).toBeUndefined();
  });

  it('rows are isolated per tenant', async () => {
    const store = await makeStore();
    await store.create(createDraft(tenantA, 'same-id', t0), 'chat-1');
    await store.create(createDraft(tenantB, 'same-id', t0), 'chat-2');

    expect((await store.get(tenantB, 'same-id'))?.draft.tenantId).toBe(tenantB);
    expect((await store.get(tenantA, 'same-id'))?.draft.tenantId).toBe(tenantA);
  });

  it('update bumps the version; a stale version is rejected', async () => {
    const store = await makeStore();
    const draft = createDraft(tenantA, 'd1', t0);
    await store.create(draft, 'chat-1');

    const first = await store.get(tenantA, 'd1');
    const updated = transitionDraft(first!.draft, { type: 'addPhoto', fileId: 'f' }, t1);
    expect(await store.update(updated, first!.version)).toBe(true);

    // The same stored version is now stale — exactly what a racing writer gets.
    const stale = await store.get(tenantA, 'd1');
    expect(stale?.version).toBe(1);
    const raced = transitionDraft(stale!.draft, { type: 'addPhoto', fileId: 'g' }, t1);
    expect(await store.update(raced, first!.version)).toBe(false);
    // Nothing was overwritten.
    expect((await store.get(tenantA, 'd1'))?.draft.photoRefs).toEqual(['f']);
  });

  it('update on a deleted row is rejected', async () => {
    const store = await makeStore();
    const draft = createDraft(tenantA, 'd1', t0);
    await store.create(draft, 'chat-1');
    await store.delete(tenantA, 'd1');
    expect(await store.update(draft, 0)).toBe(false);
  });

  it('delete removes the row', async () => {
    const store = await makeStore();
    await store.create(createDraft(tenantA, 'd1', t0), 'chat-1');
    await store.delete(tenantA, 'd1');
    expect(await store.get(tenantA, 'd1')).toBeUndefined();
  });

  it('listByState filters by tenant and state', async () => {
    const store = await makeStore();
    await store.create(createDraft(tenantA, 'a1', t0), 'chat-1');
    let other = createDraft(tenantA, 'a2', t0);
    other = transitionDraft(other, { type: 'beginTranslation' }, t1);
    await store.create(other, 'chat-1');
    await store.create(createDraft(tenantB, 'b1', t0), 'chat-2');

    expect(await store.listByState(tenantA, 'collecting')).toHaveLength(1);
    expect(await store.listByState(tenantA, 'translating')).toHaveLength(1);
    expect(await store.listByState(tenantB, 'collecting')).toHaveLength(1);
  });

  it('findCollectingForChat finds only the collecting draft of that chat', async () => {
    const store = await makeStore();
    await store.create(createDraft(tenantA, 'a1', t0), 'chat-1');
    let translating = createDraft(tenantA, 'a2', t0);
    translating = transitionDraft(translating, { type: 'beginTranslation' }, t1);
    await store.create(translating, 'chat-2');
    await store.create(createDraft(tenantB, 'b1', t0), 'chat-1');

    const found = await store.findCollectingForChat(tenantA, 'chat-1');
    expect(found?.draft.draftId).toBe('a1');
    expect(await store.findCollectingForChat(tenantA, 'chat-2')).toBeUndefined();
    expect(await store.findCollectingForChat(tenantA, 'chat-9')).toBeUndefined();
  });

  it('deleteOlderThan removes only drafts untouched since the cutoff', async () => {
    const db = await makeD1();
    const store = createD1DraftStore(db);
    await store.create(createDraft(tenantA, 'old', t0), 'chat-old');
    await store.create(createDraft(tenantA, 'new', t0), 'chat-new');
    // Simulate the cron running a month later: "new" was touched recently.
    await db
      .prepare("UPDATE drafts SET updated_at = '2026-11-27T10:00:00.000Z' WHERE id = 'new'")
      .run();

    const removed = await store.deleteOlderThan(new Date('2026-11-15T00:00:00.000Z'));
    expect(removed).toBe(1);
    expect(await store.get(tenantA, 'old')).toBeUndefined();
    expect(await store.get(tenantA, 'new')).toBeDefined();
  });
});

describe('one collecting draft per chat (migration 0003)', () => {
  it('creating a second collecting draft for the same chat is refused', async () => {
    const store = await makeStore();
    await store.create(createDraft(tenantA, 'd1', t0), 'chat-1');
    await expect(store.create(createDraft(tenantA, 'd2', t0), 'chat-1')).rejects.toThrow(
      /UNIQUE constraint failed/,
    );
    // A different chat, and a non-collecting state of the same chat, are fine.
    await store.create(createDraft(tenantA, 'e1', t0), 'chat-2');
    const ready = transitionDraft(
      transitionDraft(createDraft(tenantA, 'd3', t0), { type: 'beginTranslation' }, t1),
      { type: 'translationSucceeded', german: 'Hallo!' },
      t1,
    );
    await store.create(ready, 'chat-1');
    expect(await store.listByState(tenantA, 'collecting')).toHaveLength(2);
  });

  it('getOrCreateCollecting returns one draft even under concurrent creation', async () => {
    const store = await makeStore();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => store.getOrCreateCollecting(tenantA, 'chat-1', t0)),
    );
    const ids = new Set(results.map((r) => r.draft.draftId));
    expect(ids.size).toBe(1);
    expect(await store.listByState(tenantA, 'collecting')).toHaveLength(1);
  });
});

describe('concurrent appends', () => {
  it('10 parallel photo appends keep all 10 photos', async () => {
    const store = await makeStore();
    await Promise.all(
      Array.from({ length: maxDraftPhotos }, (_, i) =>
        appendPhoto(store, tenantA, 'chat-1', `file-${i}`),
      ),
    );
    const stored = await store.findCollectingForChat(tenantA, 'chat-1');
    expect(stored?.draft.photoRefs).toHaveLength(maxDraftPhotos);
    expect(new Set(stored?.draft.photoRefs).size).toBe(maxDraftPhotos);
  });

  it('the 11th concurrent append is refused by the atomic guard, not a bypass', async () => {
    const store = await makeStore();
    const results = await Promise.all(
      Array.from({ length: maxDraftPhotos + 1 }, (_, i) =>
        appendPhoto(store, tenantA, 'chat-1', `file-${i}`),
      ),
    );
    expect(results.filter((r) => r === 'added')).toHaveLength(maxDraftPhotos);
    expect(results.filter((r) => r === 'limit')).toHaveLength(1);
    const stored = await store.findCollectingForChat(tenantA, 'chat-1');
    expect(stored?.draft.photoRefs).toHaveLength(maxDraftPhotos);
  });

  it('parallel text appends keep every paragraph', async () => {
    const store = await makeStore();
    await Promise.all(
      ['один', 'два', 'три'].map((text) => appendText(store, tenantA, 'chat-1', text)),
    );
    const stored = await store.findCollectingForChat(tenantA, 'chat-1');
    expect(stored?.draft.texts['uk']).toContain('один');
    expect(stored?.draft.texts['uk']).toContain('два');
    expect(stored?.draft.texts['uk']).toContain('три');
    expect(stored?.draft.texts['uk']?.split('\n\n')).toHaveLength(3);
  });
});

describe('T15 translation and edit guards', () => {
  async function makeCollecting(store: D1DraftStore): Promise<string> {
    await appendText(store, tenantA, 'chat-1', 'Привіт!');
    const stored = await store.findCollectingForChat(tenantA, 'chat-1');
    return stored!.draft.draftId;
  }

  it('latestForChat finds drafts in any state, newest first', async () => {
    const store = await makeStore();
    const old = transitionDraft(
      transitionDraft(createDraft(tenantA, 'old', t0), { type: 'beginTranslation' }, t0),
      { type: 'translationFailed', error: 'boom' },
      t0,
    );
    await store.create(old, 'chat-1');
    // The unique index allows only one collecting draft per chat, so the
    // newer one is created after the old one left 'collecting'.
    await new Promise((r) => setTimeout(r, 5));
    await store.create(createDraft(tenantA, 'newer', t1), 'chat-1');

    const latest = await store.latestForChat(tenantA, 'chat-1');
    expect(latest?.draft.draftId).toBe('newer');
    expect(await store.latestForChat(tenantA, 'no-such-chat')).toBeUndefined();
  });

  it('claimTranslation lets exactly one caller through', async () => {
    const store = await makeStore();
    const draftId = await makeCollecting(store);

    const [first, second] = await Promise.all([
      store.claimTranslation(tenantA, draftId, ['collecting'], t1),
      store.claimTranslation(tenantA, draftId, ['collecting'], t1),
    ]);

    expect([first === undefined, second === undefined].filter(Boolean)).toHaveLength(1);
    const winner = first ?? second;
    expect(winner?.draft.state).toBe('translating');
    expect(await store.claimTranslation(tenantA, draftId, ['collecting'], t1)).toBeUndefined();
  });

  it('markTranslated stores the German text and flips to ready', async () => {
    const store = await makeStore();
    const draftId = await makeCollecting(store);
    await store.claimTranslation(tenantA, draftId, ['collecting'], t1);

    expect(await store.markTranslated(tenantA, draftId, 'Hallo!', t1)).toBe(true);
    const stored = await store.get(tenantA, draftId);
    expect(stored?.draft.state).toBe('ready');
    expect(stored?.draft.texts['de']).toBe('Hallo!');
    // A second mark (racing reply) is a no-op.
    expect(await store.markTranslated(tenantA, draftId, 'Anders', t1)).toBe(false);
  });

  it('markTranslationFailed keeps the old texts for a retry', async () => {
    const store = await makeStore();
    const draftId = await makeCollecting(store);
    await store.claimTranslation(tenantA, draftId, ['collecting'], t1);
    await store.markTranslated(tenantA, draftId, 'Alt', t1);
    await store.claimTranslation(tenantA, draftId, ['ready'], t1);

    expect(await store.markTranslationFailed(tenantA, draftId, t1)).toBe(true);
    const stored = await store.get(tenantA, draftId);
    expect(stored?.draft.state).toBe('failed');
    expect(stored?.draft.texts['de']).toBe('Alt');
  });

  it('writeGermanByHand takes the author text from failed to ready', async () => {
    const store = await makeStore();
    const draftId = await makeCollecting(store);
    await store.claimTranslation(tenantA, draftId, ['collecting'], t1);
    await store.markTranslationFailed(tenantA, draftId, t1);

    expect(await store.writeGermanByHand(tenantA, draftId, 'Von Hand', t1)).toBe(true);
    const stored = await store.get(tenantA, draftId);
    expect(stored?.draft.state).toBe('ready');
    expect(stored?.draft.texts['de']).toBe('Von Hand');
    expect(await store.writeGermanByHand(tenantA, draftId, 'Nochmal', t1)).toBe(false);
  });

  it('setPendingEdit and replaceText arm and disarm the reply-based edit', async () => {
    const store = await makeStore();
    const draftId = await makeCollecting(store);

    expect(await store.replaceText(tenantA, draftId, 'de', 'Zu früh', t1)).toBe(false);

    expect(await store.setPendingEdit(tenantA, draftId, 'de', t1)).toBe(true);
    expect(await store.replaceText(tenantA, draftId, 'uk', 'Falsch', t1)).toBe(false);
    expect(await store.replaceText(tenantA, draftId, 'de', 'Neu', t1)).toBe(true);

    const stored = await store.get(tenantA, draftId);
    expect(stored?.draft.texts['de']).toBe('Neu');
    expect(stored?.pendingEdit).toBeNull();
  });

  it('setPendingEdit refuses drafts that are not collecting or ready', async () => {
    const store = await makeStore();
    const draftId = await makeCollecting(store);
    await store.claimTranslation(tenantA, draftId, ['collecting'], t1);

    expect(await store.setPendingEdit(tenantA, draftId, 'uk', t1)).toBe(false);
  });
});
