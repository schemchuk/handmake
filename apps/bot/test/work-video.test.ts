import { expect, it, vi } from 'vitest';
import { createWorkVideo, workVideoKeyboard, showWorkVideo } from '../src/work-video';
import type { AppContext } from '../src/context';
import type { D1DraftStore, StoredDraft } from '../src/draft-store';

function fixture() {
  let stored = {
    version: 1,
    draft: { draftId: 'work', tenantId: 'tenant', kind: 'work', state: 'ready', extras: {} },
  } as unknown as StoredDraft;
  const update = vi.fn(async (draft, version) => {
    if (stored.version !== version) return false;
    stored = { ...stored, draft, version: version + 1 };
    return true;
  });
  const drafts = {
    updateWork: update,
    getChatSession: async () => ({ kind: 'work', draftId: 'work' }),
  } as unknown as D1DraftStore;
  const ctx = {
    tenantId: 'tenant',
    chat: { id: 1, type: 'private' },
    msg: {
      video: { file_id: 'video', mime_type: 'video/mp4', duration: 60, file_size: 20_000_000 },
    },
    reply: vi.fn(),
    replyWithVideo: vi.fn(),
  } as unknown as AppContext;
  const handler = createWorkVideo(drafts);
  return {
    ctx,
    update,
    read: () => stored,
    handler,
    action: (action: string, version = String(stored.version)) =>
      handler.action(ctx, structuredClone(stored), action, version),
    intake: () => handler.intake(ctx, structuredClone(stored)),
  };
}
it('requires an answer, resets it on replacement, rejects stale confirmation and removes video', async () => {
  const f = fixture();
  await f.action('add');
  await f.intake();
  await showWorkVideo(f.ctx, f.read());
  expect(f.ctx.replyWithVideo).toHaveBeenCalledWith('video', { caption: 'Оригінальна робота' });
  expect(await f.action('confirm')).toBe(false);
  await f.action('both');
  const stale = String(f.read().version);
  await f.intake();
  expect(await f.action('confirm', stale)).toBe(false);
  expect(await f.action('confirm')).toBe(false);
  await f.action('none');
  await f.action('confirm');
  expect(f.read().draft.extras['workVideo']).toMatchObject({ people: 'none', confirmed: true });
  expect(f.read().draft.extras['workVideoEditing']).toBeUndefined();
  expect(
    workVideoKeyboard(f.read())
      .flat()
      .map((b) => b.text),
  ).toContain('Замінити відео');
  await f.action('remove');
  await f.action('skip');
  expect(f.read().draft.extras).toEqual({});
});
it.each([
  { duration: 61 },
  { duration: 0 },
  { file_size: undefined },
  { file_size: 20_000_001 },
  { mime_type: 'other' },
])('rejects bad metadata %j', async (patch) => {
  const f = fixture();
  await f.action('add');
  Object.assign(f.ctx.msg!.video!, patch);
  await f.intake();
  expect(f.read().draft.extras['workVideo']).toBeUndefined();
});
it('rejects documents, foreign chats and lost CAS updates', async () => {
  const f = fixture();
  await f.action('add');
  Object.assign(f.ctx.msg!, { document: { file_id: 'doc' } });
  await f.intake();
  expect(f.ctx.reply).toHaveBeenLastCalledWith(expect.stringContaining('як відео'));
  f.ctx.chat!.type = 'group';
  expect(await f.action('skip')).toBe(false);
  f.ctx.chat!.type = 'private';
  f.update.mockResolvedValueOnce(false);
  expect(await f.action('skip')).toBe(false);
});
