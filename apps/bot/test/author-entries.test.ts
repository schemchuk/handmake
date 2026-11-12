import { beforeEach, expect, it } from 'vitest';
import { anonymousEditReceiptSchema, ChannelEditRejectedError } from '@handmake/core';
import { createAuthorEntriesStore, entryWithdrawalText } from '../src/author-entries';
import { createBot } from '../src/bot';
import { createContestEntryStore } from '../src/contest-store';
import { createD1DraftStore } from '../src/draft-store';
import { createNameReconciler } from '../src/name-reconciliation';
import { botTexts } from '../src/texts';
import { callbackQueryUpdate, makeD1, mockTelegramApi, sentTexts, textUpdate } from './helpers';

const id = '01JBCA1B2C3D4E5F6G7H8J9K0N';
const scope = Array.from(
  new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('fixture'))).slice(
    0,
    8,
  ),
  (n) => n.toString(16).padStart(2, '0'),
).join('');
const now = new Date('2026-11-12T12:00:00Z');
let db: D1Database;
let store: ReturnType<typeof createAuthorEntriesStore>;
let bot: ReturnType<typeof createBot>;
let calls: ReturnType<typeof mockTelegramApi>;
beforeEach(async () => {
  db = await makeD1();
  store = createAuthorEntriesStore(db);
  bot = createBot({
    token: 'TEST_TOKEN',
    authorEntries: store,
    drafts: createD1DraftStore(db),
    texts: botTexts,
    resolveTenant: (user) => (user === 11 ? 'fixture' : user === 22 ? 'other' : undefined),
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
async function submit(entryId = id, tenantId = 'fixture') {
  await createContestEntryStore(db).submit({
    entryId,
    tenantId,
    photoRef: 'photo',
    displayName: 'Private fixture',
    consent: true,
    consentAt: now,
    createdAt: now,
  });
}
const press = (data: string, user = 11) => {
  const update = callbackQueryUpdate(user, user, data);
  update.callback_query!.message!.photo = [
    { file_id: 'photo', file_unique_id: 'unique', width: 100, height: 100 },
  ];
  return bot.handleUpdate(update);
};
const captions = () =>
  calls
    .filter((c) => typeof c.payload.caption === 'string')
    .map((c) => c.payload.caption as string);
const name = () =>
  db
    .prepare('SELECT display_name FROM contest_entries WHERE tenant_id = ? AND entry_id = ?')
    .bind('fixture', id)
    .first();

it('gates strangers, groups, malformed and cross-tenant actions before deletion', async () => {
  await submit();
  await submit(id, 'other');
  await bot.handleUpdate(textUpdate(33, '/entries'));
  expect(sentTexts(calls).at(-1)).toBe(botTexts.refusalText);
  for (const [data, user] of [
    [`entries:withdraw:${scope}:${id}`, 33],
    [`entries:withdraw:${scope}:${id}`, 22],
    [`entries:confirm:${scope}:${id}`, 22],
    ['entries:withdraw:bad', 11],
    [`entries:fixture:${id}`, 11],
  ] as const)
    await press(data, user);
  const group = callbackQueryUpdate(11, 11, `entries:withdraw:${scope}:${id}`);
  group.callback_query!.message!.chat.type = 'group';
  await bot.handleUpdate(group);
  const listing = textUpdate(11, '/entries');
  listing.message!.chat.type = 'group';
  await bot.handleUpdate(listing);
  expect(sentTexts(calls).at(-1)).toBe(botTexts.entriesPrivateOnlyText);
  expect(await name()).toEqual({ display_name: 'Private fixture' });
  expect(await db.prepare('SELECT * FROM name_withdrawals').first()).toBeNull();
});
it('lists ten identifiable recent tenant entries and retains winner state on repeated withdrawal', async () => {
  await submit();
  for (let i = 0; i < 12; i++)
    await submit(`01JBCA1B2C3D4E5F6G7H8J9K${String(i).padStart(2, '0')}`);
  await submit(id, 'other');
  await db
    .prepare('UPDATE contest_entries SET winner = 1 WHERE tenant_id = ? AND entry_id = ?')
    .bind('fixture', id)
    .run();
  await db
    .prepare(
      'INSERT INTO poll_closings (tenant_id, week, snapshot, claim, expires_at) VALUES (?, ?, ?, ?, ?)',
    )
    .bind('fixture', '2026-11-09', JSON.stringify({ entryRefs: [id] }), 'fixture-claim', 1)
    .run();
  await bot.handleUpdate(textUpdate(11, '/entries'));
  expect(captions().join('\n')).toContain(botTexts.entriesPollNumber(1));
  expect(calls.filter((c) => c.method === 'sendPhoto')).toHaveLength(10);
  expect(captions().join('\n')).toContain('Private fixture');
  expect(calls.find((c) => c.method === 'sendPhoto')?.payload.photo).toBe('photo');

  for (const call of calls.filter((c) => c.payload.reply_markup)) {
    const markup = call.payload.reply_markup as { inline_keyboard: { callback_data: string }[][] };
    for (const row of markup.inline_keyboard)
      for (const button of row)
        expect(Buffer.byteLength(button.callback_data)).toBeLessThanOrEqual(64);
  }
  await press(`entries:withdraw:${scope}:${id}`);
  expect(await name()).toEqual({ display_name: 'Private fixture' });
  expect(captions().at(-1)).toContain(botTexts.entriesConfirmText);
  await press(`entries:status:${scope}:${id}`);
  expect(await name()).toEqual({ display_name: 'Private fixture' });
  await Promise.all([
    press(`entries:confirm:${scope}:${id}`),
    press(`entries:confirm:${scope}:${id}`),
  ]);
  expect(await name()).toEqual({ display_name: null });
  expect(
    await db
      .prepare(
        'SELECT winner, consent_at, file_id FROM contest_entries WHERE tenant_id = ? AND entry_id = ?',
      )
      .bind('fixture', id)
      .first(),
  ).toEqual({ winner: 1, consent_at: now.toISOString(), file_id: 'photo' });
  expect((await db.prepare('SELECT * FROM name_withdrawals').all()).results).toHaveLength(1);
  expect(captions().at(-1)).toContain(botTexts.entriesNotPublishedText);
  expect(captions().at(-1)).not.toContain('Private fixture');
  await bot.handleUpdate(textUpdate(11, '/entries'));
  expect(
    captions()
      .slice(-10)
      .find((c) => c.includes(id)),
  ).not.toContain('Private fixture');
  expect(
    await db
      .prepare('SELECT display_name FROM contest_entries WHERE tenant_id = ?')
      .bind('other')
      .first(),
  ).toEqual({ display_name: 'Private fixture' });
});
it('reports pending, rejected, unknown and complete public edits through author actions after cleanup', async () => {
  await submit();
  const receipt = anonymousEditReceiptSchema.parse({
    plan: {
      version: 1,
      type: 'wotw-result',
      entryRefs: [id],
      allowNames: true,
      settings: { channelId: 'CHANNEL' },
      operations: [{ kind: 'message', text: `{entry:${id}}`, lang: 'de' }],
    },
    remoteIds: [1],
    publishedAt: now.toISOString(),
  });
  await db
    .prepare('INSERT INTO anonymous_edit_receipts VALUES (?, ?, ?, ?, ?)')
    .bind('fixture', 'post', 'telegram', JSON.stringify(receipt), now.toISOString())
    .run();
  await db.prepare('DELETE FROM drafts').run();
  await press(`entries:withdraw:${scope}:${id}`);
  await press(`entries:confirm:${scope}:${id}`);
  expect(captions().at(-1)).toContain(botTexts.entriesPrivateDeletedText);
  expect(captions().at(-1)).toContain(botTexts.entriesPendingText);
  let outcome = 'rejected';
  const rendered: string[] = [];
  const runner = createNameReconciler({
    db,
    adapter: {
      key: 'telegram',
      editMessage: async (_remote, op) => {
        if (outcome === 'rejected') throw new ChannelEditRejectedError();
        if (outcome === 'unknown') throw new Error('transport');
        if (op.kind === 'message') rendered.push(op.text);
      },
    },
    secrets: { resolve: async () => '' },
  });
  await runner.tick();
  await press(`entries:status:${scope}:${id}`);
  expect(captions().at(-1)).toContain(botTexts.entriesRejectedText);
  outcome = 'unknown';
  await runner.tick();
  await press(`entries:status:${scope}:${id}`);
  expect(captions().at(-1)).toContain(botTexts.entriesOperatorText);
  await press(`entries:withdraw:${scope}:${id}`);
  const job = await db
    .prepare('SELECT lock_token FROM name_reconciliations')
    .first<{ lock_token: string }>();
  await runner.recoverQuiescent(
    { tenant_id: 'fixture', post_id: 'post', channel: 'telegram' },
    job!.lock_token,
    'remote-writer-stopped',
  );
  outcome = 'success';
  await runner.tick();
  await press(`entries:status:${scope}:${id}`);
  expect(captions().at(-1)).toContain(botTexts.entriesCompleteText);
  expect(rendered).toEqual(['Werk Nr. 1']);
});
it('keeps status output bounded even with many publications and distinguishes hook failures', () => {
  const status = {
    requestedAt: now.toISOString(),
    missingReceipt: true,
    notPublished: false,
    publications: Array.from({ length: 100 }, () => ({
      postId: 'post',
      channel: 'telegram',
      uneditableNames: false,
      progress: { state: 'failed', error_code: 'retry_required' },
    })),
  };
  const text = entryWithdrawalText(status, botTexts);
  expect(text).toContain(`${botTexts.entriesFailedText}: 100`);
  expect(text.length).toBeLessThan(1000);
});

it('supports anonymous entries and text buttons from the previous deployment', async () => {
  await submit();
  await db.prepare('UPDATE contest_entries SET display_name = NULL').run();
  await bot.handleUpdate(textUpdate(11, '/entries'));
  expect(captions().at(-1)).toContain(botTexts.entriesNameRemovedText);
  await bot.handleUpdate(callbackQueryUpdate(11, 11, `entries:withdraw:${scope}:${id}`));
  expect(calls.at(-1)?.method).toBe('editMessageText');
  expect(calls.at(-1)?.payload.text).toContain(botTexts.entriesConfirmText);
  expect(await db.prepare('SELECT * FROM name_withdrawals').first()).toBeNull();
  await press(`entries:confirm:${scope}:${id}`);
  expect(captions().at(-1)).toContain(botTexts.entriesPrivateDeletedText);
});

it('keeps a mixed status caption within the Telegram caption limit', () => {
  const status = {
    requestedAt: now.toISOString(),
    missingReceipt: true,
    notPublished: false,
    publications: ['pending', 'running', 'done', 'failed', 'failed'].map((state, i) => ({
      postId: 'post',
      channel: 'telegram',
      uneditableNames: false,
      progress: {
        state,
        generation: 1,
        completed_generation: 1,
        error_code: i === 3 ? 'edit_rejected' : 'retry_required',
      },
    })),
  };
  const caption = `${now.toISOString()} · ${id}\n${'🧶'.repeat(30)}\n${entryWithdrawalText(status, botTexts)}`;
  expect(caption.length).toBeLessThanOrEqual(1024);
});

it('accepts Telegram no-change acknowledgements on repeated refresh', async () => {
  await submit();
  bot.api.config.use(async (prev, method, payload, signal) => {
    if (method === 'editMessageCaption')
      return { ok: false, error_code: 400, description: 'Bad Request: message is not modified' };
    return prev(method, payload, signal);
  });
  await expect(press(`entries:status:${scope}:${id}`)).resolves.toBeUndefined();
  expect(await name()).toEqual({ display_name: 'Private fixture' });
});

it('falls back to a text row after a rejected photo and continues listing', async () => {
  await submit();
  await submit('01JBCA1B2C3D4E5F6G7H8J9K0P');
  let photos = 0;
  bot.api.config.use(async (prev, method, payload, signal) => {
    if (method === 'sendPhoto' && ++photos === 1)
      return { ok: false, error_code: 400, description: 'Bad Request: invalid file identifier' };
    return prev(method, payload, signal);
  });
  await bot.handleUpdate(textUpdate(11, '/entries'));
  expect(photos).toBe(2);
  expect(sentTexts(calls).some((text) => text.includes('01JBCA1B2C3D4E5F6G7H8J9K0P'))).toBe(true);
  expect(calls.filter((call) => call.method === 'sendPhoto')).toHaveLength(1);
});
