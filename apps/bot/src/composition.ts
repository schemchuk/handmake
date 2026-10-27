import { draftRetentionDays } from '@handmake/core';
import { webhookCallback } from 'grammy';
import type { Bot } from 'grammy';

import { createTenantLookup } from './allow-list';
import { createBot } from './bot';
import type { AppContext } from './context';
import { createD1DraftStore } from './draft-store';
import type { Env } from './env';
import { createProcessedUpdateTracker, processedUpdateRetentionDays } from './processed-updates';
import type { BotTexts } from './texts';

/** Header Telegram sends when the webhook was registered with a secret token. */
export const secretTokenHeader = 'x-telegram-bot-api-secret-token';

export interface App {
  handle(request: Request): Promise<Response>;
  /** Daily cleanup: returns the number of expired drafts deleted. */
  scheduled(event: ScheduledEvent): Promise<number>;
  /** Exposed for tests; production uses only `handle`. */
  bot: Bot<AppContext>;
}

/**
 * Constant-time string comparison: no early exit, so the check does not leak
 * how much of the secret a wrong guess got right (PR #19 review note 1).
 * The length is compared up front; the string content only via the XOR loop.
 */
export function secretsEqual(expected: string, provided: string): boolean {
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(provided);
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

/** Extracts Telegram's update_id from a webhook request body (undefined if
 * the body is not a Telegram update). */
async function updateIdOf(request: Request): Promise<number | undefined> {
  const body: unknown = await request
    .clone()
    .json()
    .catch(() => undefined);
  if (
    body !== null &&
    typeof body === 'object' &&
    'update_id' in body &&
    typeof body.update_id === 'number'
  ) {
    return body.update_id;
  }
  return undefined;
}

/** Composition root: wires secrets/bindings to the bot (ADR 007). */
export function createApp(env: Env, texts: BotTexts): App {
  // The bot is built lazily so the webhook secret is checked BEFORE the
  // allow-list secret is parsed: a malformed allow-list must yield 401, not
  // 500, for unauthenticated callers (PR #19 review note 2).
  let bot: Bot<AppContext> | undefined;
  let handleUpdate: ((request: Request) => Promise<Response>) | undefined;
  function build(): (request: Request) => Promise<Response> {
    if (!handleUpdate) {
      bot = createBot({
        token: env.TELEGRAM_BOT_TOKEN,
        drafts: createD1DraftStore(env.DB),
        resolveTenant: createTenantLookup(env.TELEGRAM_ALLOWED_USER_IDS),
        texts,
      });
      handleUpdate = webhookCallback(bot, 'cloudflare-mod');
    }
    return handleUpdate;
  }

  return {
    get bot(): Bot<AppContext> {
      build();
      return bot as Bot<AppContext>;
    },

    async handle(request) {
      if (request.method !== 'POST') {
        return new Response('method not allowed', { status: 405 });
      }
      // Fail closed: a missing or empty configured secret rejects everything.
      const expected = env.TELEGRAM_WEBHOOK_SECRET;
      const provided = request.headers.get(secretTokenHeader);
      if (!expected || provided === null || !secretsEqual(expected, provided)) {
        return new Response('unauthorized', { status: 401 });
      }
      // Telegram retries a webhook delivery when our answer is lost, and a
      // re-run would append the author's content twice. Updates answered
      // successfully are recorded by update_id and exact redeliveries are
      // dropped (handled-failed updates are NOT recorded, so a genuine
      // retry after an error re-runs normally).
      const updateId = await updateIdOf(request);
      const processed = createProcessedUpdateTracker(env.DB);
      if (updateId !== undefined && (await processed.wasProcessed(updateId))) {
        return new Response('ok');
      }
      const response = await build()(request);
      if (updateId !== undefined && response.ok) {
        await processed.markProcessed(updateId);
      }
      return response;
    },

    async scheduled(event) {
      const drafts = createD1DraftStore(env.DB);
      const retentionMs = draftRetentionDays * 24 * 60 * 60 * 1000;
      const updates = createProcessedUpdateTracker(env.DB);
      const updateRetentionMs = processedUpdateRetentionDays * 24 * 60 * 60 * 1000;
      const cutoff = new Date(event.scheduledTime - retentionMs);
      await updates.deleteOlderThan(new Date(event.scheduledTime - updateRetentionMs));
      return drafts.deleteOlderThan(cutoff);
    },
  };
}
