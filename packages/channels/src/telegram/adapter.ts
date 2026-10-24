import type {
  ChannelAdapter,
  DeliverContext,
  DeliverProgress,
  Post,
  RemoteId,
  SendOperation,
} from '@handmake/core';

import { renderTelegram, telegramCapabilities, type TelegramChannelSettings } from './render';

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
 * reported without the request URL, which embeds the token).
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
    if (start > ops.length || known.length !== start) {
      throw new TelegramAdapterError(
        `invalid progress: startAt ${start} with ${known.length} known ids for ${ops.length} ops`,
      );
    }

    const ids: RemoteId[] = [...known];
    for (let i = start; i < ops.length; i++) {
      const op = ops[i]!;
      const remoteId = await this.#sendWithRetry(op, chatId, ctx.photos, ids);
      ids.push(remoteId);
      // Awaited BEFORE the next send, so the caller persists the ledger
      // between ops and the at-least-once window is a single op.
      await progress?.onDelivered(i, remoteId);
    }
    return ids;
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
  ): Promise<RemoteId> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.#sendOnce(op, chatId, photos, deliveredIds);
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
  ): Promise<RemoteId> {
    const replyParameters = this.#replyParameters(op, deliveredIds);
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
    form.set('photo', new Blob([bytes]), 'photo0.jpg');
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
      form.set(`media${i}`, new Blob([bytes]), `photo${i}.jpg`);
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
  async #call(method: string, body: FormData | Record<string, unknown>): Promise<unknown> {
    const url = `${this.#apiBase}/bot${this.#token}/${method}`;
    const init: RequestInit =
      body instanceof FormData
        ? { method: 'POST', body }
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          };

    let response: Response;
    try {
      response = await this.#fetch(url, init);
    } catch (cause) {
      throw new TelegramAdapterError(
        `Telegram ${method} request failed: ${(cause as Error).message}`,
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
    const retryAfter = parsed.parameters?.retry_after;
    if ((response.status === 429 || parsed.error_code === 429) && typeof retryAfter === 'number') {
      throw new TelegramRateLimitError(
        `Telegram ${method} rate limited: ${description ?? 'Too Many Requests'}`,
        retryAfter * 1000,
      );
    }
    throw new TelegramAdapterError(
      `Telegram ${method} failed: ${description ?? `HTTP ${response.status}`}`,
    );
  }
}

export function createTelegramAdapter(options: TelegramAdapterOptions): TelegramAdapter {
  return new TelegramAdapter(options);
}
