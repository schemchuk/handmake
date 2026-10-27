import { describe, expect, it } from 'vitest';

import { createDraft, transitionDraft } from '@handmake/core';

import { createD1DraftStore } from '../src/draft-store';
import { makeD1 } from './helpers';

const t0 = new Date('2026-10-27T10:00:00.000Z');
const t1 = new Date('2026-10-27T10:05:00.000Z');

const tenantA = 'faden-und-stimmung';
const tenantB = 'other-circle';

async function makeStore() {
  const db = await makeD1();
  return { db, store: createD1DraftStore(db) };
}

describe('createD1DraftStore', () => {
  it('create + get round-trips content and state', async () => {
    const { store } = await makeStore();
    let draft = createDraft(tenantA, 'd1', t0);
    draft = transitionDraft(draft, { type: 'addText', text: 'Привіт!' }, t1);
    draft = transitionDraft(draft, { type: 'addPhoto', fileId: 'file-1' }, t1);
    await store.create(draft, 'chat-1');

    const loaded = await store.get(tenantA, 'd1');
    expect(loaded).toEqual(draft);
  });

  it('get returns undefined for a missing draft', async () => {
    const { store } = await makeStore();
    expect(await store.get(tenantA, 'nope')).toBeUndefined();
  });

  it('rows are isolated per tenant', async () => {
    const { store } = await makeStore();
    const draft = createDraft(tenantA, 'same-id', t0);
    await store.create(draft, 'chat-1');
    await store.create({ ...createDraft(tenantB, 'same-id', t0) }, 'chat-2');

    expect(await store.get(tenantB, 'same-id')).toMatchObject({ tenantId: tenantB });
    expect(await store.get(tenantA, 'same-id')).toMatchObject({ tenantId: tenantA });
  });

  it('save updates content; saving a never-created draft throws', async () => {
    const { store } = await makeStore();
    const draft = createDraft(tenantA, 'd1', t0);
    await store.create(draft, 'chat-1');

    const updated = transitionDraft(draft, { type: 'addPhoto', fileId: 'f' }, t1);
    await store.save(updated);
    expect((await store.get(tenantA, 'd1'))?.photoRefs).toEqual(['f']);

    await expect(store.save(createDraft(tenantA, 'ghost', t0))).rejects.toThrow(/does not exist/);
  });

  it('delete removes the row', async () => {
    const { store } = await makeStore();
    await store.create(createDraft(tenantA, 'd1', t0), 'chat-1');
    await store.delete(tenantA, 'd1');
    expect(await store.get(tenantA, 'd1')).toBeUndefined();
  });

  it('listByState filters by tenant and state', async () => {
    const { store } = await makeStore();
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
    const { store } = await makeStore();
    await store.create(createDraft(tenantA, 'a1', t0), 'chat-1');
    let translating = createDraft(tenantA, 'a2', t0);
    translating = transitionDraft(translating, { type: 'beginTranslation' }, t1);
    await store.create(translating, 'chat-2');
    await store.create(createDraft(tenantB, 'b1', t0), 'chat-1');

    const found = await store.findCollectingForChat(tenantA, 'chat-1');
    expect(found?.draftId).toBe('a1');
    expect(await store.findCollectingForChat(tenantA, 'chat-2')).toBeUndefined();
    expect(await store.findCollectingForChat(tenantA, 'chat-9')).toBeUndefined();
  });

  it('deleteOlderThan removes only drafts untouched since the cutoff', async () => {
    const { db, store } = await makeStore();
    await store.create(createDraft(tenantA, 'old', t0), 'chat-1');
    await store.create(createDraft(tenantA, 'new', t0), 'chat-1');
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
