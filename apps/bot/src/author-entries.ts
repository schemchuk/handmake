import { isUlid } from '@handmake/core';
import { InlineKeyboard, type Bot } from 'grammy';
import type { AppContext } from './context';
import { createNameWithdrawalStore } from './name-withdrawal-store';
import type { BotTexts } from './texts';

interface Entry {
  entry_id: string;
  week: string;
}

/** Author access is tenant-wide; entries carry no participant identity. */
export function createAuthorEntriesStore(db: D1Database) {
  const withdrawals = createNameWithdrawalStore(db);
  return {
    ...withdrawals,
    async recent(tenant: string) {
      return (
        await db
          .prepare(
            `SELECT entry_id, week FROM contest_entries WHERE tenant_id = ?
             ORDER BY created_at DESC, entry_id DESC LIMIT 10`,
          )
          .bind(tenant)
          .all<Entry>()
      ).results;
    },
    async exists(tenant: string, entry: string) {
      return !!(await db
        .prepare('SELECT 1 FROM contest_entries WHERE tenant_id = ? AND entry_id = ?')
        .bind(tenant, entry)
        .first());
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
  bot.command('entries', async (ctx) => {
    if (!store || ctx.chat.type !== 'private') return ctx.reply(texts.entriesPrivateOnlyText);
    const entries = await store.recent(ctx.tenantId);
    await ctx.reply(entries.length ? texts.entriesRecentText : texts.entriesEmptyText);
    const scope = await actionScope(ctx.tenantId);
    for (const entry of entries) {
      await ctx.reply(
        `${entry.week} · ${entry.entry_id}\n${entryWithdrawalText(await store.status(ctx.tenantId, entry.entry_id), texts)}`,
        {
          reply_markup: new InlineKeyboard()
            .text(texts.entriesWithdrawButton, `entries:withdraw:${scope}:${entry.entry_id}`)
            .row()
            .text(texts.entriesRefreshButton, `entries:status:${scope}:${entry.entry_id}`),
        },
      );
    }
  });
  bot.callbackQuery(/^entries:/, async (ctx) => {
    const match = /^entries:(withdraw|status):([0-9a-f]{16}):([0-9A-Z]{26})$/.exec(
      ctx.callbackQuery.data,
    );
    if (
      !store ||
      ctx.chat?.type !== 'private' ||
      !match ||
      match[2] !== (await actionScope(ctx.tenantId)) ||
      !isUlid(match[3]!) ||
      !(await store.exists(ctx.tenantId, match[3]!))
    )
      return ctx.answerCallbackQuery({ text: texts.entriesInvalidText });
    await ctx.answerCallbackQuery();
    const status = await (match[1] === 'withdraw'
      ? store.withdraw(ctx.tenantId, match[3]!)
      : store.status(ctx.tenantId, match[3]!));
    return ctx.reply(entryWithdrawalText(status, texts));
  });
}
