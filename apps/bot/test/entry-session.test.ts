import { beforeEach, expect, it, vi } from 'vitest';
import { createBot } from '../src/bot';
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
