import { isUlid } from '@handmake/core';
import type { WorkReader } from '@handmake/core';
import type { Bot } from 'grammy';

import type { CreateBotOptions } from './bot';
import type { AppContext } from './context';
import type { StoredDraft } from './draft-store';
import type { TenantConfigSource } from './tenant-config-source';
import { createShowInput } from './show-input';

export interface ShowSessionOptions {
  works: WorkReader;
  configs: TenantConfigSource;
}
type Selection = { ids: string[]; version: number; workId?: string; awaitingWorkId?: string };

/** Author input only; configuring and dispatching a generation plan belong to T44e4c. */
export function registerShowSession(
  bot: Bot<AppContext>,
  options: CreateBotOptions,
  startWork: (ctx: AppContext) => Promise<unknown>,
) {
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
    if (stored.draft.state !== 'collecting' || stored.draft.extras['show'])
      return ctx.reply(texts.draftBusyText);
    const selection = stored.draft.extras['showSelection'] as Selection | undefined;
    const linked = selection?.workId ?? selection?.awaitingWorkId;
    if (linked) {
      const work = await show!.works.readWork(ctx.tenantId, linked);
      const pending = selection?.awaitingWorkId
        ? await drafts.get(ctx.tenantId, linked)
        : undefined;
      if (selection?.awaitingWorkId && !pending && !work)
        return ctx.reply(texts.showMissingWorkText);
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
      const stored = await drafts.getOrCreateCollecting(
        ctx.tenantId,
        String(ctx.chat.id),
        'show',
        new Date(),
      );
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
      if (
        !stored ||
        stored.draft.kind !== 'show' ||
        stored.draft.state !== 'collecting' ||
        (await drafts.chatIdOf(ctx.tenantId, id!)) !== String(ctx.chat!.id) ||
        stored.draft.extras['show']
      )
        return ctx.reply(texts.showSelectionErrorText);
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
