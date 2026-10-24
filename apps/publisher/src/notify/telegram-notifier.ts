import type { Notifier, NotifyTarget } from '@handmake/core';

export interface TelegramNotifierOptions {
  /** Bot token from the secret store; never logged or sent in error text. */
  token: string;
  /** Chat id for NotifyTarget 'author'; unset target is a silent no-op. */
  authorChatId?: string;
  /** Chat id for NotifyTarget 'operator' (OPERATOR_CHAT_ID in Actions). */
  operatorChatId?: string;
  fetchImpl?: typeof fetch;
  apiBase?: string;
}

const DEFAULT_API_BASE = 'https://api.telegram.org';

/**
 * Notifier via the Telegram Bot API (T11): the publisher tells the author
 * about a successful publish and the operator about a failure. A missing
 * chat id for a target is a no-op, so partial wiring degrades gracefully.
 */
export class TelegramNotifier implements Notifier {
  readonly #token: string;
  readonly #chatIds: Record<NotifyTarget, string | undefined>;
  readonly #fetch: typeof fetch;
  readonly #apiBase: string;

  constructor(options: TelegramNotifierOptions) {
    this.#token = options.token;
    this.#chatIds = { author: options.authorChatId, operator: options.operatorChatId };
    this.#fetch = options.fetchImpl ?? fetch;
    this.#apiBase = options.apiBase ?? DEFAULT_API_BASE;
  }

  async notify(target: NotifyTarget, message: string): Promise<void> {
    const chatId = this.#chatIds[target];
    if (!chatId) return;
    const url = new URL(`${this.#apiBase}/bot${this.#token}/sendMessage`);
    const response = await this.#fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ chat_id: chatId, text: message }),
    });
    if (!response.ok) {
      // Status only: the URL carries the token and must never be quoted.
      throw new Error(`Telegram notify failed: HTTP ${response.status}`);
    }
  }
}
