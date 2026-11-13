import { expect, it, vi } from 'vitest';
import { createShowAuthentic } from '../src/show-authentic';
import type { AppContext } from '../src/context';
import type { D1DraftStore, StoredDraft } from '../src/draft-store';

function fixture() {
  let stored = {
    version: 1,
    draft: {
      draftId: 'show',
      tenantId: 'tenant',
      state: 'ready',
      extras: {
        show: {},
        showProposal: {},
        showProposalVersion: 1,
        showAuthentic: { editing: true, items: [], confirmed: false },
      },
    },
  } as unknown as StoredDraft;
  const update = vi.fn(async (draft, version) => {
    if (version !== stored.version) return false;
    stored = { ...stored, draft, version: version + 1 };
    return true;
  });
  const drafts = {
    getSessionShow: async () => structuredClone(stored),
    get: async () => structuredClone(stored),
    updateShow: update,
    setChatSession: vi.fn(async () => {}),
  } as unknown as D1DraftStore;
  const ctx = {
    tenantId: 'tenant',
    chat: { id: 1, type: 'private' },
    msg: { photo: [{ file_id: 'a', file_unique_id: 'a', file_size: 100 }] },
    reply: vi.fn(),
    replyWithPhoto: vi.fn(),
    replyWithVideo: vi.fn(),
  } as unknown as AppContext;
  return { handler: createShowAuthentic(drafts), ctx, update, drafts, read: () => stored };
}
it('retries album CAS, preserves every file, enforces bounds and clears proposals', async () => {
  const f = fixture();
  await Promise.all(
    ['a', 'b', 'c', 'd'].map(async (id) => {
      const ctx = {
        ...f.ctx,
        msg: { photo: [{ file_id: id, file_unique_id: id, file_size: 100 }] },
      } as unknown as AppContext;
      await f.handler.intake(ctx, 'show');
    }),
  );
  const extras = f.read().draft.extras;
  expect((extras['showAuthentic'] as { items: unknown[] }).items).toHaveLength(3);
  expect(extras['showProposal']).toBeUndefined();
  expect(extras['showProposalVersion']).toBeUndefined();
});
it('rejects unknown size and oversized or overlong videos without mutation', async () => {
  const f = fixture();
  for (const video of [
    { file_size: 20_000_001, duration: 1 },
    { file_size: 100, duration: 61 },
    { duration: 1 },
  ]) {
    const ctx = {
      ...f.ctx,
      msg: { video: { file_id: 'v', file_unique_id: 'v', mime_type: 'video/mp4', ...video } },
    } as unknown as AppContext;
    await f.handler.intake(ctx, 'show');
  }
  expect(f.update).not.toHaveBeenCalled();
});
it('requires people and confirmation, rejects stale buttons and resets consent on upload', async () => {
  const f = fixture();
  await f.handler.action(f.ctx, f.read(), 'ownconfirm', '1');
  expect(f.update).not.toHaveBeenCalled();
  await f.handler.action(f.ctx, f.read(), 'ownpeople.both', '1');
  await f.handler.action(f.ctx, f.read(), 'ownconfirm', '1');
  expect(f.update).toHaveBeenCalledTimes(1);
  await f.handler.action(f.ctx, f.read(), 'ownconfirm', '2');
  await f.handler.intake(f.ctx, 'show');
  expect(f.read().draft.extras['showAuthentic']).toMatchObject({
    people: 'both',
    confirmed: false,
  });
  await f.handler.action(f.ctx, f.read(), 'owndone', String(f.read().version));
  expect(f.read().draft.extras['showAuthentic']).toMatchObject({ editing: true });
});
it('skip closes an empty step and subsequent media does not enter intake', async () => {
  const f = fixture();
  await f.handler.action(f.ctx, f.read(), 'owndone', '1');
  expect(await f.handler.intake(f.ctx, 'show')).toBe(false);
});
it('removal invalidates confirmation and normalizes photo names', async () => {
  const f = fixture();
  await f.handler.intake(f.ctx, 'show');
  expect(f.read().draft.extras['showAuthentic']).toMatchObject({
    items: [{ fileName: 'authentic-photo-1.jpg', kind: 'photo' }],
  });
  await f.handler.action(f.ctx, f.read(), 'ownpeople.none', '2');
  await f.handler.action(f.ctx, f.read(), 'ownconfirm', '3');
  await f.handler.action(f.ctx, f.read(), 'ownremove.0', '4');
  expect(f.read().draft.extras['showAuthentic']).toMatchObject({ items: [], confirmed: false });
});

it('acknowledges uploads without resending stored media or keyboards', async () => {
  const f = fixture();
  await f.handler.intake(f.ctx, 'show');
  expect(f.ctx.replyWithPhoto).not.toHaveBeenCalled();
  expect(f.ctx.replyWithVideo).not.toHaveBeenCalled();
  expect(f.ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Файл збережено'));
});
it('cancels from the approval screen with a version guard', async () => {
  const f = fixture();
  await f.handler.action(f.ctx, f.read(), 'owncancel', '0');
  expect(f.update).not.toHaveBeenCalled();
  await f.handler.action(f.ctx, f.read(), 'owncancel', '1');
  expect(f.read().draft.extras['showCancelled']).toBe(true);
  expect(f.read().draft.state).toBe('failed');
});

it('cancellation clears the active session and retains the evidence notice', async () => {
  const f = fixture();
  await f.handler.action(f.ctx, f.read(), 'owncancel', '1');
  expect(f.drafts.setChatSession).toHaveBeenCalledWith(
    'tenant',
    '1',
    { kind: 'show', draftId: null },
    expect.any(Date),
  );
  expect(f.ctx.reply).toHaveBeenCalledWith(expect.stringContaining('витрати збережено'));
});
