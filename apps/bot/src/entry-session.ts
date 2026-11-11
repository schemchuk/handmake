import { contestWeek, newUlid } from '@handmake/core';
import type { Bot } from 'grammy';
import type { AppContext } from './context';

export const entryConsentText =
  'Підтверджую, що учасниця погодилася на показ фото її роботи в Telegram, Instagram, Facebook і Threads. ' +
  'Обране ім’я або псевдонім можна показувати лише в Telegram. На сайті роботу та ім’я не публікуємо. ' +
  'На фото немає впізнаваних облич без письмової згоди. Згоду можна відкликати будь-коли через авторку. ' +
  'Ім’я переможниці зберігається до відкликання; інші імена видаляються через 90 днів після публікації результату.';
const prompt =
  'Надішли одне фото роботи, потім ім’я або псевдонім (до 30 символів), або обери «Анонімно». /discard — скасувати.';
const stale = 'Ця сесія завершена або змінилася. /entry — конкурсна робота, /new — новий допис.';
interface Input {
  entry_id: string;
  revision: string;
  file_id: string | null;
  name_chosen: number;
}

/** All SQL failures are scrubbed: D1 errors can otherwise include bound personal data. */
export function createEntrySessionStore(db: D1Database) {
  async function run(sql: string, values: unknown[]) {
    try {
      return await db
        .prepare(sql)
        .bind(...values)
        .run();
    } catch {
      throw new Error('Contest session storage failed');
    }
  }
  return {
    async cleanup(now: Date) {
      await run('DELETE FROM contest_sessions WHERE expires_at <= ?', [now.toISOString()]);
    },
    async cancel(tenant: string, chat: string) {
      await run('DELETE FROM contest_sessions WHERE tenant_id = ? AND chat_id = ?', [tenant, chat]);
    },
    async start(tenant: string, chat: string) {
      await run(
        `INSERT OR REPLACE INTO contest_sessions
        (tenant_id, chat_id, entry_id, revision, expires_at) VALUES (?, ?, ?, ?, ?)`,
        [tenant, chat, newUlid(), newUlid(), new Date(Date.now() + 86400000).toISOString()],
      );
    },
    async get(tenant: string, chat: string): Promise<Input | null> {
      try {
        return await db
          .prepare(
            `SELECT entry_id, revision, file_id, name_chosen FROM contest_sessions
          WHERE tenant_id = ? AND chat_id = ? AND expires_at > ?`,
          )
          .bind(tenant, chat, new Date().toISOString())
          .first<Input>();
      } catch {
        throw new Error('Contest session lookup failed');
      }
    },
    async edit(
      tenant: string,
      chat: string,
      input: Input,
      field: 'photo' | 'name',
      value: string | null,
    ) {
      const assignment = field === 'photo' ? 'file_id = ?' : 'display_name = ?, name_chosen = 1';
      const result = await run(
        `UPDATE contest_sessions SET ${assignment}, revision = ?
        WHERE tenant_id = ? AND chat_id = ? AND revision = ? AND expires_at > ?
        ${field === 'photo' ? 'AND file_id IS NULL' : ''}`,
        [value, newUlid(), tenant, chat, input.revision, new Date().toISOString()],
      );
      return result.meta.changes === 1;
    },
    async confirm(tenant: string, chat: string, revision: string) {
      const now = new Date();
      // INSERT SELECT snapshots the exact revision in one SQLite statement. A retry cannot
      // duplicate it; edits or cancellation winning first invalidate this confirmation.
      const result = await run(
        `INSERT INTO contest_entries
        (tenant_id, entry_id, week, file_id, display_name, consent_at, created_at)
        SELECT tenant_id, entry_id, ?, file_id, display_name, ?, ? FROM contest_sessions
        WHERE tenant_id = ? AND chat_id = ? AND revision = ? AND file_id IS NOT NULL
          AND name_chosen = 1 AND expires_at > ?
        ON CONFLICT (tenant_id, entry_id) DO NOTHING`,
        [
          contestWeek(now),
          now.toISOString(),
          now.toISOString(),
          tenant,
          chat,
          revision,
          now.toISOString(),
        ],
      );
      // Only remove the submitted session; never a concurrently started replacement.
      await run(
        `DELETE FROM contest_sessions WHERE tenant_id = ? AND chat_id = ?
        AND EXISTS (SELECT 1 FROM contest_entries e WHERE e.tenant_id = contest_sessions.tenant_id
          AND e.entry_id = contest_sessions.entry_id)`,
        [tenant, chat],
      );
      return result.meta.changes === 1;
    },
  };
}
export type EntrySessionStore = ReturnType<typeof createEntrySessionStore>;

export function registerEntrySession(bot: Bot<AppContext>, store?: EntrySessionStore) {
  if (!store) return;
  bot.use(async (ctx, next) => {
    if (!ctx.chat) return next();
    const tenant = ctx.tenantId;
    const chat = String(ctx.chat.id);
    const text = ctx.msg?.text;
    const command = text?.match(/^\/(\w+)(?:@\w+)?(?:\s|$)/)?.[1];
    const data = ctx.callbackQuery?.data;
    try {
      if (command === 'entry') {
        await store.cleanup(new Date());
        await ctx.drafts.setChatSession(tenant, chat, { kind: 'entry', draftId: null }, new Date());
        await store.start(tenant, chat);
        await ctx.reply(prompt);
        return;
      }
      const input = await store.get(tenant, chat);
      const session = await ctx.drafts.getChatSession(tenant, chat);
      const entryMode = Boolean(input) || session?.kind === 'entry';
      if (entryMode || data?.startsWith('entry:')) await store.cleanup(new Date());
      if (data?.startsWith('entry:')) {
        await ctx.answerCallbackQuery();
        const [, revision, action] = data.split(':');
        if (!input || input.revision !== revision) return void (await ctx.reply(stale));
        if (action === 'anonymous') {
          if (!(await store.edit(tenant, chat, input, 'name', null)))
            return void (await ctx.reply(stale));
          await offerConsent();
        } else if (action === 'confirm' && revision) {
          await ctx.reply(
            (await store.confirm(tenant, chat, revision)) ? 'Роботу додано до конкурсу.' : stale,
          );
        }
        return;
      }
      // A command or a foreign flow button explicitly leaves entry mode before routing.
      if (command || data) {
        if (entryMode) {
          await store.cancel(tenant, chat);
          // Entry completion/expiry can leave only a routing marker. Clear that too:
          // preview and comment edit buttons rely on the next plain text reaching them.
          if (session?.kind === 'entry') {
            await ctx.drafts.setChatSession(
              tenant,
              chat,
              { kind: 'post', draftId: null },
              new Date(),
            );
          }
        }
        if (entryMode && (command === 'discard' || command === 'cancel')) {
          await ctx.reply('Участь скасовано. Непідтверджені дані видалено.');
          return;
        }
        return next();
      }
      if (!input) {
        if (session?.kind === 'entry') {
          await ctx.reply(stale);
          return;
        }
        return next();
      }
      if (ctx.msg?.photo) {
        if (input.file_id)
          return void (await ctx.reply('Лише одне фото. Для заміни почни нову /entry.'));
        const file = ctx.msg.photo.at(-1)?.file_id;
        if (file) await store.edit(tenant, chat, input, 'photo', file);
        // Captions are deliberately not interpreted as names or post text.
        await offerConsent();
      } else if (text) {
        const name = text.trim();
        if (!name || Array.from(name).length > 30) {
          await ctx.reply('Ім’я або псевдонім: від 1 до 30 символів.');
          return;
        }
        if (!(await store.edit(tenant, chat, input, 'name', name)))
          return void (await ctx.reply(stale));
        await offerConsent();
      } else await ctx.reply(prompt);

      async function offerConsent() {
        const fresh = await store!.get(tenant, chat);
        if (!fresh) return;
        await ctx.reply(fresh.file_id && fresh.name_chosen ? entryConsentText : prompt, {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: fresh.file_id && fresh.name_chosen ? 'Підтверджую згоду' : 'Анонімно',
                  callback_data: `entry:${fresh.revision}:${fresh.file_id && fresh.name_chosen ? 'confirm' : 'anonymous'}`,
                },
              ],
            ],
          },
        });
      }
    } catch {
      // Never propagate Telegram/D1 diagnostics that might echo an optional name.
      await ctx.reply('Не вдалося зберегти участь. Спробуй /entry ще раз.');
    }
  });
}
