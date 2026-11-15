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
  const logError = vi.fn();
  const getFile = vi.fn(async () => ({ file_size: undefined as number | undefined }));
  Object.assign(ctx, { api: { getFile } });
  const handler = createWorkVideo(drafts, logError);
  return {
    ctx,
    logError,
    getFile,
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

it('resolves missing size through getFile without downloading media', async () => {
  const f = fixture();
  await f.action('add');
  delete f.ctx.msg!.video!.file_size;
  f.getFile.mockResolvedValueOnce({ file_size: 7_400_000 });
  await f.intake();
  expect(f.getFile).toHaveBeenCalledWith('video');
  expect(f.read().draft.extras['workVideo']).toMatchObject({ size: 7_400_000 });
  expect(f.logError).not.toHaveBeenCalled();
});
it.each([undefined, 0])('explains missing duration %s', async (duration) => {
  const f = fixture();
  await f.action('add');
  Object.assign(f.ctx.msg!.video!, { duration });
  await f.intake();
  expect(f.ctx.reply).toHaveBeenLastCalledWith(
    'Telegram не передав тривалість відео. Надішліть його ще раз або з телефона.',
  );
  expect(f.read().draft.extras['workVideo']).toBeUndefined();
  expect(f.logError).toHaveBeenCalledWith('work video rejected', expect.any(Error), 'tenant');
  expect(JSON.parse(f.logError.mock.calls[0]![1].message)).toEqual({
    mimeType: 'video/mp4',
    size: 20_000_000,
    duration: duration ?? null,
    paths: ['duration'],
  });
});
it.each([false, true])('explains unavailable size when getFile fails: %s', async (fails) => {
  const f = fixture();
  await f.action('add');
  delete f.ctx.msg!.video!.file_size;
  if (fails) f.getFile.mockRejectedValueOnce(new Error('private-file-id'));
  await f.intake();
  expect(f.ctx.reply).toHaveBeenLastCalledWith(expect.stringContaining('не передав розмір'));
  expect(f.read().draft.extras['workVideo']).toBeUndefined();
  const metadata = JSON.parse(f.logError.mock.calls[0]![1].message);
  expect(metadata.paths).toEqual(['size']);
  expect(metadata.size).toBeNull();
  expect(JSON.stringify(f.logError.mock.calls)).not.toContain('private-file-id');
});
it('names actual over-limit values and logs only validation metadata', async () => {
  const f = fixture();
  await f.action('add');
  Object.assign(f.ctx.msg!.video!, {
    file_id: 'private-file-id',
    file_size: 24_000_000,
    duration: 72,
  });
  await f.intake();
  expect(f.ctx.reply).toHaveBeenLastCalledWith(
    'Файл має бути до 20 МБ, відео — до 60 секунд. Отримано: 24.0 МБ, 72 с.',
  );
  expect(f.getFile).not.toHaveBeenCalled();
  expect(JSON.parse(f.logError.mock.calls[0]![1].message)).toEqual({
    mimeType: 'video/mp4',
    size: 24_000_000,
    duration: 72,
    paths: ['size', 'duration'],
  });
});
it('offers only cancellation until a video is stored', async () => {
  const f = fixture();
  await f.action('add');
  expect(workVideoKeyboard(f.read())).toEqual([
    [
      {
        text: 'Скасувати',
        callback_data: 'work:work:video.remove:2',
      },
    ],
  ]);
  await f.intake();
  expect(
    workVideoKeyboard(f.read())
      .flat()
      .map((button) => button.text),
  ).toContain('Ніхто');
});
