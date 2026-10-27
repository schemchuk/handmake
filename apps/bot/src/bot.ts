import { maxDraftPhotos } from '@handmake/core';
import type { Translator } from '@handmake/core';
import { Bot } from 'grammy';

import type { TenantLookup } from './allow-list';
import type { AppContext } from './context';
import type { D1DraftStore, DraftEditTarget, StoredDraft } from './draft-store';
import { buildPreview } from './preview';
import type { BotTexts } from './texts';

export interface CreateBotOptions {
  token: string;
  drafts: D1DraftStore;
  resolveTenant: TenantLookup;
  texts: BotTexts;
  translator: Translator;
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
    const existing = await ctx.drafts.latestForChat(ctx.tenantId, chatId(ctx));
    if (!existing) {
      await ctx.reply(texts.discardNothingText);
      return;
    }
    if (existing.draft.state === 'publishing') {
      await ctx.reply(texts.draftBusyText);
      return;
    }
    await ctx.drafts.delete(existing.draft.tenantId, existing.draft.draftId);
    await ctx.reply(texts.discardDoneText);
  });

  // /done: translate the Ukrainian text and show the preview. The claim is
  // one atomic D1 statement, so two racing /done presses cannot trigger two
  // (paid) AI calls — the loser is told a translation is already running.
  bot.command('done', async (ctx) => {
    const stored = await ctx.drafts.latestForChat(ctx.tenantId, chatId(ctx));
    if (!stored) {
      await ctx.reply(texts.draftNoneText);
      return;
    }
    if (stored.draft.state === 'ready') {
      await sendPreview(ctx, stored);
      return;
    }
    if (stored.draft.state === 'translating') {
      await ctx.reply(texts.translateInProgressText);
      return;
    }
    if (stored.draft.state === 'publishing' || stored.draft.state === 'published') {
      await ctx.reply(texts.draftFinishedText);
      return;
    }
    if ((stored.draft.texts['uk'] ?? '').trim() === '') {
      await ctx.reply(texts.doneNeedsText);
      return;
    }
    const claimed = await ctx.drafts.claimTranslation(
      ctx.tenantId,
      stored.draft.draftId,
      ['collecting', 'failed'],
      new Date(),
    );
    if (!claimed) {
      // The state moved under us (a racing /done or button press won).
      const fresh = await ctx.drafts.get(ctx.tenantId, stored.draft.draftId);
      if (fresh?.draft.state === 'ready') {
        await sendPreview(ctx, fresh);
      } else {
        await ctx.reply(texts.translateInProgressText);
      }
      return;
    }
    await runTranslation(ctx, claimed);
  });

  // Preview buttons. All actions re-read the latest draft — the keyboard in
  // an old preview message must not operate on stale state.
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    if (!data.startsWith('draft:')) {
      return;
    }
    await ctx.answerCallbackQuery();
    const stored = await ctx.drafts.latestForChat(ctx.tenantId, chatId(ctx));
    if (!stored) {
      await ctx.reply(texts.draftNoneText);
      return;
    }

    if (data === 'draft:edit:uk' || data === 'draft:edit:de') {
      const target: DraftEditTarget = data === 'draft:edit:uk' ? 'uk' : 'de';
      const armed = await ctx.drafts.setPendingEdit(
        ctx.tenantId,
        stored.draft.draftId,
        target,
        new Date(),
      );
      if (!armed) {
        await ctx.reply(texts.editConflictText);
        return;
      }
      const current = stored.draft.texts[target] ?? '';
      await ctx.reply(
        current === '' ? texts.editPromptNewText(target) : texts.editPromptText(target, current),
      );
      return;
    }

    if (data === 'draft:regen-de') {
      const claimed = await ctx.drafts.claimTranslation(
        ctx.tenantId,
        stored.draft.draftId,
        ['ready'],
        new Date(),
      );
      if (!claimed) {
        await ctx.reply(
          stored.draft.state === 'translating'
            ? texts.translateInProgressText
            : texts.regenUnavailableText,
        );
        return;
      }
      await runTranslation(ctx, claimed);
      return;
    }

    if (data === 'draft:publish') {
      // T16 wires actual publishing; the draft is approved and waits.
      if (stored.draft.state !== 'ready') {
        await ctx.reply(texts.regenUnavailableText);
        return;
      }
      await ctx.reply(texts.publishNotAvailableText);
      return;
    }

    if (data === 'draft:discard') {
      if (stored.draft.state === 'publishing') {
        await ctx.reply(texts.draftBusyText);
        return;
      }
      await ctx.drafts.delete(ctx.tenantId, stored.draft.draftId);
      await ctx.reply(texts.discardDoneText);
      return;
    }
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
      await handleText(ctx, message.text);
      return;
    }
    await ctx.reply(texts.unsupportedMessageText);
  });

  return bot;

  /**
   * A plain text message can mean four things, checked in this order:
   * 1. an armed reply-based edit (ADR 005) replaces that language version;
   * 2. after a failed translation the author's own German text is taken as-is
   *    (failed -> ready);
   * 3. under a ready draft it just re-sends the preview (nothing is collected
   *    into an approved draft);
   * 4. otherwise the text is collected into the collecting draft.
   */
  async function handleText(ctx: AppContext, text: string): Promise<void> {
    const latest = await ctx.drafts.latestForChat(ctx.tenantId, chatId(ctx));

    if (latest?.pendingEdit) {
      const target = latest.pendingEdit;
      const applied = await ctx.drafts.replaceText(
        ctx.tenantId,
        latest.draft.draftId,
        target,
        text,
        new Date(),
      );
      if (!applied) {
        await ctx.reply(texts.editConflictText);
        return;
      }
      await ctx.reply(texts.editSavedText(target));
      const fresh = await ctx.drafts.get(ctx.tenantId, latest.draft.draftId);
      if (fresh?.draft.state === 'ready') {
        await sendPreview(ctx, fresh);
      }
      return;
    }

    if (latest?.draft.state === 'failed') {
      const applied = await ctx.drafts.writeGermanByHand(
        ctx.tenantId,
        latest.draft.draftId,
        text,
        new Date(),
      );
      if (!applied) {
        await ctx.reply(texts.editConflictText);
        return;
      }
      await ctx.reply(texts.deSavedText);
      const fresh = await ctx.drafts.get(ctx.tenantId, latest.draft.draftId);
      if (fresh) {
        await sendPreview(ctx, fresh);
      }
      return;
    }

    if (latest?.draft.state === 'ready') {
      await sendPreview(ctx, latest);
      return;
    }

    const stored = await appendTextToOpenDraft(ctx, text);
    await ctx.reply(texts.textSavedText(stored.draft.photoRefs.length));
  }

  /**
   * Runs the claimed translation to completion: translate, then mark the
   * draft ready or failed in one guarded statement each. The AI call happens
   * only after a successful claim, so retries and double presses never pay
   * for two translations.
   */
  async function runTranslation(ctx: AppContext, claimed: StoredDraft): Promise<void> {
    const ukText = claimed.draft.texts['uk'] ?? '';
    await ctx.reply(texts.translatingText);
    try {
      const result = await options.translator.translate({
        text: ukText,
        sourceLang: 'uk',
        targetLang: 'de',
      });
      await ctx.drafts.markTranslated(ctx.tenantId, claimed.draft.draftId, result.text, new Date());
    } catch {
      await ctx.drafts.markTranslationFailed(ctx.tenantId, claimed.draft.draftId, new Date());
      await ctx.reply(texts.translationFailedText);
      return;
    }
    const fresh = await ctx.drafts.get(ctx.tenantId, claimed.draft.draftId);
    if (fresh) {
      await sendPreview(ctx, fresh);
    }
  }

  /** Sends the author the rendered preview with its action keyboard. */
  async function sendPreview(ctx: AppContext, stored: StoredDraft): Promise<void> {
    const preview = buildPreview(stored.draft, texts);
    await ctx.reply(preview.text, preview.keyboard ? { reply_markup: preview.keyboard } : {});
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
