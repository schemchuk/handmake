import { isUlid, showDraftDataSchema } from '@handmake/core';
import type { Bot } from 'grammy';
import type { AppContext } from './context';
import type { CreateBotOptions } from './bot';
import type { StoredDraft } from './draft-store';
import type { ShowReconciliation } from './show-draft-flow';

export type ShowRecoveryControls = {
  isOperator: (userId: number, tenantId: string) => boolean;
  recover: (stored: StoredDraft) => Promise<void>;
  reconcile: (stored: StoredDraft, confirmation: ShowReconciliation) => Promise<boolean>;
};

/** Operator commands require explicit draft/version/attempt identities, never a chat default. */
export function registerShowRecovery(bot: Bot<AppContext>, options: CreateBotOptions) {
  const controls = options.show?.recovery;
  bot.command('show_status', async (ctx) => {
    if (
      !ctx.from ||
      !controls?.isOperator(ctx.from.id, ctx.tenantId) ||
      ctx.chat.type !== 'private'
    )
      return ctx.reply('Ця дія доступна лише оператору.');
    const session = await options.drafts.getChatSession(ctx.tenantId, String(ctx.chat.id));
    const id = ctx.match.trim() || session?.draftId;
    try {
      const stored = id && isUlid(id) ? await options.drafts.get(ctx.tenantId, id) : undefined;
      if (!stored || stored.draft.kind !== 'show') throw new Error('missing');
      const data = showDraftDataSchema.parse(stored.draft.extras['show']);
      return ctx.reply(
        JSON.stringify({
          id,
          version: stored.version,
          state: stored.draft.state,
          cancelled: !!stored.draft.extras['showCancelled'],
          pending: data.pending,
          reconciled: data.reconciled.length,
          outputs: Object.keys(data.outputs),
        }),
      );
    } catch {
      return ctx.reply('Показ не знайдено або план ще не підготовлено.');
    }
  });
  for (const command of ['show_recover', 'show_reconcile'] as const) {
    bot.command(command, async (ctx) => {
      if (
        !ctx.from ||
        !controls?.isOperator(ctx.from.id, ctx.tenantId) ||
        ctx.chat.type !== 'private'
      )
        return ctx.reply('Ця дія доступна лише оператору.');
      try {
        const [id, version, attempt, ...payload] = ctx.match.trim().split(/\s+/);
        const stored = id && isUlid(id) ? await options.drafts.get(ctx.tenantId, id) : undefined;
        if (
          !stored ||
          stored.draft.kind !== 'show' ||
          !/^\d+$/.test(version ?? '') ||
          stored.version !== Number(version) ||
          showDraftDataSchema.parse(stored.draft.extras['show']).pending?.attemptId !== attempt
        )
          throw new Error('stale recovery');
        if (command === 'show_recover') await controls.recover(stored);
        else {
          const confirmation = JSON.parse(payload.join(' ')) as ShowReconciliation;
          if (
            confirmation.operatorConfirmed !== true ||
            typeof confirmation.note !== 'string' ||
            !confirmation.note.trim() ||
            !(await controls.reconcile(stored, confirmation))
          )
            throw new Error('rejected');
        }
        return ctx.reply('Дію оператора прийнято. Перевір стан через /show.');
      } catch {
        return ctx.reply('Дію відхилено. Перевір версію, спробу та підтвердження витрат.');
      }
    });
  }
  bot.command('discard', async (ctx, next) => {
    const session = await options.drafts.getChatSession(ctx.tenantId, String(ctx.chat.id));
    if (session?.kind !== 'show' || !session.draftId) return next();
    const stored = await options.drafts.get(ctx.tenantId, session.draftId);
    if (!stored || stored.draft.kind !== 'show') return ctx.reply(options.texts.discardNothingText);
    if (
      !(await options.drafts.updateShow(
        {
          ...stored.draft,
          state: 'failed',
          updatedAt: new Date().toISOString(),
          extras: { ...stored.draft.extras, showCancelled: true },
        },
        stored.version,
      ))
    )
      return ctx.reply(options.texts.draftBusyText);
    await options.drafts.setChatSession(
      ctx.tenantId,
      String(ctx.chat.id),
      { kind: 'show', draftId: null },
      new Date(),
    );
    return ctx.reply(
      `Показ ${stored.draft.draftId} скасовано. Докази та невизначені витрати збережено; їх перевіряє оператор.`,
    );
  });
}
