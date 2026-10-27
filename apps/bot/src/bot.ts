import { createDraft, DraftLimitError, maxDraftPhotos, transitionDraft } from '@handmake/core';
import type { Draft } from '@handmake/core';
import { Bot } from 'grammy';

import type { TenantLookup } from './allow-list';
import type { AppContext } from './context';
import type { D1DraftStore } from './draft-store';
import type { BotTexts } from './texts';

export interface CreateBotOptions {
  token: string;
  drafts: D1DraftStore;
  resolveTenant: TenantLookup;
  texts: BotTexts;
}

export function createBot(options: CreateBotOptions): Bot<AppContext> {
  const bot = new Bot<AppContext>(options.token);
  const { texts } = options;

  // Allow-list gate: runs before every handler. Unknown senders get the
  // refusal and the middleware chain stops — no tenant, no DB access.
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    const tenantId = userId === undefined ? undefined : options.resolveTenant(userId);
    if (tenantId === undefined) {
      if (ctx.chat) {
        await ctx.reply(texts.refusalText);
      }
      return;
    }
    ctx.tenantId = tenantId;
    ctx.drafts = options.drafts;
    await next();
  });

  bot.command('start', async (ctx) => {
    await ctx.reply(texts.startText);
  });

  bot.command('new', async (ctx) => {
    const existing = await ctx.drafts.findCollectingForChat(ctx.tenantId, chatId(ctx));
    if (existing) {
      await ctx.reply(texts.draftExistsText(existing.photoRefs.length));
      return;
    }
    const draft = createDraft(ctx.tenantId, crypto.randomUUID(), new Date());
    await ctx.drafts.create(draft, chatId(ctx));
    await ctx.reply(texts.draftCreatedText(draft.photoRefs.length));
  });

  bot.command('discard', async (ctx) => {
    const existing = await ctx.drafts.findCollectingForChat(ctx.tenantId, chatId(ctx));
    if (!existing) {
      await ctx.reply(texts.discardNothingText);
      return;
    }
    await ctx.drafts.delete(existing.tenantId, existing.draftId);
    await ctx.reply(texts.discardDoneText);
  });

  // Everything else: one switch on the message content. Texts starting with
  // "/" are commands; known ones were answered above, unknown ones get a
  // short help line here.
  bot.on('message', async (ctx) => {
    const message = ctx.msg;
    if (!message) {
      return;
    }
    if ('photo' in message && message.photo) {
      await collectPhoto(ctx, message.photo, message.caption);
      return;
    }
    if ('document' in message && message.document) {
      await collectDocument(ctx, message.document);
      return;
    }
    if ('text' in message && message.text) {
      if (message.text.startsWith('/')) {
        await ctx.reply(texts.unknownCommandText);
        return;
      }
      await collectText(ctx, message.text);
      return;
    }
    await ctx.reply(texts.unsupportedMessageText);
  });

  return bot;

  async function collectText(ctx: AppContext, text: string): Promise<void> {
    const draft = await openDraft(ctx);
    const updated = transitionDraft(draft, { type: 'addText', text }, new Date());
    await ctx.drafts.save(updated);
    await ctx.reply(texts.textSavedText(updated.photoRefs.length));
  }

  async function collectPhoto(
    ctx: AppContext,
    photos: NonNullable<NonNullable<AppContext['msg']>['photo']>,
    caption: string | undefined,
  ): Promise<void> {
    // Telegram sends each photo in several sizes, ascending; the last one
    // is the largest. We keep the file_id only (architecture 4.1).
    const largest = photos.at(-1);
    if (!largest) {
      throw new Error('photo message carries no photo sizes');
    }
    const fileId = largest.file_id;
    const draft = await openDraft(ctx);
    try {
      let updated = transitionDraft(draft, { type: 'addPhoto', fileId }, new Date());
      if (caption) {
        updated = transitionDraft(updated, { type: 'addText', text: caption }, new Date());
      }
      await ctx.drafts.save(updated);
      await ctx.reply(texts.photoSavedText(updated.photoRefs.length));
    } catch (error) {
      if (error instanceof DraftLimitError) {
        await ctx.reply(texts.photoLimitText(maxDraftPhotos));
        return;
      }
      throw error;
    }
  }

  async function collectDocument(
    ctx: AppContext,
    document: NonNullable<NonNullable<AppContext['msg']>['document']>,
  ): Promise<void> {
    // Sent-as-document photos arrive unmodified. Only JPEG/PNG go through —
    // HEIC and friends are refused with a clear explanation (review note):
    // the publisher pipeline re-encodes to JPEG and cannot read them.
    if (document.mime_type !== 'image/jpeg' && document.mime_type !== 'image/png') {
      await ctx.reply(texts.unsupportedFileText(document.file_name ?? 'без назви'));
      return;
    }
    const draft = await openDraft(ctx);
    try {
      const updated = transitionDraft(
        draft,
        { type: 'addPhoto', fileId: document.file_id },
        new Date(),
      );
      await ctx.drafts.save(updated);
      await ctx.reply(texts.photoSavedText(updated.photoRefs.length));
    } catch (error) {
      if (error instanceof DraftLimitError) {
        await ctx.reply(texts.photoLimitText(maxDraftPhotos));
        return;
      }
      throw error;
    }
  }

  /** The collecting draft for this chat, creating it on first content. */
  async function openDraft(ctx: AppContext): Promise<Draft> {
    const existing = await ctx.drafts.findCollectingForChat(ctx.tenantId, chatId(ctx));
    if (existing) {
      return existing;
    }
    const draft = createDraft(ctx.tenantId, crypto.randomUUID(), new Date());
    await ctx.drafts.create(draft, chatId(ctx));
    return draft;
  }
}

function chatId(ctx: AppContext): string {
  if (!ctx.chat) {
    throw new Error('message update has no chat');
  }
  return String(ctx.chat.id);
}
