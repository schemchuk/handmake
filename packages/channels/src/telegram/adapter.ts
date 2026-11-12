import { ChannelEditRejectedError } from '@handmake/core';
import type {
  ChannelAdapter,
  DeliverContext,
  DeliverProgress,
  PollResult,
  Post,
  Show,
  ShowRenderContext,
  RemoteId,
  SendOperation,
} from '@handmake/core';

import {
  renderTelegram,
  renderTelegramShow,
  telegramCapabilities,
  type TelegramChannelSettings,
} from './render';

export interface TelegramAdapterOptions {
  /** Bot token. Stored privately; never logged or included in errors. */
  token: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests; defaults to `https://api.telegram.org`. */
  apiBase?: string;
  /** Injectable for tests; defaults to a real `setTimeout` sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Per-op attempts; a 429 consumes one attempt per retry. Default 3. */
  maxAttempts?: number;
}

const DEFAULT_API_BASE = 'https://api.telegram.org';
const DEFAULT_MAX_ATTEMPTS = 3;

const DEFAULT_SLEEP = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class TelegramAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TelegramAdapterError';
  }
}

/** Internal: a 429 with `retry_after`, to be retried by the per-op loop. */
class TelegramRateLimitError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs: number,
  ) {
    super(message);
    this.name = 'TelegramRateLimitError';
  }
}

interface TelegramErrorBody {
  ok?: boolean;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
  result?: unknown;
}

/**
 * Validates the tenant's per-channel settings. `channelId` is a secret NAME
 * resolving to the chat id; `languages` optionally carries the tenant's
 * language order for `render`.
 */
export function parseTelegramChannelSettings(settings: unknown): TelegramChannelSettings {
  if (typeof settings !== 'object' || settings === null) {
    throw new TelegramAdapterError('Telegram settings must be an object with a channelId');
  }
  const candidate = settings as { channelId?: unknown; languages?: unknown };
  if (typeof candidate.channelId !== 'string' || candidate.channelId.length === 0) {
    throw new TelegramAdapterError('Telegram settings.channelId must be a non-empty string');
  }
  if (
    candidate.languages !== undefined &&
    (!Array.isArray(candidate.languages) ||
      candidate.languages.some((lang) => typeof lang !== 'string'))
  ) {
    throw new TelegramAdapterError('Telegram settings.languages must be an array of strings');
  }
  return settings as TelegramChannelSettings;
}

/**
 * Telegram ChannelAdapter (T07): `render` delegates to renderTelegram;
 * `deliver` talks to the Bot API directly. Telegram has no native
 * idempotency keys, so the ledger-driven resume (`progress.startAt` /
 * `progress.knownIds`, persisted by the caller between ops via
 * `onDelivered`) IS the idempotency mechanism — re-running CI resumes
 * where the ledger says, never re-sending a recorded op. The bot token is
 * never logged and never appears in error messages (fetch failures are
 * reported without the request URL, which embeds the token). Poll ops go
 * through `sendPoll` in the normal op loop; `closePoll` is the one channel
 * action the Worker performs itself (ADR 008).
 */
export class TelegramAdapter implements ChannelAdapter {
  readonly key = 'telegram';
  readonly capabilities = telegramCapabilities;

  readonly #token: string;
  readonly #fetch: typeof fetch;
  readonly #apiBase: string;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #maxAttempts: number;

  constructor({ token, fetchImpl, apiBase, sleep, maxAttempts }: TelegramAdapterOptions) {
    this.#token = token;
    this.#fetch = fetchImpl ?? fetch;
    this.#apiBase = apiBase ?? DEFAULT_API_BASE;
    this.#sleep = sleep ?? DEFAULT_SLEEP;
    this.#maxAttempts = maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  }

  render(post: Post, settings: unknown): SendOperation[] {
    return renderTelegram(post, settings);
  }

  renderShow(show: Show, context: ShowRenderContext): SendOperation[] {
    return renderTelegramShow(show, context);
  }

  async deliver(
    ops: SendOperation[],
    ctx: DeliverContext,
    progress?: DeliverProgress,
  ): Promise<RemoteId[]> {
    const settings = parseTelegramChannelSettings(ctx.settings);
    const chatId = await ctx.secrets.resolve(settings.channelId);
    if (chatId.length === 0) {
      throw new TelegramAdapterError(`secret "${settings.channelId}" resolved to an empty chat id`);
    }

    const start = progress?.startAt ?? 0;
    const known = progress?.knownIds ?? [];
    // Ledger invariant: knownIds is the exact delivered prefix.
    if (!Number.isInteger(start) || start < 0 || start > ops.length || known.length !== start) {
      throw new TelegramAdapterError(
        `invalid progress: startAt ${start} with ${known.length} known ids for ${ops.length} ops`,
      );
    }

    // Check required media before sending any part of the remaining batch.
    for (let index = start; index < ops.length; index++) {
      const op = ops[index]!;
      if (
        op.replyToOp !== undefined &&
        (!Number.isInteger(op.replyToOp) || op.replyToOp < 0 || op.replyToOp >= index)
      ) {
        throw new TelegramAdapterError(
          `replyToOp ${op.replyToOp} must reference an earlier operation`,
        );
      }
      if (op.kind === 'mediaGroup') {
        if (op.photoIndexes.length === 0)
          throw new TelegramAdapterError('mediaGroup op has no photos to send');
        for (const photoIndex of op.photoIndexes) {
          if (!Number.isInteger(photoIndex) || !ctx.photos[photoIndex]?.length) {
            throw new TelegramAdapterError(`op references missing photo at index ${photoIndex}`);
          }
        }
      }
      if (op.kind === 'video' && (!ctx.video || ctx.video.length === 0)) {
        throw new TelegramAdapterError('video op requires video bytes');
      }
    }
    const ids: RemoteId[] = [...known];
    for (let i = start; i < ops.length; i++) {
      const op = ops[i]!;
      const remoteId = await this.#sendWithRetry(op, chatId, ctx.photos, ids, ctx.video);
      ids.push(remoteId);
      // Awaited BEFORE the next send, so the caller persists the ledger
      // between ops and the at-least-once window is a single op.
      await progress?.onDelivered(i, remoteId);
    }
    return ids;
  }

  /** Edit only the recorded target; media bytes and reply links are never sent again. */
  async editMessage(
    messageId: RemoteId,
    op: SendOperation,
    ctx: Pick<DeliverContext, 'settings' | 'secrets'>,
  ): Promise<void> {
    if (op.kind !== 'message' && op.kind !== 'mediaGroup') {
      throw new TelegramAdapterError('Telegram edit does not support this operation kind');
    }
    if (!/^[1-9]\d*$/.test(String(messageId)) || !Number.isSafeInteger(Number(messageId))) {
      throw new TelegramAdapterError('Telegram edit requires a valid message id');
    }
    let chatId: string;
    try {
      const settings = parseTelegramChannelSettings(ctx.settings);
      chatId = await ctx.secrets.resolve(settings.channelId);
      if (!chatId.length) throw new Error();
    } catch {
      throw new TelegramAdapterError('Telegram edit destination resolution failed');
    }
    const method = op.kind === 'message' ? 'editMessageText' : 'editMessageCaption';
    const body = {
      chat_id: chatId,
      message_id: messageId,
      ...(op.kind === 'message'
        ? { text: op.text, link_preview_options: { is_disabled: true } }
        : { caption: op.caption ?? '' }),
    };
    try {
      await this.#withRetry(() => this.#call(method, body, true));
    } catch (error) {
      if (error instanceof TelegramRateLimitError)
        throw new ChannelEditRejectedError(error.message);
      throw error;
    }
  }

  /**
   * Close a poll via `stopPoll` and return its counts (T21, ADR 008: the
   * Worker closes the work-of-the-week poll; results are anonymous voter
   * counts only). Repeated stops are not guaranteed to return counts; callers
   * must persist the result and treat interrupted stops as unreadable.
   */
  async closePoll(pollId: RemoteId, ctx: DeliverContext): Promise<PollResult> {
    const settings = parseTelegramChannelSettings(ctx.settings);
    const chatId = await ctx.secrets.resolve(settings.channelId);
    if (chatId.length === 0) {
      throw new TelegramAdapterError(`secret "${settings.channelId}" resolved to an empty chat id`);
    }

    const result = (await this.#call('stopPoll', {
      chat_id: chatId,
      message_id: pollId,
    })) as { options?: unknown; total_voter_count?: unknown };
    if (
      typeof result !== 'object' ||
      result === null ||
      !Array.isArray(result.options) ||
      result.options.some(
        (option) =>
          typeof option !== 'object' ||
          option === null ||
          typeof (option as { voter_count?: unknown }).voter_count !== 'number',
      ) ||
      typeof result.total_voter_count !== 'number'
    ) {
      throw new TelegramAdapterError('Telegram stopPoll returned a malformed result');
    }
    const options = result.options as { voter_count: number }[];
    return {
      optionVotes: options.map((option) => option.voter_count),
      totalVotes: result.total_voter_count,
    };
  }

  /**
   * One op, with 429 retries. Deliberately ONLY 429 is retried: a network
   * error after Telegram accepted a message is NOT retried (the send may
   * have landed; retrying blindly could duplicate a post) — the
   * ledger-driven re-run covers it. 5xx is left to the re-run as well.
   */
  async #sendWithRetry(
    op: SendOperation,
    chatId: string,
    photos: Uint8Array[],
    deliveredIds: RemoteId[],
    video?: Uint8Array,
  ): Promise<RemoteId> {
    return this.#withRetry(() => this.#sendOnce(op, chatId, photos, deliveredIds, video));
  }

  async #withRetry<T>(action: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await action();
      } catch (error) {
        if (error instanceof TelegramRateLimitError && attempt < this.#maxAttempts) {
          await this.#sleep(error.retryAfterMs);
          continue;
        }
        throw error;
      }
    }
  }

  async #sendOnce(
    op: SendOperation,
    chatId: string,
    photos: Uint8Array[],
    deliveredIds: RemoteId[],
    video?: Uint8Array,
  ): Promise<RemoteId> {
    const replyParameters = this.#replyParameters(op, deliveredIds);
    if (op.kind === 'video') {
      if (!video?.length) throw new TelegramAdapterError('video op requires video bytes');
      const form = new FormData();
      form.set('chat_id', chatId);
      form.set('video', new Blob([video], { type: 'video/mp4' }), 'video.mp4');
      if (replyParameters) form.set('reply_parameters', JSON.stringify(replyParameters));
      const result = (await this.#call('sendVideo', form)) as { message_id?: unknown };
      if (typeof result.message_id !== 'number') {
        throw new TelegramAdapterError('Telegram sendVideo returned a malformed result');
      }
      return result.message_id;
    }
    if (op.kind === 'poll') {
      const result = (await this.#call('sendPoll', {
        chat_id: chatId,
        question: op.question,
        // Bot API: Array of InputPollOption; plain strings are an
        // undocumented legacy form.
        options: op.options.map((text) => ({ text })),
        is_anonymous: true,
        ...(replyParameters && { reply_parameters: replyParameters }),
      })) as { message_id?: unknown };
      if (typeof result.message_id !== 'number') {
        throw new TelegramAdapterError('Telegram sendPoll returned a malformed result');
      }
      return result.message_id;
    }
    if (op.kind === 'mediaGroup') {
      // The Bot API requires 2–10 items in sendMediaGroup; a single photo
      // goes through sendPhoto instead (same op shape from render). render
      // never emits an empty album, but the port allows any op — guard it.
      if (op.photoIndexes.length === 0) {
        throw new TelegramAdapterError('mediaGroup op has no photos to send');
      }
      if (op.photoIndexes.length === 1) {
        const form = this.#photoForm(op, chatId, photos, replyParameters);
        const result = (await this.#call('sendPhoto', form)) as { message_id?: unknown };
        if (typeof result.message_id !== 'number') {
          throw new TelegramAdapterError('Telegram sendPhoto returned a malformed result');
        }
        return result.message_id;
      }
      const form = this.#mediaGroupForm(op, chatId, photos, replyParameters);
      const result = (await this.#call('sendMediaGroup', form)) as unknown;
      if (!Array.isArray(result) || typeof result[0]?.message_id !== 'number') {
        throw new TelegramAdapterError('Telegram sendMediaGroup returned a malformed result');
      }
      return result[0].message_id;
    }
    const result = (await this.#call('sendMessage', {
      chat_id: chatId,
      text: op.text,
      // Never render a web-page card: it would replace the join link's
      // preview with the canonical site page (PR #89 review). Links stay
      // plain links.
      link_preview_options: { is_disabled: true },
      ...(replyParameters && { reply_parameters: replyParameters }),
    })) as { message_id?: unknown };
    if (typeof result.message_id !== 'number') {
      throw new TelegramAdapterError('Telegram sendMessage returned a malformed result');
    }
    return result.message_id;
  }

  /**
   * Resolves `replyToOp` ONLY from already-delivered ids (earlier in this
   * run or the known prefix) — never from a not-yet-sent op.
   */
  #replyParameters(
    op: SendOperation,
    deliveredIds: RemoteId[],
  ): { message_id: RemoteId } | undefined {
    if (op.replyToOp === undefined) return undefined;
    const remoteId = deliveredIds[op.replyToOp];
    if (remoteId === undefined) {
      throw new TelegramAdapterError(
        `op with replyToOp ${op.replyToOp} cannot be sent before that op is delivered`,
      );
    }
    return { message_id: remoteId };
  }

  /** Single-photo variant of #mediaGroupForm (the Bot API forbids 1-item albums). */
  #photoForm(
    op: Extract<SendOperation, { kind: 'mediaGroup' }>,
    chatId: string,
    photos: Uint8Array[],
    replyParameters: { message_id: RemoteId } | undefined,
  ): FormData {
    const photoIndex = op.photoIndexes[0]!;
    const bytes = photos[photoIndex];
    if (bytes === undefined) {
      throw new TelegramAdapterError(`op references missing photo at index ${photoIndex}`);
    }
    const form = new FormData();
    form.set('chat_id', chatId);
    form.set('photo', photoBlob(bytes), `photo0.${photoExtension(bytes)}`);
    if (op.caption !== undefined) form.set('caption', op.caption);
    if (replyParameters) {
      form.set('reply_parameters', JSON.stringify(replyParameters));
    }
    return form;
  }

  #mediaGroupForm(
    op: Extract<SendOperation, { kind: 'mediaGroup' }>,
    chatId: string,
    photos: Uint8Array[],
    replyParameters: { message_id: RemoteId } | undefined,
  ): FormData {
    const form = new FormData();
    form.set('chat_id', chatId);
    const media = op.photoIndexes.map((photoIndex, i) => {
      const bytes = photos[photoIndex];
      if (bytes === undefined) {
        throw new TelegramAdapterError(`op references missing photo at index ${photoIndex}`);
      }
      form.set(`media${i}`, photoBlob(bytes), `photo${i}.${photoExtension(bytes)}`);
      const item: Record<string, unknown> = { type: 'photo', media: `attach://media${i}` };
      // The caption goes on the FIRST item only; captionLang stays off
      // the wire format.
      if (i === 0 && op.caption !== undefined) item.caption = op.caption;
      return item;
    });
    form.set('media', JSON.stringify(media));
    if (replyParameters) {
      // Bot API >= 7.0 supports reply_parameters on sendMediaGroup.
      form.set('reply_parameters', JSON.stringify(replyParameters));
    }
    return form;
  }

  /**
   * One Bot API POST. Throws TelegramRateLimitError on 429 (with
   * `retry_after`), TelegramAdapterError otherwise. The request URL embeds
   * the token, so it is never included in error messages.
   */
  async #call(
    method: string,
    body: FormData | Record<string, unknown>,
    editing = false,
  ): Promise<unknown> {
    const url = `${this.#apiBase}/bot${this.#token}/${method}`;
    const init: RequestInit =
      body instanceof FormData
        ? { method: 'POST', body }
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          };
    if (method === 'stopPoll' || editing) init.signal = AbortSignal.timeout(30_000);

    let response: Response;
    try {
      response = await this.#fetch(url, init);
    } catch (cause) {
      throw new TelegramAdapterError(
        editing
          ? `Telegram ${method} request failed`
          : `Telegram ${method} request failed: ${(cause as Error).message}`,
      );
    }

    let parsed: TelegramErrorBody;
    try {
      parsed = (await response.json()) as TelegramErrorBody;
    } catch {
      if (!response.ok) {
        throw new TelegramAdapterError(`Telegram ${method} failed: HTTP ${response.status}`);
      }
      throw new TelegramAdapterError(`Telegram ${method} returned malformed JSON`);
    }

    if (response.ok && parsed.ok === true) {
      return parsed.result ?? {};
    }

    const description = typeof parsed.description === 'string' ? parsed.description : undefined;
    if (
      editing &&
      (response.status === 400 || parsed.error_code === 400) &&
      description?.startsWith('Bad Request: message is not modified')
    )
      return {};
    const retryAfter = parsed.parameters?.retry_after;
    if (
      (response.status === 429 || parsed.error_code === 429) &&
      typeof retryAfter === 'number' &&
      Number.isFinite(retryAfter) &&
      retryAfter >= 0 &&
      retryAfter <= 300
    ) {
      throw new TelegramRateLimitError(
        `Telegram ${method} rate limited: ${editing ? 'Too Many Requests' : (description ?? 'Too Many Requests')}`,
        retryAfter * 1000,
      );
    }
    if (editing && parsed.ok === false && response.status >= 400 && response.status < 500)
      throw new ChannelEditRejectedError(`Telegram ${method} failed: HTTP ${response.status}`);
    throw new TelegramAdapterError(
      `Telegram ${method} failed: ${editing ? `HTTP ${response.status}` : (description ?? `HTTP ${response.status}`)}`,
    );
  }
}

export function createTelegramAdapter(options: TelegramAdapterOptions): TelegramAdapter {
  return new TelegramAdapter(options);
}

function photoExtension(bytes: Uint8Array): string {
  return bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 ? 'png' : 'jpg';
}
function photoBlob(bytes: Uint8Array): Blob {
  return new Blob([bytes], { type: photoExtension(bytes) === 'png' ? 'image/png' : 'image/jpeg' });
}
