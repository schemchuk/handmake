import { beforeEach, expect, it, vi } from 'vitest';
import { createBot } from '../src/bot';
import { createCommentStore } from '../src/comment-store';
import { createD1DraftStore } from '../src/draft-store';
import { createEntrySessionStore, entryConsentText } from '../src/entry-session';
import { botTexts } from '../src/texts';
import {
  makeD1,
  mockTelegramApi,
  textUpdate,
  photoUpdate,
  callbackQueryUpdate,
  sentTexts,
} from './helpers';

let db: D1Database;
let store: ReturnType<typeof createEntrySessionStore>;
let bot: ReturnType<typeof createBot>;
let calls: ReturnType<typeof mockTelegramApi>;
const text = (s: string) => bot.handleUpdate(textUpdate(11, s));
const photo = () => bot.handleUpdate(photoUpdate(11, ['small', 'large'], 'Ignored caption'));
const press = (data: string, user = 11) => bot.handleUpdate(callbackQueryUpdate(user, user, data));
const row = () => db.prepare('SELECT * FROM contest_entries').first();
function button() {
  const payload = calls.filter((c) => c.method === 'sendMessage').at(-1)!.payload;
  return (payload.reply_markup as { inline_keyboard: { callback_data: string }[][] })
    .inline_keyboard[0]![0]!.callback_data;
}
beforeEach(async () => {
  db = await makeD1();
  store = createEntrySessionStore(db);
  bot = createBot({
    token: 'TEST_TOKEN',
    entries: store,
    comments: {
      store: createCommentStore(db),
      capabilities: {},
      context: { secrets: { resolve: async () => '' } },
    },
    drafts: createD1DraftStore(db),
    texts: botTexts,
    resolveTenant: (id) => (id === 11 ? 'fixture' : id === 22 ? 'other' : undefined),
    translator: {
      translate: async () => {
        throw new Error('Unexpected translation');
      },
    },
    publishRunner: {
      run: async () => {
        throw new Error('Unexpected dispatch');
      },
    },
    background: () => {
      throw new Error('Unexpected background work');
    },
  });
  calls = mockTelegramApi(bot);
  await bot.init();
});
it('requires a photo, a name choice and explicit consent; ignores captions and stores largest photo', async () => {
  await text('/entry');
  await text('🧶'.repeat(30));
  const pending = await store.get('fixture', '11');
  await press(`entry:${pending!.revision}:confirm`);
  expect(await row()).toBeNull();
  await photo();
  expect(sentTexts(calls).at(-1)).toBe(entryConsentText);
  const confirm = button();
  expect(await row()).toBeNull();
  await press(confirm);
  expect(await row()).toMatchObject({
    display_name: '🧶'.repeat(30),
    file_id: 'large',
    status: 'submitted',
  });
  await press(confirm);
  expect((await db.prepare('SELECT * FROM contest_entries').all()).results).toHaveLength(1);
  expect(await db.prepare('SELECT * FROM drafts').first()).toBeNull();
});
it('accepts anonymous entries and refuses second photos and overlong names', async () => {
  await text('/entry');
  await photo();
  await bot.handleUpdate(photoUpdate(11, ['second']));
  expect(sentTexts(calls).at(-1)).toContain('Лише одне');
  await text('🧶'.repeat(31));
  expect(sentTexts(calls).at(-1)).toContain('30');
  await photo();
  // Rejected photo does not change the current anonymous button.
  const pending = await store.get('fixture', '11');
  await press(`entry:${pending!.revision}:anonymous`);
  await press(button());
  expect(await row()).toMatchObject({ display_name: null, file_id: 'large' });
});
it('invalidates consent on changed names, new sessions, cancellation and tenant changes', async () => {
  await text('/entry');
  await photo();
  await text('Private fixture');
  const old = button();
  await text('Updated fixture');
  await press(old);
  expect(await row()).toBeNull();
  const current = await store.get('fixture', '11');
  await press(`entry:${current!.revision}:confirm`, 22);
  expect(await row()).toBeNull();
  await text('/entry');
  await press(`entry:${current!.revision}:confirm`);
  expect(await row()).toBeNull();
  await photo();
  await text('Private fixture');
  const cancelled = button();
  await text('/discard');
  await press(cancelled);
  expect(await row()).toBeNull();
  expect(await store.get('fixture', '11')).toBeNull();
  expect(sentTexts(calls).join('\n')).not.toContain('Private fixture');
});
it('serializes concurrent confirmations without duplicate entries', async () => {
  await text('/entry');
  await photo();
  await text('Private fixture');
  const confirm = button();
  await Promise.all([press(confirm), press(confirm), press(confirm)]);
  expect((await db.prepare('SELECT * FROM contest_entries').all()).results).toHaveLength(1);
});
it('never routes entry input into an armed post edit; switching cancels entry consent', async () => {
  await text('/new');
  await text('Original post');
  const drafts = createD1DraftStore(db);
  const post = await drafts.findCollectingForChat('fixture', '11', 'post');
  await drafts.setPendingEdit('fixture', post!.draft.draftId, 'uk', new Date());
  await text('/entry');
  await photo();
  await text('Private fixture');
  const confirm = button();
  expect((await drafts.get('fixture', post!.draft.draftId))!.draft.texts.uk).toBe('Original post');
  await text('/new');
  await press(confirm);
  expect(await row()).toBeNull();
  expect(await store.get('fixture', '11')).toBeNull();
});
it('purges expired input while retaining entry routing until an explicit flow switch', async () => {
  await text('/entry');
  await photo();
  await text('Private fixture');
  const confirm = button();
  await db.prepare("UPDATE contest_sessions SET expires_at = '2000-01-01'").run();
  await press(confirm);
  await text('Never a post');
  expect(sentTexts(calls).at(-1)).toContain('/new');
  expect(await row()).toBeNull();
  expect(await db.prepare('SELECT * FROM contest_sessions').first()).toBeNull();
  expect(await db.prepare('SELECT * FROM drafts').first()).toBeNull();
});
it('scrubs storage failures without logging names', async () => {
  const prepare = vi.fn(() => {
    throw new Error('Private fixture');
  });
  const broken = createEntrySessionStore({ prepare } as unknown as D1Database);
  await expect(
    broken.edit(
      'fixture',
      '11',
      {
        entry_id: 'id',
        revision: 'revision',
        file_id: null,
        name_chosen: 0,
      },
      'name',
      'Private fixture',
    ),
  ).rejects.toThrow(/^Contest session storage failed$/);
});

it('orders a racing name edit against confirmation and refuses its obsolete revision', async () => {
  await text('/entry');
  await photo();
  await text('Original fixture');
  const input = (await store.get('fixture', '11'))!;
  await Promise.all([
    store.edit('fixture', '11', input, 'name', 'Changed fixture'),
    store.confirm('fixture', '11', input.revision),
  ]);
  const submitted = await row();
  if (submitted) expect(submitted.display_name).toBe('Original fixture');
  else {
    expect(await store.confirm('fixture', '11', input.revision)).toBe(false);
    expect(await store.get('fixture', '11')).not.toBeNull();
  }
});

it.each(['active', 'completed', 'expired'])(
  'leaves %s entry routing for a post-preview edit',
  async (state) => {
    await text('/new');
    await text('Original post');
    const drafts = createD1DraftStore(db);
    const post = (await drafts.findCollectingForChat('fixture', '11', 'post'))!;
    await text('/entry');
    await photo();
    await text('Private fixture');
    const confirm = button();
    if (state === 'completed') await press(confirm);
    if (state === 'expired') {
      await db.prepare("UPDATE contest_sessions SET expires_at = '2000-01-01'").run();
      await store.cleanup(new Date());
    }
    await press(`draft:${post.draft.draftId}:edit:uk`);
    await text('Edited post');
    expect((await drafts.get('fixture', post.draft.draftId))!.draft.texts.uk).toBe('Edited post');
    expect(await store.get('fixture', '11')).toBeNull();
    expect((await drafts.getChatSession('fixture', '11'))?.kind).toBe('post');
    await press(confirm);
    expect((await db.prepare('SELECT * FROM contest_entries').all()).results).toHaveLength(
      state === 'completed' ? 1 : 0,
    );
  },
);
it('leaves entry routing for a comment edit, while protecting an armed comment during entry input', async () => {
  const comments = createCommentStore(db);
  const now = new Date();
  await comments.collect({
    tenantId: 'fixture',
    network: 'instagram',
    id: 'c1',
    postId: 'p1',
    handle: 'fixture-reader',
    text: 'Comment fixture',
    commentCreatedAt: now.toISOString(),
    createdAt: now,
    updatedAt: now,
  });
  await comments.claimDrafting('fixture', 'instagram', 'c1', now);
  await comments.storeDraft(
    'fixture',
    'instagram',
    'c1',
    {
      translationUk: 'Translation fixture',
      replyDe: 'Original reply',
      notesUk: '',
    },
    now,
  );
  await press('comment:instagram:c1:edit');
  await text('/entry');
  await photo();
  await text('Private fixture');
  expect((await comments.get('fixture', 'instagram', 'c1'))!.replyDe).toBe('Original reply');
  await press('comment:instagram:c1:edit');
  await text('Edited reply');
  expect((await comments.get('fixture', 'instagram', 'c1'))!.replyDe).toBe('Edited reply');
  expect(await store.get('fixture', '11')).toBeNull();
  expect(await row()).toBeNull();
  expect(await db.prepare('SELECT * FROM drafts').first()).toBeNull();
});
it('leaves entry routing on a foreign command without creating a draft until new input', async () => {
  await text('/entry');
  await photo();
  await text('Private fixture');
  await text('/start');
  expect(await store.get('fixture', '11')).toBeNull();
  expect(await db.prepare('SELECT * FROM drafts').first()).toBeNull();
  await text('New post');
  const post = await createD1DraftStore(db).findCollectingForChat('fixture', '11', 'post');
  expect(post!.draft.texts.uk).toBe('New post');
});
it('cleans expired input in entry mode but does not issue cleanup writes for other flows', async () => {
  const cleanup = vi.spyOn(store, 'cleanup');
  await text('/start');
  await text('/new');
  await text('Post fixture');
  expect(cleanup).not.toHaveBeenCalled();
  await text('/entry');
  expect(cleanup).toHaveBeenCalled();
  cleanup.mockClear();
  await text('/new');
  cleanup.mockClear();
  await text('More post text');
  expect(cleanup).not.toHaveBeenCalled();
});
