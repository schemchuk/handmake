import { maxDraftPhotos } from '@handmake/core';
import { Bot } from 'grammy';

import type { TenantLookup } from './allow-list';
import type { AppContext } from './context';
import type { D1DraftStore, StoredDraft } from './draft-store';
import type { BotTexts } from './texts';

export interface CreateBotOptions {
  token: string;
  drafts: D1DraftStore;
  resolveTenant: TenantLookup;
  texts: BotTexts;
}

/** How often an append retries when the draft vanishes mid-flight (a racing
 * /discard) before giving up. Content appends themselves are single atomic
 * D1 statements, so no other retry is needed. */
const maxVanishedRetries = 1;

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
      await ctx.reply(texts.draftExistsText(existing.draft.photoRefs.length));
      return;
    }
    const created = await ctx.drafts.getOrCreateCollecting(ctx.tenantId, chatId(ctx), new Date());
    await ctx.reply(texts.draftCreatedText(created.draft.photoRefs.length));
  });

  bot.command('discard', async (ctx) => {
    const existing = await ctx.drafts.findCollectingForChat(ctx.tenantId, chatId(ctx));
    if (!existing) {
      await ctx.reply(texts.discardNothingText);
      return;
    }
    await ctx.drafts.delete(existing.draft.tenantId, existing.draft.draftId);
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
    const stored = await appendTextToOpenDraft(ctx, text);
    await ctx.reply(texts.textSavedText(stored.draft.photoRefs.length));
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
    let stored = await appendPhotoToOpenDraft(ctx, largest.file_id);
    if (stored === 'limit') {
      await ctx.reply(texts.photoLimitText(maxDraftPhotos));
      return;
    }
    if (caption) {
      stored = await appendTextToOpenDraft(ctx, caption);
    }
    await ctx.reply(texts.photoSavedText(stored.draft.photoRefs.length));
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
    const stored = await appendPhotoToOpenDraft(ctx, document.file_id);
    if (stored === 'limit') {
      await ctx.reply(texts.photoLimitText(maxDraftPhotos));
      return;
    }
    await ctx.reply(texts.photoSavedText(stored.draft.photoRefs.length));
  }

  /**
   * Append one photo to the chat's collecting draft and return the draft as
   * stored. The append is a single atomic D1 statement — parallel album
   * messages serialize at SQLite and cannot lose each other or bypass the
   * limit. Only a racing /discard (draft vanished) triggers one recreate
   * and retry.
   */
  async function appendPhotoToOpenDraft(
    ctx: AppContext,
    fileId: string,
  ): Promise<StoredDraft | 'limit'> {
    for (let attempt = 0; ; attempt++) {
      const stored = await ctx.drafts.getOrCreateCollecting(ctx.tenantId, chatId(ctx), new Date());
      const result = await ctx.drafts.appendPhoto(
        ctx.tenantId,
        stored.draft.draftId,
        fileId,
        maxDraftPhotos,
        new Date(),
      );
      if (result === 'added') {
        return storedRefreshed(ctx, stored.draft.draftId);
      }
      if (result === 'limit') {
        return 'limit';
      }
      if (attempt >= maxVanishedRetries) {
        throw new Error('collecting draft keeps vanishing; giving up');
      }
    }
  }

  async function appendTextToOpenDraft(ctx: AppContext, text: string): Promise<StoredDraft> {
    for (let attempt = 0; ; attempt++) {
      const stored = await ctx.drafts.getOrCreateCollecting(ctx.tenantId, chatId(ctx), new Date());
      const applied = await ctx.drafts.appendText(
        ctx.tenantId,
        stored.draft.draftId,
        text,
        new Date(),
      );
      if (applied) {
        return storedRefreshed(ctx, stored.draft.draftId);
      }
      if (attempt >= maxVanishedRetries) {
        throw new Error('collecting draft keeps vanishing; giving up');
      }
    }
  }

  /** Re-read a just-written draft so replies report current counts. */
  async function storedRefreshed(ctx: AppContext, draftId: string) {
    const stored = await ctx.drafts.get(ctx.tenantId, draftId);
    if (!stored) {
      throw new Error('draft vanished right after writing it');
    }
    return stored;
  }
}

function chatId(ctx: AppContext): string {
  if (!ctx.chat) {
    throw new Error('message update has no chat');
  }
  return String(ctx.chat.id);
}
