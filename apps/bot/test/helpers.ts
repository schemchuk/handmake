import type { Bot } from 'grammy';
import type { Update } from 'grammy/types';
import { vi } from 'vitest';

import type { AppContext } from '../src/context';

export interface SentCall {
  method: string;
  payload: Record<string, unknown>;
}

/** Builds a private-text-message update, like Telegram sends to the webhook. */
export function textUpdate(userId: number | undefined, text: string): Update {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      date: 1_700_000_000,
      from: userId === undefined ? undefined : { id: userId, is_bot: false, first_name: 'Tester' },
      chat: { id: userId ?? 4242, type: 'private' },
      text,
      entities: [{ type: 'bot_command', offset: 0, length: text.length }],
    },
  } as Update;
}

/**
 * Intercepts every outgoing Bot API call with a grammY transformer. The
 * transformer is installed on bot.api, and grammY copies installed
 * transformers to the per-update Api inside handleUpdate, so this covers
 * long-polling-style calls, webhookCallback, init/getMe — everything.
 */
export function mockTelegramApi(bot: Bot<AppContext>): SentCall[] {
  const calls: SentCall[] = [];
  const transformer = async (
    _prev: unknown,
    method: string,
    payload: unknown,
  ): Promise<unknown> => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    // A transformer that does not call prev() replaces the raw API call, so
    // it must return what ApiClient returns: an ApiResponse ({ok, result}).
    if (method === 'getMe') {
      return {
        ok: true,
        result: { id: 1, is_bot: true, first_name: 'TestBot', username: 'handmake_test_bot' },
      };
    }
    if (method === 'sendMessage') {
      const { chat_id: chatId } = payload as { chat_id: number };
      return {
        ok: true,
        result: {
          message_id: calls.length,
          date: 1_700_000_000,
          chat: { id: chatId, type: 'private' },
        },
      };
    }
    throw new Error(`mockTelegramApi: unexpected API call: ${method}`);
  };
  bot.api.config.use(transformer as never);
  return calls;
}

export function sentTexts(calls: SentCall[]): string[] {
  return calls
    .filter((call) => call.method === 'sendMessage')
    .map((call) => call.payload['text'] as string);
}

/** Minimal D1Database stand-in: every method is a spy that must stay unused. */
export function fakeDb(): D1Database {
  const prepare = vi.fn();
  return { prepare } as unknown as D1Database;
}
