import { isUlid } from '@handmake/core';
import { GrammyError, InlineKeyboard, type Bot } from 'grammy';
import type { AppContext } from './context';
import { createNameWithdrawalStore } from './name-withdrawal-store';
import type { BotTexts } from './texts';

interface Entry {
  entry_id: string;
  week: string;
  file_id: string;
  display_name: string | null;
  poll_number: number | null;
}

const entrySelect = `SELECT e.entry_id, e.week, e.file_id, e.display_name,
  (SELECT CAST(refs.key AS INTEGER) + 1 FROM poll_closings c,
    json_each(c.snapshot, '$.entryRefs') refs
    WHERE c.tenant_id = e.tenant_id AND refs.value = e.entry_id
    ORDER BY c.week DESC LIMIT 1) AS poll_number
  FROM contest_entries e`;

/** Author access is tenant-wide; entries carry no participant identity. */
export function createAuthorEntriesStore(db: D1Database) {
  const withdrawals = createNameWithdrawalStore(db);
  return {
    ...withdrawals,
    async recent(tenant: string) {
      return (
        await db
          .prepare(
            ` ${entrySelect} WHERE e.tenant_id = ?
             ORDER BY e.created_at DESC, e.entry_id DESC LIMIT 10`,
          )
          .bind(tenant)
          .all<Entry>()
      ).results;
    },
    async get(tenant: string, entry: string) {
      return db
        .prepare(`${entrySelect} WHERE e.tenant_id = ? AND e.entry_id = ?`)
        .bind(tenant, entry)
        .first<Entry>();
    },
  };
}
export type AuthorEntriesStore = ReturnType<typeof createAuthorEntriesStore>;

export function entryWithdrawalText(
  status: Awaited<ReturnType<AuthorEntriesStore['status']>>,
  texts: BotTexts,
): string {
  if (!status) return texts.entriesNoWithdrawalText;
  const lines: string[] = [texts.entriesPrivateDeletedText];
  if (status.notPublished) lines.push(texts.entriesNotPublishedText);
  if (status.missingReceipt) lines.push(texts.entriesMissingReceiptText);
  const counts = new Map<string, number>();
  for (const publication of status.publications) {
    const p = publication.progress;
    let state: string = texts.entriesPendingText;
    if (publication.uneditableNames || p?.['state'] === 'blocked' || p?.['state'] === 'running')
      state = texts.entriesOperatorText;
    else if (p?.['state'] === 'done' && p['completed_generation'] === p['generation'])
      state = texts.entriesCompleteText;
    else if (p?.['error_code'] === 'edit_rejected') state = texts.entriesRejectedText;
    else if (p?.['state'] === 'failed') state = texts.entriesFailedText;
    counts.set(state, (counts.get(state) ?? 0) + 1);
  }
  for (const [state, count] of counts) lines.push(`${state}: ${count}.`);
  return lines.join('\n');
}

async function actionScope(tenant: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(tenant));
  return Array.from(new Uint8Array(digest).slice(0, 8), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');
}

/** Registered after the global allow-list middleware. Never trust a callback tenant. */
export function registerAuthorEntries(
  bot: Bot<AppContext>,
  store: AuthorEntriesStore | undefined,
  texts: BotTexts,
) {
  const label = (entry: Entry) =>
    `${entry.week} · ${entry.entry_id}${entry.poll_number ? ` · ${texts.entriesPollNumber(entry.poll_number)}` : ''}\n${entry.display_name ?? texts.entriesNameRemovedText}`;
  const buttons = (scope: string, id: string) =>
    new InlineKeyboard()
      .text(texts.entriesWithdrawButton, `entries:withdraw:${scope}:${id}`)
      .row()
      .text(texts.entriesRefreshButton, `entries:status:${scope}:${id}`);
  bot.command('entries', async (ctx) => {
    if (!store || ctx.chat.type !== 'private') return ctx.reply(texts.entriesPrivateOnlyText);
    const entries = await store.recent(ctx.tenantId);
    await ctx.reply(entries.length ? texts.entriesRecentText : texts.entriesEmptyText);
    const scope = await actionScope(ctx.tenantId);
    for (const entry of entries) {
      const text = `${label(entry)}\n${entryWithdrawalText(await store.status(ctx.tenantId, entry.entry_id), texts)}`;
      const reply_markup = buttons(scope, entry.entry_id);
      try {
        await ctx.replyWithPhoto(entry.file_id, { caption: text, reply_markup });
      } catch {
        // An expired media reference must not hide the remaining entries.
        try {
          await ctx.reply(text, { reply_markup });
        } catch {
          console.error('Author entry row delivery failed');
        }
      }
    }
  });
  bot.callbackQuery(/^entries:/, async (ctx) => {
    const match = /^entries:(withdraw|confirm|status):([0-9a-f]{16}):([0-9A-Z]{26})$/.exec(
      ctx.callbackQuery.data,
    );
    if (
      !store ||
      ctx.chat?.type !== 'private' ||
      !match ||
      match[2] !== (await actionScope(ctx.tenantId)) ||
      !isUlid(match[3]!) ||
      !(await store.get(ctx.tenantId, match[3]!))
    )
      return ctx.answerCallbackQuery({ text: texts.entriesInvalidText });
    await ctx.answerCallbackQuery();
    // Text rows from the previous deployment remain usable after this upgrade.
    const edit = async (caption: string, reply_markup: InlineKeyboard) => {
      try {
        return await (ctx.callbackQuery.message?.photo
          ? ctx.editMessageCaption({ caption, reply_markup })
          : ctx.editMessageText(caption, { reply_markup }));
      } catch (error) {
        // Repeated refresh/confirm can render the exact same acknowledged row.
        if (
          error instanceof GrammyError &&
          error.error_code === 400 &&
          error.description.includes('message is not modified')
        )
          return;
        throw error;
      }
    };
    const entry = (await store.get(ctx.tenantId, match[3]!))!;
    if (match[1] === 'withdraw') {
      return edit(
        `${label(entry)}\n${texts.entriesConfirmText}`,
        new InlineKeyboard()
          .text(texts.entriesConfirmButton, `entries:confirm:${match[2]}:${entry.entry_id}`)
          .row()
          .text(texts.entriesCancelButton, `entries:status:${match[2]}:${entry.entry_id}`),
      );
    }
    const status = await (match[1] === 'confirm'
      ? store.withdraw(ctx.tenantId, entry.entry_id)
      : store.status(ctx.tenantId, entry.entry_id));
    const current = (await store.get(ctx.tenantId, entry.entry_id))!;
    return edit(
      `${label(current)}\n${entryWithdrawalText(status, texts)}`,
      buttons(match[2]!, entry.entry_id),
    );
  });
}
