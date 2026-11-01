import { isUlid, readWorkDraftData, workKindSchema } from '@handmake/core';
import type { CollectionReader, TextGenerator, Work, WorkDraftConfig } from '@handmake/core';
import type { Bot } from 'grammy';

import type { CreateBotOptions } from './bot';
import type { AppContext } from './context';
import type { StoredDraft } from './draft-store';
import { buildPreview } from './preview';
import type { TenantConfigSource } from './tenant-config-source';
import { createWorkDraftFlow } from './work-draft-flow';

export interface WorkSessionOptions {
  collections: CollectionReader;
  configs: TenantConfigSource;
  textGeneratorFor: (tenantId: string, workId: string) => Promise<TextGenerator>;
}
type Menu = { kind: Work['kind']; slugs: string[]; version: number; creating?: boolean };

/** Mounted after the allow-list gate; only work setup callbacks/messages are consumed here. */
export function registerWorkSession(bot: Bot<AppContext>, options: CreateBotOptions) {
  const { texts, drafts } = options;
  const settings = options.work;
  const replyPreview = async (ctx: AppContext, stored: StoredDraft) => {
    const preview = buildPreview(stored.draft, texts);
    await ctx.reply(preview.text, { reply_markup: preview.keyboard! });
  };
  const flow =
    settings && createWorkDraftFlow({ drafts, textGeneratorFor: settings.textGeneratorFor });
  const configFor = async (tenantId: string) => {
    const config = await settings!.configs.load(tenantId);
    if (config.id !== tenantId) throw new Error('tenant config mismatch');
    return config;
  };
  const saveMenu = (stored: StoredDraft, menu: Menu) =>
    drafts.updateWork(
      {
        ...stored.draft,
        extras: { ...stored.draft.extras, workMenu: menu },
        updatedAt: new Date().toISOString(),
      },
      stored.version,
    );
  const configure = async (stored: StoredDraft, config: WorkDraftConfig, title: string) => {
    const menu = stored.draft.extras['workMenu'] as Menu;
    const snapshot = {
      ...stored,
      draft: {
        ...stored.draft,
        extras: {
          ...stored.draft.extras,
          workMenu: { ...menu, creating: false },
          workCollectionTitle: title,
        },
      },
    };
    if (!(await flow!.configure(snapshot, config))) throw new Error('work configuration changed');
  };
  bot.command('work', async (ctx) => {
    if (!settings) return ctx.reply(texts.workUnavailableText);
    const chat = String(ctx.chat.id);
    const session = await drafts.getChatSession(ctx.tenantId, chat);
    const active =
      session?.kind === 'work' && session.draftId
        ? await drafts.get(ctx.tenantId, session.draftId)
        : undefined;
    const stored =
      active && active.draft.state !== 'published'
        ? active
        : await drafts.getOrCreateCollecting(ctx.tenantId, chat, 'work', new Date());
    await drafts.setChatSession(
      ctx.tenantId,
      chat,
      { kind: 'work', draftId: stored.draft.draftId },
      new Date(),
    );
    if (stored.draft.state === 'ready') return replyPreview(ctx, stored);
    if (stored.draft.state !== 'collecting')
      return ctx.reply(
        readWorkDraftData(stored.draft).uaPending ? texts.workUncertainText : texts.workRetryText,
      );
    await ctx.reply(texts.workSetupText, {
      reply_markup: {
        inline_keyboard: Object.entries(texts.workKinds).map(([kind, text]) => [
          { text, callback_data: `work:${stored.draft.draftId}:kind:${kind}` },
        ]),
      },
    });
  });
  bot.on('callback_query:data', async (ctx, next) => {
    if (!ctx.callbackQuery.data.startsWith('work:')) return next();
    await ctx.answerCallbackQuery();
    const [, id, action, value] = ctx.callbackQuery.data.split(':');
    const stored = id && isUlid(id) ? await drafts.get(ctx.tenantId, id) : undefined;
    if (!settings || !stored || stored.draft.kind !== 'work') return ctx.reply(texts.draftNoneText);
    try {
      if (
        action === 'announce' &&
        stored.draft.state === 'ready' &&
        (value === 'yes' || value === 'no')
      ) {
        const data = readWorkDraftData(stored.draft);
        const config = await configFor(ctx.tenantId);
        await configure(
          stored,
          { ...data.config, channels: value === 'yes' ? Object.keys(config.channels) : [] },
          String(stored.draft.extras['workCollectionTitle'] ?? ''),
        );
        return replyPreview(ctx, (await drafts.get(ctx.tenantId, id!))!);
      }
      if (stored.draft.state !== 'collecting') return ctx.reply(texts.draftBusyText);
      if (action === 'kind') {
        const kind = workKindSchema.parse(value);
        const collections = (await settings.collections.listCollections(ctx.tenantId)).filter(
          (c) => c.tenant === ctx.tenantId,
        );
        const menu = { kind, slugs: collections.map((c) => c.slug), version: stored.version + 1 };
        if (!(await saveMenu(stored, menu))) throw new Error('work changed');
        const buttons = collections.map((c, index) => [
          {
            text: Object.values(c.versions)[0]!.title.slice(0, 60),
            callback_data: `work:${id}:pick:${menu.version}.${index}`,
          },
        ]);
        buttons.push([
          { text: texts.workCreateButton, callback_data: `work:${id}:new:${menu.version}` },
        ]);
        return ctx.reply(texts.workCollectionsText, { reply_markup: { inline_keyboard: buttons } });
      }
      const menu = stored.draft.extras['workMenu'] as Menu | undefined;
      const [version, index] = (value ?? '').split('.').map(Number);
      if (!menu || version !== menu.version) throw new Error('stale collection menu');
      if (action === 'new') {
        if (!(await saveMenu(stored, { ...menu, creating: true }))) throw new Error('work changed');
        await drafts.setChatSession(
          ctx.tenantId,
          String(ctx.chat!.id),
          { kind: 'work', draftId: id! },
          new Date(),
        );
        return ctx.reply(texts.workFormText((await configFor(ctx.tenantId)).languages));
      }
      if (action !== 'pick' || !Number.isInteger(index) || index! < 0)
        throw new Error('invalid selection');
      const collection = (await settings.collections.listCollections(ctx.tenantId)).find(
        (c) => c.slug === menu.slugs[index!],
      );
      if (!collection || collection.tenant !== ctx.tenantId) throw new Error('collection absent');
      const { languages } = await configFor(ctx.tenantId);
      if (
        Object.keys(collection.versions).length !== languages.length ||
        languages.some((lang) => !collection.versions[lang])
      )
        throw new Error('collection languages mismatch');
      await configure(
        stored,
        { kind: menu.kind, collection: collection.slug, channels: [] },
        Object.values(collection.versions)[0]!.title,
      );
      await ctx.reply(texts.workConfiguredText);
    } catch {
      await ctx.reply(texts.workSetupErrorText);
    }
  });
  bot.on('message:text', async (ctx, next) => {
    if (!settings || ctx.msg.text.startsWith('/')) return next();
    const session = await drafts.getChatSession(ctx.tenantId, String(ctx.chat.id));
    const stored =
      session?.kind === 'work' && session.draftId
        ? await drafts.get(ctx.tenantId, session.draftId)
        : undefined;
    const menu = stored?.draft.extras['workMenu'] as Menu | undefined;
    if (
      !stored ||
      stored.draft.state !== 'collecting' ||
      !menu?.creating ||
      (await drafts.findPendingEditForChat(ctx.tenantId, String(ctx.chat.id)))
    )
      return next();
    try {
      const { languages } = await configFor(ctx.tenantId);
      const fields = ctx.msg.text.split('\n');
      if (fields.length !== languages.length * 2 || fields.some((field) => !field.trim()))
        return ctx.reply(texts.workFormText(languages));
      const versions = Object.fromEntries(
        languages.map((lang, i) => [
          lang,
          { title: fields[i * 2]!, description: fields[i * 2 + 1]!, provenance: 'human' as const },
        ]),
      );
      await configure(
        stored,
        {
          kind: menu.kind,
          collection: `collection-${stored.draft.draftId.toLowerCase()}`,
          channels: [],
          newCollection: { order: 0, versions },
        },
        fields[0]!,
      );
      await ctx.reply(texts.workConfiguredText);
    } catch {
      await ctx.reply(texts.workSetupErrorText);
    }
  });
  return {
    async generate(ctx: AppContext, stored: StoredDraft, regenerate = false) {
      if (!flow) return ctx.reply(texts.workUnavailableText);
      try {
        const data = readWorkDraftData(stored.draft);
        const menu = stored.draft.extras['workMenu'] as Menu | undefined;
        if (menu?.creating || (menu && menu.kind !== data.config.kind))
          return ctx.reply(texts.workSetupText + ' /work');
        if (data.uaPending) return ctx.reply(texts.workUncertainText);
      } catch {
        return ctx.reply(texts.workSetupText + ' /work');
      }
      if (!stored.draft.photoRefs.length) return ctx.reply(texts.workNeedsPhotosText);
      if (!stored.draft.texts['uk']?.trim()) return ctx.reply(texts.doneNeedsText);
      const chat = String(ctx.chat!.id);
      await ctx.reply(texts.workGeneratingText);
      options.background(async () => {
        try {
          if (!(await flow.generate(ctx.tenantId, stored.draft.draftId, regenerate))) {
            await bot.api.sendMessage(chat, texts.draftBusyText);
            return;
          }
          const fresh = await drafts.get(ctx.tenantId, stored.draft.draftId);
          if (fresh) {
            const preview = buildPreview(fresh.draft, texts);
            await bot.api.sendMessage(chat, preview.text, { reply_markup: preview.keyboard! });
          }
        } catch {
          const fresh = await drafts.get(ctx.tenantId, stored.draft.draftId);
          if (fresh)
            await bot.api.sendMessage(
              chat,
              readWorkDraftData(fresh.draft).uaPending
                ? texts.workUncertainText
                : texts.workRetryText,
            );
        }
      });
    },
  };
}
