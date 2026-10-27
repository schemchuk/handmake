import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import type { Bot } from 'grammy';
import type { Update } from 'grammy/types';
import { Miniflare } from 'miniflare';
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

/** Builds a private photo update; the sizes ascend like Telegram sends them. */
export function photoUpdate(
  userId: number | undefined,
  fileIds: string[],
  caption?: string,
): Update {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      date: 1_700_000_000,
      from: userId === undefined ? undefined : { id: userId, is_bot: false, first_name: 'Tester' },
      chat: { id: userId ?? 4242, type: 'private' },
      photo: fileIds.map((file_id, index) => ({
        file_id,
        file_unique_id: `unique-${file_id}`,
        width: (index + 1) * 320,
        height: (index + 1) * 240,
        file_size: (index + 1) * 1000,
      })),
      caption,
    },
  } as Update;
}

/** Builds a private document update (sent-as-file photo, HEIC, …). */
export function documentUpdate(
  userId: number | undefined,
  fileId: string,
  mimeType: string,
  fileName: string,
): Update {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      date: 1_700_000_000,
      from: userId === undefined ? undefined : { id: userId, is_bot: false, first_name: 'Tester' },
      chat: { id: userId ?? 4242, type: 'private' },
      document: {
        file_id: fileId,
        file_unique_id: `unique-${fileId}`,
        file_name: fileName,
        mime_type: mimeType,
        file_size: 2000,
      },
    },
  } as Update;
}

/** Builds a private voice-message update (a "message kind we don't take"). */
export function voiceUpdate(userId: number | undefined, fileId: string): Update {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      date: 1_700_000_000,
      from: userId === undefined ? undefined : { id: userId, is_bot: false, first_name: 'Tester' },
      chat: { id: userId ?? 4242, type: 'private' },
      voice: { file_id: fileId, file_unique_id: `unique-${fileId}`, duration: 3 },
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

/**
 * A real D1 (Miniflare, in-memory) with every migration from migrations/
 * applied — the "local D1" the task requires for repository tests.
 */
export async function makeD1(): Promise<D1Database> {
  const miniflare = new Miniflare({ script: '', modules: true, d1Databases: ['DB'] });
  const db = await miniflare.getD1Database('DB');
  const migrationsDir = fileURLToPath(new URL('../migrations', import.meta.url));
  const files = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort();
  for (const file of files) {
    // Miniflare's exec rejects comment-only fragments and truncates
    // multi-line statements, so migrations are flattened to one line before
    // applying (wrangler itself applies them as-is).
    const sql = (await readFile(`${migrationsDir}/${file}`, 'utf8'))
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .map((line) => line.trim())
      .filter(Boolean)
      .join(' ');
    if (sql.trim()) {
      await db.exec(sql);
    }
  }
  return db as unknown as D1Database;
}
