import { CommentReplyRejectedError } from '@handmake/core';
import type { ChannelCommentsCapability, ChannelCommentsContext } from '@handmake/core';
import type { Bot } from 'grammy';

import type { CreateBotOptions } from './bot';
import { buildCommentCard } from './comment-collect';
import type { CommentNetwork, CommentStore, StoredComment } from './comment-store';
import type { AppContext } from './context';

export interface CommentSessionOptions {
  store: CommentStore;
  capabilities: Partial<Record<CommentNetwork, ChannelCommentsCapability>>;
  context: ChannelCommentsContext;
}

/** Registered directly after the allow-list gate, ahead of other text consumers. */
export function registerCommentSession(bot: Bot<AppContext>, options: CreateBotOptions): void {
  const inbox = options.comments;
  if (!inbox) return;
  const { store, capabilities, context } = inbox;
  const { texts } = options;
  const present = async (ctx: AppContext, row: StoredComment) => {
    const card = buildCommentCard(
      row,
      {
        translationUk: row.translationUk ?? '',
        replyDe: row.replyDe ?? '',
        notesUk: row.notesUk ?? '',
      },
      texts,
    );
    try {
      await ctx.reply(card.text.slice(0, 4096), { reply_markup: card.keyboard });
    } catch {
      // Never expose Telegram errors carrying a reader's card payload.
      throw new Error('comment card delivery failed');
    }
  };
  bot.on('callback_query:data', async (ctx, next) => {
    if (!ctx.callbackQuery.data.startsWith('comment:')) return next();
    await ctx.answerCallbackQuery();
    const match = /^comment:(instagram|facebook):([^:]+):(send|edit|skip)$/.exec(
      ctx.callbackQuery.data,
    );
    if (!match || !ctx.chat || ctx.chat.type !== 'private') return;
    const [, networkValue, id, action] = match;
    const network = networkValue as CommentNetwork;
    const tenantId = ctx.tenantId;
    const now = new Date();
    if (action === 'edit') {
      const armed = await store.armEdit(tenantId, network, id!, String(ctx.chat.id), now);
      await ctx.reply(armed ? texts.commentEditPrompt : texts.commentUnavailable);
      return;
    }
    if (action === 'skip') {
      const skipped = await store.transition(tenantId, network, id!, 'drafted', 'skipped', now);
      await ctx.reply(skipped ? texts.commentSkipped : texts.commentUnavailable);
      return;
    }
    const capability = capabilities[network];
    const config = await options.tenantConfigs?.load(tenantId);
    if (!capability || (config && !config.channels[network])) {
      await ctx.reply(texts.commentUnavailable);
      return;
    }
    const row = await store.get(tenantId, network, id!);
    if (!row?.replyDe?.trim()) return void (await ctx.reply(texts.commentUnavailable));
    const claimed = await store.transition(tenantId, network, id!, 'drafted', 'sending', now);
    if (!claimed) return void (await ctx.reply(texts.commentUnavailable));
    options.background(async () => {
      try {
        await capability.replyToComment(id!, claimed.replyDe!, context);
      } catch (error) {
        // Only an explicit rejection permits another send. Timeouts remain uncertain.
        if (error instanceof CommentReplyRejectedError) {
          await store.transition(tenantId, network, id!, 'sending', 'drafted', new Date());
          await bot.api.sendMessage(String(ctx.chat!.id), texts.commentSendFailed);
        } else {
          console.warn('comment reply delivery uncertain');
          await bot.api.sendMessage(String(ctx.chat!.id), texts.commentSendUncertain);
        }
        return;
      }
      await store.transition(tenantId, network, id!, 'sending', 'sent', new Date());
      await bot.api.sendMessage(String(ctx.chat!.id), texts.commentSent);
    });
  });
  bot.on('message:text', async (ctx, next) => {
    if (ctx.chat.type !== 'private' || ctx.msg.text.startsWith('/') || !ctx.msg.text.trim())
      return next();
    const edited = await store.applyEdit(
      ctx.tenantId,
      String(ctx.chat.id),
      ctx.msg.text,
      new Date(),
    );
    if (!edited) return next();
    await present(ctx, edited);
  });
}
