import { isUlid, maxDraftPhotos, pollSchema } from '@handmake/core';
import type { Draft, PostPoll, PublishJob, PublishRunner, Translator } from '@handmake/core';
import { Bot } from 'grammy';

import type { TenantLookup } from './allow-list';
import type { AppContext } from './context';
import type {
  ChatSession,
  D1DraftStore,
  DraftEditTarget,
  StoredDraft,
} from './draft-store';
import { publishingStaleMs, translationStaleMs } from './draft-store';
import { buildPreview } from './preview';
import type { BotTexts } from './texts';

export interface CreateBotOptions {
  token: string;
  drafts: D1DraftStore;
  resolveTenant: TenantLookup;
  texts: BotTexts;
  translator: Translator;
  /** Dispatches an approved draft to the publish pipeline (T16). */
  publishRunner: PublishRunner;
  /**
   * Defers work past the webhook response (Cloudflare ExecutionContext
   * waitUntil in production; a collecting runner in tests). The AI call must
   * never run inside the handler: grammY's webhook timeout is 10 s while a
   * translation takes 10-30 s.
   */
  background: (task: () => Promise<void>) => void;
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
    const existing = await ctx.drafts.findCollectingForChat(ctx.tenantId, chatId(ctx), 'post');
    if (existing) {
      await ctx.reply(texts.draftExistsText(existing.draft.photoRefs.length));
      return;
    }
    const created = await ctx.drafts.getOrCreateCollecting(
      ctx.tenantId,
      chatId(ctx),
      'post',
      new Date(),
    );
    await setSession(ctx, { kind: 'post', draftId: created.draft.draftId });
    await ctx.reply(texts.draftCreatedText(created.draft.photoRefs.length));
  });

  bot.command('discard', async (ctx) => {
    const existing = await sessionDraft(ctx);
    if (!existing) {
      await ctx.reply(texts.discardNothingText);
      return;
    }
    if (existing.draft.state === 'publishing') {
      await ctx.reply(texts.draftBusyText);
      return;
    }
    if (existing.draft.state === 'published') {
      await ctx.reply(texts.draftFinishedText);
      return;
    }
    await ctx.drafts.delete(existing.draft.tenantId, existing.draft.draftId);
    const session = await sessionOf(ctx);
    await setSession(ctx, { kind: session.kind, draftId: null });
    await ctx.reply(texts.discardDoneText);
  });

  // /done: claim the draft for translation (one atomic statement — racing
  // presses cannot trigger two paid AI calls) and answer immediately; the
  // translation itself runs in `background`, past the webhook response.
  bot.command('done', async (ctx) => {
    const stored = await sessionDraft(ctx);
    if (!stored) {
      await ctx.reply(texts.draftNoneText);
      return;
    }
    if (stored.draft.state === 'ready') {
      await sendPreview(ctx, stored);
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
    const now = new Date();
    const claimed = await ctx.drafts.claimTranslation(
      ctx.tenantId,
      stored.draft.draftId,
      ['collecting', 'failed'],
      now,
      staleCutoff(now),
    );
    if (!claimed) {
      // Either a racing press won, or a translation is genuinely running.
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

  // Preview buttons. Every button carries its draft id and acts on exactly
  // that draft (T25): a cron-created preview can never hijack the author's
  // own draft, and an old keyboard never operates on a newer draft. Buttons
  // on pre-T25 previews carry no id and fall back to the session draft.
  bot.on('callback_query:data', async (ctx) => {
    const parsed = parseDraftCallback(ctx.callbackQuery.data);
    if (!parsed) {
      return;
    }
    await ctx.answerCallbackQuery();
    const stored =
      parsed.draftId !== undefined
        ? await ctx.drafts.get(ctx.tenantId, parsed.draftId)
        : await sessionDraft(ctx);
    if (!stored) {
      await ctx.reply(texts.draftNoneText);
      return;
    }
    // Any button on an old preview of a published draft gets the finished
    // answer — the draft is gone for editing, publishing or discarding.
    if (stored.draft.state === 'published') {
      await ctx.reply(texts.draftFinishedText);
      return;
    }

    const { action } = parsed;
    const draftId = stored.draft.draftId;

    if (action === 'edit:uk' || action === 'edit:de') {
      const target: DraftEditTarget = action === 'edit:uk' ? 'uk' : 'de';
      const armed = await ctx.drafts.setPendingEdit(
        ctx.tenantId,
        draftId,
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

    if (action === 'regen-de') {
      const now = new Date();
      const claimed = await ctx.drafts.claimTranslation(
        ctx.tenantId,
        draftId,
        ['ready'],
        now,
        staleCutoff(now),
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

    if (action === 'publish') {
      // Consent first (F10: no identifiable faces without written consent);
      // the confirm button re-reads the draft and claims it atomically.
      if (stored.draft.state !== 'ready') {
        await ctx.reply(texts.publishNotReadyText);
        return;
      }
      await ctx.reply(texts.publishConsentText, {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: texts.publishConfirmButton,
                callback_data: `draft:${draftId}:publish:confirm`,
              },
              {
                text: texts.publishCancelButton,
                callback_data: `draft:${draftId}:publish:cancel`,
              },
            ],
          ],
        },
      });
      return;
    }

    if (action === 'publish:cancel') {
      await sendPreview(ctx, stored);
      return;
    }

    if (action === 'publish:confirm') {
      // Build the job before claiming: a draft that can never be dispatched
      // (a wotw-poll without a valid poll in extras) is refused here and
      // stays ready instead of getting stuck in 'publishing'.
      let job: PublishJob;
      try {
        job = publishJobOf(stored.draft);
      } catch {
        await ctx.reply(texts.publishInvalidText);
        return;
      }
      // The guarded claim decides, not the state we just read: a fresh
      // 'publishing' row means a racing press already dispatched (back off),
      // a stale one means the background dispatch died and may be reclaimed.
      const now = new Date();
      const claimed = await ctx.drafts.claimPublishing(
        ctx.tenantId,
        draftId,
        now,
        publishingStaleCutoff(now),
      );
      if (!claimed) {
        // The callback may have landed between the read above and the claim:
        // a now-'published' draft answers "finished", not "not ready".
        const fresh = await ctx.drafts.get(ctx.tenantId, draftId);
        await ctx.reply(
          fresh?.draft.state === 'published'
            ? texts.draftFinishedText
            : fresh?.draft.state === 'publishing'
              ? texts.draftBusyText
              : texts.publishNotReadyText,
        );
        return;
      }
      await runPublish(ctx, claimed, job);
      return;
    }

    if (action === 'discard') {
      if (stored.draft.state === 'publishing') {
        await ctx.reply(texts.draftBusyText);
        return;
      }
      await ctx.drafts.delete(ctx.tenantId, draftId);
      // Drop the session pointer if it aimed at the draft just deleted.
      const session = await sessionOf(ctx);
      if (session.draftId === draftId) {
        await setSession(ctx, { kind: session.kind, draftId: null });
      }
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
   * 1. an armed reply-based edit (ADR 005) replaces that language version of
   *    the draft that armed it, wherever the session points now;
   * 2. after a failed translation of the session draft the author's own German
   *    text is taken as-is (failed -> ready);
   * 3. under a ready session draft it just re-sends the preview (nothing is
   *    collected into an approved draft);
   * 4. otherwise the text is collected into the session's collecting draft.
   * Cron-created drafts never intercept anything here: they are reachable only
   * through their own preview buttons, which carry the draft id (T25).
   */
  async function handleText(ctx: AppContext, text: string): Promise<void> {
    const pending = await ctx.drafts.findPendingEditForChat(ctx.tenantId, chatId(ctx));

    if (pending?.pendingEdit) {
      const target = pending.pendingEdit;
      const applied = await ctx.drafts.replaceText(
        ctx.tenantId,
        pending.draft.draftId,
        target,
        text,
        new Date(),
      );
      if (!applied) {
        await ctx.reply(texts.editConflictText);
        return;
      }
      await ctx.reply(texts.editSavedText(target));
      const fresh = await ctx.drafts.get(ctx.tenantId, pending.draft.draftId);
      if (fresh?.draft.state === 'ready') {
        await sendPreview(ctx, fresh);
      }
      return;
    }

    const session = await sessionOf(ctx);
    const stored =
      session.draftId !== null ? await ctx.drafts.get(ctx.tenantId, session.draftId) : undefined;

    if (stored?.draft.state === 'failed') {
      const applied = await ctx.drafts.writeGermanByHand(
        ctx.tenantId,
        stored.draft.draftId,
        text,
        new Date(),
      );
      if (!applied) {
        await ctx.reply(texts.editConflictText);
        return;
      }
      await ctx.reply(texts.deSavedText);
      const fresh = await ctx.drafts.get(ctx.tenantId, stored.draft.draftId);
      if (fresh) {
        await sendPreview(ctx, fresh);
      }
      return;
    }

    if (stored?.draft.state === 'ready') {
      await sendPreview(ctx, stored);
      return;
    }

    const appended = await appendTextToOpenDraft(ctx, session, text);
    await ctx.reply(texts.textSavedText(appended.draft.photoRefs.length));
  }

  /**
   * Schedules the claimed translation past the webhook response: the handler
   * has already answered "translating…", and everything below runs inside
   * `background` (Cloudflare waitUntil). The later messages go through
   * `bot.api`, not `ctx.reply` — the update context is finished by then.
   * Failures to notify the author are swallowed: the draft state is the
   * source of truth, /done recovers it.
   */
  async function runTranslation(ctx: AppContext, claimed: StoredDraft): Promise<void> {
    const targetChat = chatId(ctx);
    const ukText = claimed.draft.texts['uk'] ?? '';
    await ctx.reply(texts.translatingText);
    options.background(async () => {
      let german: string;
      try {
        const result = await options.translator.translate({
          text: ukText,
          sourceLang: 'uk',
          targetLang: 'de',
        });
        german = result.text;
      } catch {
        await ctx.drafts.markTranslationFailed(ctx.tenantId, claimed.draft.draftId, new Date());
        await bot.api.sendMessage(targetChat, texts.translationFailedText).catch(() => undefined);
        return;
      }
      await ctx.drafts.markTranslated(ctx.tenantId, claimed.draft.draftId, german, new Date());
      const fresh = await ctx.drafts.get(ctx.tenantId, claimed.draft.draftId);
      if (!fresh) {
        return;
      }
      const preview = buildPreview(fresh.draft, texts);
      await bot.api
        .sendMessage(
          targetChat,
          preview.text,
          preview.keyboard ? { reply_markup: preview.keyboard } : {},
        )
        .catch(() => undefined);
    });
  }

  /**
   * The draft is 'publishing' in D1 before GitHub is touched, so a double
   * press or a webhook retry can never dispatch twice (A4). The dispatch
   * runs in `background` (the API round trip must not hold the webhook);
   * on failure the draft reverts to 'ready' and the author is asked to
   * retry. On success the pipeline itself notifies the author when the
   * post is delivered (publisher notifier).
   */
  async function runPublish(ctx: AppContext, claimed: StoredDraft, job: PublishJob): Promise<void> {
    const targetChat = chatId(ctx);
    await ctx.reply(texts.publishingText);
    options.background(async () => {
      try {
        await options.publishRunner.run(job);
      } catch {
        await ctx.drafts.revertPublishing(ctx.tenantId, claimed.draft.draftId, new Date());
        await bot.api.sendMessage(targetChat, texts.publishFailedText).catch(() => undefined);
      }
    });
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
    if (await readyDraftRepliesPreview(ctx)) {
      return;
    }
    // Telegram sends each photo in several sizes, ascending; the last one
    // is the largest. We keep the file_id only (architecture 4.1).
    const largest = photos.at(-1);
    if (!largest) {
      throw new Error('photo message carries no photo sizes');
    }
    const session = await sessionOf(ctx);
    let stored = await appendPhotoToOpenDraft(ctx, session, largest.file_id);
    if (stored === 'limit') {
      await ctx.reply(texts.photoLimitText(maxDraftPhotos));
      return;
    }
    if (caption) {
      stored = await appendTextToOpenDraft(ctx, session, caption);
    }
    await ctx.reply(texts.photoSavedText(stored.draft.photoRefs.length));
  }

  async function collectDocument(
    ctx: AppContext,
    document: NonNullable<NonNullable<AppContext['msg']>['document']>,
  ): Promise<void> {
    if (await readyDraftRepliesPreview(ctx)) {
      return;
    }
    // Sent-as-document photos arrive unmodified. Only JPEG/PNG go through —
    // HEIC and friends are refused with a clear explanation (review note):
    // the publisher pipeline re-encodes to JPEG and cannot read them.
    if (document.mime_type !== 'image/jpeg' && document.mime_type !== 'image/png') {
      await ctx.reply(texts.unsupportedFileText(document.file_name ?? 'без назви'));
      return;
    }
    const stored = await appendPhotoToOpenDraft(ctx, await sessionOf(ctx), document.file_id);
    if (stored === 'limit') {
      await ctx.reply(texts.photoLimitText(maxDraftPhotos));
      return;
    }
    await ctx.reply(texts.photoSavedText(stored.draft.photoRefs.length));
  }

  /**
   * Photo (or document) under a ready session draft: mirror the text
   * behaviour (review m2) — re-show the preview with a hint instead of
   * silently forking a new collecting draft next to the approved one.
   */
  async function readyDraftRepliesPreview(ctx: AppContext): Promise<boolean> {
    const latest = await sessionDraft(ctx);
    if (latest?.draft.state !== 'ready') {
      return false;
    }
    await ctx.reply(texts.photoUnderReadyText);
    await sendPreview(ctx, latest);
    return true;
  }

  /**
   * Append one photo to the session's collecting draft and return the draft
   * as stored. The append is a single atomic D1 statement — parallel album
   * messages serialize at SQLite and cannot lose each other or bypass the
   * limit. Only a racing /discard (draft vanished) triggers one recreate
   * and retry.
   */
  async function appendPhotoToOpenDraft(
    ctx: AppContext,
    session: ChatSession,
    fileId: string,
  ): Promise<StoredDraft | 'limit'> {
    for (let attempt = 0; ; attempt++) {
      const stored = await collectingDraftOf(ctx, session);
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

  async function appendTextToOpenDraft(
    ctx: AppContext,
    session: ChatSession,
    text: string,
  ): Promise<StoredDraft> {
    for (let attempt = 0; ; attempt++) {
      const stored = await collectingDraftOf(ctx, session);
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

  /**
   * The draft new content goes to: the session's own collecting draft, or —
   * when the session has none any more (published, discarded, never started)
   * — a fresh collecting draft of the session's kind, which the session then
   * points at.
   */
  async function collectingDraftOf(ctx: AppContext, session: ChatSession): Promise<StoredDraft> {
    if (session.draftId !== null) {
      const current = await ctx.drafts.get(ctx.tenantId, session.draftId);
      if (current?.draft.state === 'collecting') {
        return current;
      }
    }
    const kind = session.kind === 'work' ? 'work' : 'post';
    const stored = await ctx.drafts.getOrCreateCollecting(
      ctx.tenantId,
      chatId(ctx),
      kind,
      new Date(),
    );
    if (session.draftId !== stored.draft.draftId) {
      await setSession(ctx, { kind: session.kind, draftId: stored.draft.draftId });
    }
    return stored;
  }

  /** The chat's session, defaulting to a post session with no draft yet. */
  async function sessionOf(ctx: AppContext): Promise<ChatSession> {
    return (
      (await ctx.drafts.getChatSession(ctx.tenantId, chatId(ctx))) ?? {
        kind: 'post',
        draftId: null,
      }
    );
  }

  /** The draft the chat's session points at, if it still exists. */
  async function sessionDraft(ctx: AppContext): Promise<StoredDraft | undefined> {
    const session = await sessionOf(ctx);
    if (session.draftId === null) {
      return undefined;
    }
    return ctx.drafts.get(ctx.tenantId, session.draftId);
  }

  async function setSession(ctx: AppContext, session: ChatSession): Promise<void> {
    await ctx.drafts.setChatSession(ctx.tenantId, chatId(ctx), session, new Date());
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

/** Cutoff for reclaiming a 'translating' draft whose background task died. */
function staleCutoff(now: Date): Date {
  return new Date(now.getTime() - translationStaleMs);
}

/** Cutoff for reclaiming a 'publishing' draft whose background dispatch died. */
function publishingStaleCutoff(now: Date): Date {
  return new Date(now.getTime() - publishingStaleMs);
}

/** Builds the dispatch job from the claimed draft; 'uk' stays the first key
 * so renderTelegram keeps Ukrainian as the album-caption language. */
function publishJobOf(draft: Draft): PublishJob {
  const texts: Record<string, string> = {};
  const uk = draft.texts['uk'];
  const de = draft.texts['de'];
  if (uk !== undefined && uk.trim() !== '') {
    texts['uk'] = uk;
  }
  if (de !== undefined && de.trim() !== '') {
    texts['de'] = de;
  }
  const job: PublishJob = {
    tenantId: draft.tenantId,
    postId: draft.draftId,
    kind: draft.kind,
    type: draft.type,
    texts,
    fileIds: draft.photoRefs,
    // The payload carries one provenance for all versions; a German version
    // exists only via the AI translator (or the author's fallback after a
    // translation failure), so 'ai-assisted' over-reports rather than hides
    // AI involvement.
    provenance: texts['de'] !== undefined ? 'ai-assisted' : 'human',
  };
  const poll = pollOf(draft);
  if (poll !== undefined) {
    job.poll = poll;
  }
  return job;
}

/** The poll spec of a wotw-poll draft, from its kind extras (written by the
 * poll cron, T30). The post type is the source of truth: extras of other
 * kinds are ignored, so a stray poll can never land on a non-poll payload.
 * A wotw-poll draft without a valid poll must never be dispatched — the
 * publisher would reject the payload anyway, but here the author gets a
 * clear error instead of a failed pipeline run. */
function pollOf(draft: Draft): PostPoll | undefined {
  if (draft.type !== 'wotw-poll') {
    return undefined;
  }
  const raw = draft.extras['poll'];
  if (raw === undefined) {
    throw new Error(`draft ${draft.draftId} is wotw-poll but has no poll in extras`);
  }
  const parsed = pollSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`draft ${draft.draftId} extras poll is invalid`);
  }
  return parsed.data;
}

/**
 * Parses preview-button callback data: `draft:<draftId>:<action>` (current
 * previews) or legacy `draft:<action>` (previews sent before T25). Actions
 * themselves may contain colons (`publish:confirm`). Returns undefined for
 * data that does not belong to a draft preview at all.
 */
function parseDraftCallback(
  data: string,
): { draftId: string | undefined; action: string } | undefined {
  if (!data.startsWith('draft:')) {
    return undefined;
  }
  const parts = data.split(':');
  if (isUlid(parts[1] ?? '')) {
    return { draftId: parts[1], action: parts.slice(2).join(':') };
  }
  return { draftId: undefined, action: parts.slice(1).join(':') };
}
