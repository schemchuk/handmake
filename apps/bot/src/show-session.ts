import type { ShowApproval } from './show-approval';
import { registerShowRecovery } from './show-recovery';
import type { ShowRecoveryControls } from './show-recovery';
import { isUlid } from '@handmake/core';
import type { WorkReader } from '@handmake/core';
import type { Bot } from 'grammy';

import type { CreateBotOptions } from './bot';
import type { AppContext } from './context';
import type { StoredDraft } from './draft-store';
import type { TenantConfigSource } from './tenant-config-source';
import type { ShowStart } from './show-start';
import { refreshKeyboard } from './show-preview';
import type { ShowPreview } from './show-preview';
import { createShowInput } from './show-input';

export interface ShowSessionOptions {
  approval?: ShowApproval;
  recovery?: ShowRecoveryControls;
  works: WorkReader;
  configs: TenantConfigSource;
  start?: ShowStart;
  preview?: ShowPreview;
}
type Selection = { ids: string[]; version: number; workId?: string; awaitingWorkId?: string };

/** Keep show input and explicit execution inside their own author session. */
export function registerShowSession(
  bot: Bot<AppContext>,
  options: CreateBotOptions,
  startWork: (ctx: AppContext) => Promise<unknown>,
) {
  registerShowRecovery(bot, options);
  const { drafts, texts, show } = options;
  const input = createShowInput(options);
  const enabled = async (tenantId: string) => {
    const config = await show?.configs.load(tenantId);
    return config?.id === tenantId && !!config.shows && !!config.ai;
  };
  const save = (stored: StoredDraft, selection: Selection) =>
    drafts.updateShow(
      {
        ...stored.draft,
        extras: { ...stored.draft.extras, showSelection: selection },
        updatedAt: new Date().toISOString(),
      },
      stored.version,
    );
  const activate = (ctx: AppContext, id: string) =>
    drafts.setChatSession(
      ctx.tenantId,
      String(ctx.chat!.id),
      { kind: 'show', draftId: id },
      new Date(),
    );
  const present = async (ctx: AppContext, stored: StoredDraft) => {
    if (stored.draft.state === 'published') return ctx.reply(texts.draftFinishedText);
    if (stored.draft.extras['show']) {
      if (stored.draft.extras['showApproved'])
        return ctx.reply(texts.publishingText, {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: texts.showPublishRetryButton,
                  callback_data: `show:${stored.draft.draftId}:approve:${stored.draft.extras['showApprovalVersion']}`,
                },
              ],
            ],
          },
        });
      if (stored.draft.state === 'ready' && show?.approval) {
        options.background(async () => {
          try {
            await show.approval!.present(ctx, stored);
          } catch {
            await ctx.reply(texts.showPreviewInterruptedText).catch(() => undefined);
          }
        });
        return ctx.reply(texts.showPreviewReadyText);
      }
      if (stored.draft.state === 'collecting') return input.presentStart(ctx, stored);
      return ctx.reply(texts.showPreviewReadyText, refreshKeyboard(stored, texts));
    }
    if (stored.draft.state !== 'collecting') return ctx.reply(texts.draftBusyText);
    const selection = stored.draft.extras['showSelection'] as Selection | undefined;
    const linked = selection?.workId ?? selection?.awaitingWorkId;
    if (linked) {
      const work = await show!.works.readWork(ctx.tenantId, linked);
      const pending = selection?.awaitingWorkId
        ? await drafts.get(ctx.tenantId, linked)
        : undefined;
      const awaitedDiscarded = selection?.awaitingWorkId && !pending && !work;
      if (!awaitedDiscarded) {
        if (selection?.awaitingWorkId && pending && pending.draft.state !== 'published')
          return ctx.reply(texts.showAwaitingWorkText);
        if (!work || work.tenant !== ctx.tenantId || work.id !== linked)
          return ctx.reply(texts.showMissingWorkText);
        if (
          selection?.awaitingWorkId &&
          !(await save(stored, { ...selection, workId: linked, awaitingWorkId: undefined }))
        )
          throw new Error('show selection changed');
        const updated = await drafts.get(ctx.tenantId, stored.draft.draftId);
        return input.present(ctx, updated!);
      }
    }
    const works = (await show!.works.listWorks(ctx.tenantId)).filter(
      (work) => work.tenant === ctx.tenantId,
    );
    const menu: Selection = { ids: works.map((work) => work.id), version: stored.version + 1 };
    if (!(await save(stored, menu))) throw new Error('show selection changed');
    await ctx.reply(texts.showSelectText, {
      reply_markup: {
        inline_keyboard: [
          ...works.map((work, index) => [
            {
              text: Array.from(Object.values(work.versions)[0]?.description ?? work.id)
                .slice(0, 60)
                .join(''),
              callback_data: `show:${stored.draft.draftId}:pick:${menu.version}.${index}`,
            },
          ]),
          [
            {
              text: texts.showNewWorkButton,
              callback_data: `show:${stored.draft.draftId}:new:${menu.version}`,
            },
          ],
        ],
      },
    });
  };
  bot.command('show', async (ctx) => {
    try {
      if (!(await enabled(ctx.tenantId))) return ctx.reply(texts.showUnavailableText);
      const stored =
        (await drafts.findShowForChat(ctx.tenantId, String(ctx.chat.id))) ??
        (await drafts.getOrCreateCollecting(ctx.tenantId, String(ctx.chat.id), 'show', new Date()));
      await activate(ctx, stored.draft.draftId);
      return await present(ctx, stored);
    } catch {
      return ctx.reply(texts.showUnavailableText);
    }
  });
  bot.on('callback_query:data', async (ctx, next) => {
    if (!ctx.callbackQuery.data.startsWith('show:')) return next();
    await ctx.answerCallbackQuery();
    try {
      if (!(await enabled(ctx.tenantId))) return ctx.reply(texts.showUnavailableText);
      const [, id, action, value] = ctx.callbackQuery.data.split(':');
      const stored = id && isUlid(id) ? await drafts.get(ctx.tenantId, id) : undefined;
      if (action?.startsWith('own')) {
        const stale = () => ctx.reply('Цей крок уже змінився. Відкрийте /show ще раз.');
        if (action !== 'owncancel' || !stored) return stale();
        const active = await drafts.getSessionShow(ctx.tenantId, String(ctx.chat?.id), id!);
        if (
          ctx.chat?.type !== 'private' ||
          !active ||
          active.version !== stored.version ||
          String(stored.version) !== value ||
          stored.draft.kind !== 'show' ||
          stored.draft.state !== 'ready' ||
          !stored.draft.extras['show'] ||
          stored.draft.extras['showApproved'] ||
          stored.draft.extras['showCancelled']
        )
          return stale();
        if (
          !(await drafts.updateShow(
            {
              ...stored.draft,
              state: 'failed',
              updatedAt: new Date().toISOString(),
              extras: { ...stored.draft.extras, showCancelled: true },
            },
            stored.version,
          ))
        )
          return stale();
        await drafts.setChatSession(
          ctx.tenantId,
          String(ctx.chat.id),
          { kind: 'show', draftId: null },
          new Date(),
        );
        return ctx.reply(
          `Показ ${stored.draft.draftId} скасовано. Докази та невизначені витрати збережено; їх перевіряє оператор.`,
        );
      }
      if (action === 'approve' && stored && show?.approval) {
        const job = await show.approval.approve(ctx, stored, value ?? '');
        if (!job) return ctx.reply(texts.draftBusyText);
        options.background(async () => {
          try {
            await options.publishRunner.run(job);
          } catch {
            await drafts.revertPublishing(ctx.tenantId, id!, new Date());
            await ctx.reply(texts.publishFailedText).catch(() => undefined);
          }
        });
        return ctx.reply(texts.publishingText);
      }
      if (
        !stored ||
        stored.draft.kind !== 'show' ||
        stored.draft.extras['showCancelled'] ||
        !['collecting', 'translating', 'failed', 'ready'].includes(stored.draft.state) ||
        (!['preview', 'retry', 'regen'].includes(action ?? '') &&
          stored.draft.state !== 'collecting') ||
        (await drafts.chatIdOf(ctx.tenantId, id!)) !== String(ctx.chat!.id) ||
        (stored.draft.extras['show'] &&
          !['start', 'preview', 'retry', 'regen'].includes(action ?? ''))
      )
        return ctx.reply(texts.showSelectionErrorText);
      if (action === 'retry' || action === 'regen') {
        const active = await drafts.getSessionShow(ctx.tenantId, String(ctx.chat!.id), id!);
        if (!active || active.version !== stored.version)
          return ctx.reply(texts.showSelectionErrorText);
        const [version, slot] = (value ?? '').split('.');
        if (
          (action === 'retry' && stored.draft.state !== 'failed') ||
          (action === 'regen' && (stored.draft.state !== 'ready' || !slot))
        )
          return ctx.reply(texts.showSelectionErrorText);
        return await input.start(ctx, stored, version ?? '', action === 'regen' ? slot : undefined);
      }
      if (action === 'preview') {
        if (
          !/^\d+$/.test(value ?? '') ||
          Number(value) !== stored.version ||
          !stored.draft.extras['show']
        )
          return ctx.reply(texts.showSelectionErrorText);
        if (!show?.preview) return ctx.reply(texts.showUnavailableText);
        options.background(async () => {
          try {
            if (stored.draft.state === 'ready' && show.approval)
              await show.approval.present(ctx, stored);
            else await show.preview!(ctx, stored);
          } catch {
            // External errors can contain credential-bearing URLs; log only fixed reasons.
            console.error('show preview failed', 'background delivery failed');
            try {
              await ctx.reply(texts.showPreviewInterruptedText);
            } catch {
              console.error('show preview failed', 'notification failed');
            }
          }
        });
        return;
      }
      if (action === 'start') return await input.start(ctx, stored, value ?? '');
      if (['originals', 'reset', 'template', 'persona', 'finalize'].includes(action ?? ''))
        return await input.action(ctx, stored, action!, value ?? '');
      const menu = stored.draft.extras['showSelection'] as Selection | undefined;
      const [version, index] = (value ?? '').split('.').map(Number);
      if (!menu || menu.workId || menu.awaitingWorkId || version !== menu.version)
        return ctx.reply(texts.showSelectionErrorText);
      if (action === 'new') {
        if (!options.work) return ctx.reply(texts.workUnavailableText);
        const work = await drafts.getOrCreateCollecting(
          ctx.tenantId,
          String(ctx.chat!.id),
          'work',
          new Date(),
        );
        if (!(await save(stored, { ...menu, awaitingWorkId: work.draft.draftId })))
          throw new Error('show selection changed');
        await drafts.setChatSession(
          ctx.tenantId,
          String(ctx.chat!.id),
          { kind: 'work', draftId: work.draft.draftId },
          new Date(),
        );
        await ctx.reply(texts.showNewWorkText);
        return await startWork(ctx);
      }
      const workId = Number.isInteger(index) && index! >= 0 ? menu.ids[index!] : undefined;
      const work =
        action === 'pick' && workId ? await show!.works.readWork(ctx.tenantId, workId) : undefined;
      if (!work || work.tenant !== ctx.tenantId || work.id !== workId)
        return ctx.reply(texts.showMissingWorkText);
      if (!(await save(stored, { ...menu, workId }))) throw new Error('show selection changed');
      await activate(ctx, id!);
      return await input.present(ctx, (await drafts.get(ctx.tenantId, id!))!);
    } catch {
      return ctx.reply(texts.showSelectionErrorText);
    }
  });
  // Stop show input before generic post/work collection and armed edits; commands route below.
  bot.on('message', async (ctx, next) => {
    const session = await drafts.getChatSession(ctx.tenantId, String(ctx.chat.id));
    if (session?.kind !== 'show' || ctx.msg.text?.startsWith('/')) return next();
    try {
      if (ctx.msg.photo?.length && session.draftId)
        return await input.photo(ctx, session.draftId, ctx.msg.photo.at(-1)!.file_id);
      return ctx.reply(texts.showContinueText);
    } catch {
      return ctx.reply(texts.showMissingWorkText);
    }
  });
}
