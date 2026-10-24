import { describe, expect, it } from 'vitest';

import { TelegramNotifier } from '../src/notify/telegram-notifier';

const TOKEN = 'TEST_TOKEN_123';
const API_BASE = 'https://api.telegram.org';

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function fakeFetch(handler: (url: string) => Response): {
  fetchImpl: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return handler(String(input));
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function formBody(init?: RequestInit): URLSearchParams {
  return new URLSearchParams(String((init as { body: unknown })?.body));
}

describe('TelegramNotifier', () => {
  it('sends the message to the operator chat id', async () => {
    const { fetchImpl, calls } = fakeFetch(() => new Response('{"ok":true}', { status: 200 }));
    const notifier = new TelegramNotifier({
      token: TOKEN,
      operatorChatId: '4242',
      fetchImpl,
    });

    await notifier.notify('operator', 'publish failed on telegram');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${API_BASE}/bot${TOKEN}/sendMessage`);
    const body = formBody(calls[0]?.init);
    expect(body.get('chat_id')).toBe('4242');
    expect(body.get('text')).toBe('publish failed on telegram');
  });

  it('routes author and operator to their own chat ids', async () => {
    const { fetchImpl, calls } = fakeFetch(() => new Response('{"ok":true}', { status: 200 }));
    const notifier = new TelegramNotifier({
      token: TOKEN,
      authorChatId: '100',
      operatorChatId: '200',
      fetchImpl,
    });

    await notifier.notify('author', 'done');
    await notifier.notify('operator', 'broken');

    expect(formBody(calls[0]?.init).get('chat_id')).toBe('100');
    expect(formBody(calls[1]?.init).get('chat_id')).toBe('200');
  });

  it('is a silent no-op when the target chat id is not wired', async () => {
    const { fetchImpl, calls } = fakeFetch(() => new Response('{"ok":true}', { status: 200 }));
    const notifier = new TelegramNotifier({ token: TOKEN, authorChatId: '100', fetchImpl });

    await notifier.notify('operator', 'nobody to warn');

    expect(calls).toHaveLength(0);
  });

  it('throws on HTTP errors without quoting the token', async () => {
    const { fetchImpl } = fakeFetch(() => new Response('{"ok":false}', { status: 500 }));
    const notifier = new TelegramNotifier({ token: TOKEN, operatorChatId: '1', fetchImpl });

    const error: unknown = await notifier.notify('operator', 'x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('HTTP 500');
    expect((error as Error).message).not.toContain(TOKEN);
  });
});
