import type { DeliverContext, RemoteId, SendOperation } from '@handmake/core';
import { describeChannelAdapterContract } from '@handmake/core/testing';
import { describe, expect, it, vi } from 'vitest';

import {
  createTelegramAdapter,
  TelegramAdapter,
  TelegramAdapterError,
} from '../src/telegram/adapter';

const TOKEN = 'test-token-123';

interface RecordedRequest {
  url: string;
  form?: FormData;
  json?: Record<string, unknown>;
}

/** Records requests and serves canned responses; no network. */
function fakeFetch(handler: (req: RecordedRequest, n: number) => Response) {
  const requests: RecordedRequest[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    const record: RecordedRequest = { url: String(input) };
    if (init?.body instanceof FormData) record.form = init.body;
    if (typeof init?.body === 'string') record.json = JSON.parse(init.body);
    requests.push(record);
    return handler(record, requests.length);
  }) as typeof fetch;
  return { fetchImpl, requests };
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** Sequential message ids per request number, mediaGroup-aware. */
const okHandler = () => (req: RecordedRequest, n: number) =>
  req.url.endsWith('/sendMediaGroup')
    ? jsonResponse({ ok: true, result: [{ message_id: 100 + n }, { message_id: 200 + n }] })
    : jsonResponse({ ok: true, result: { message_id: n } });

const makeCtx = (overrides: Partial<DeliverContext> = {}): DeliverContext => ({
  secrets: { resolve: async () => 'chat-1' },
  idempotencyBase: 't:p:telegram',
  settings: { channelId: 'TEST_CHANNEL' },
  photos: [],
  ...overrides,
});

const sleepNoop = async (): Promise<void> => {};

describeChannelAdapterContract(
  'telegram',
  () =>
    new TelegramAdapter({
      token: TOKEN,
      fetchImpl: fakeFetch(okHandler()).fetchImpl,
      sleep: sleepNoop,
    }),
);

describe('TelegramAdapter', () => {
  it('sends text-only ops via sendMessage with chat_id and text', async () => {
    const { fetchImpl, requests } = fakeFetch(okHandler());
    const adapter = new TelegramAdapter({ token: TOKEN, fetchImpl, sleep: sleepNoop });
    const ops: SendOperation[] = [
      { kind: 'message', text: 'Привіт!', lang: 'uk' },
      { kind: 'message', text: 'Hallo!', lang: 'de', replyToOp: 0 },
    ];

    const ids = await adapter.deliver(ops, makeCtx(), {
      startAt: 0,
      knownIds: [],
      onDelivered: () => {},
    });

    expect(ids).toEqual([1, 2]);
    expect(requests).toHaveLength(2);
    expect(requests[0]!.url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(requests[0]!.json).toMatchObject({ chat_id: 'chat-1', text: 'Привіт!' });
    // No web-page card: the join/canonical links stay plain links (PR #89).
    expect(requests[0]!.json?.link_preview_options).toEqual({ is_disabled: true });
    expect(requests[1]!.json).toMatchObject({ chat_id: 'chat-1', text: 'Hallo!' });
    expect(requests[1]!.json?.reply_parameters).toEqual({ message_id: 1 });
  });

  it('sends a mediaGroup as multipart with attach:// refs and caption on the first item', async () => {
    const { fetchImpl, requests } = fakeFetch(okHandler());
    const adapter = new TelegramAdapter({ token: TOKEN, fetchImpl, sleep: sleepNoop });
    const ops: SendOperation[] = [
      {
        kind: 'mediaGroup',
        photoIndexes: [0, 1],
        caption: 'Привіт!',
        captionLang: 'uk',
      },
      { kind: 'message', text: 'Hallo!', lang: 'de', replyToOp: 0 },
    ];
    const photos = [new Uint8Array([1, 2]), new Uint8Array([3, 4])];

    const ids = await adapter.deliver(ops, makeCtx({ photos }), {
      startAt: 0,
      knownIds: [],
      onDelivered: () => {},
    });

    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(101); // result[0].message_id of the album

    const form = requests[0]!.form!;
    expect(form.get('chat_id')).toBe('chat-1');
    const media = JSON.parse(form.get('media') as string) as Record<string, unknown>[];
    expect(media).toEqual([
      { type: 'photo', media: 'attach://media0', caption: 'Привіт!' },
      { type: 'photo', media: 'attach://media1' },
    ]);
    expect(form.get('media0')).toBeInstanceOf(Blob);
    expect(form.get('media1')).toBeInstanceOf(Blob);
    expect(form.has('captionLang')).toBe(false);
    // The reply carries the album's remote id.
    expect(requests[1]!.json?.reply_parameters).toEqual({ message_id: 101 });
  });

  it('sends a single-photo mediaGroup via sendPhoto (Bot API forbids 1-item albums)', async () => {
    const { fetchImpl, requests } = fakeFetch(okHandler());
    const adapter = new TelegramAdapter({ token: TOKEN, fetchImpl, sleep: sleepNoop });
    const ops: SendOperation[] = [
      { kind: 'mediaGroup', photoIndexes: [0], caption: 'Одне фото', captionLang: 'uk' },
      { kind: 'message', text: 'Ein Foto', lang: 'de', replyToOp: 0 },
    ];
    const photos = [new Uint8Array([9, 9])];

    const ids = await adapter.deliver(ops, makeCtx({ photos }), {
      startAt: 0,
      knownIds: [],
      onDelivered: () => {},
    });

    expect(ids).toEqual([1, 2]);
    expect(requests[0]!.url).toBe(`https://api.telegram.org/bot${TOKEN}/sendPhoto`);
    const form = requests[0]!.form!;
    expect(form.get('chat_id')).toBe('chat-1');
    expect(form.get('photo')).toBeInstanceOf(Blob);
    expect(form.get('caption')).toBe('Одне фото');
    expect(form.has('media')).toBe(false);
    // The reply still references the photo message's remote id.
    expect(requests[1]!.json?.reply_parameters).toEqual({ message_id: 1 });
  });

  it('rejects an empty mediaGroup op before any fetch', async () => {
    const { fetchImpl, requests } = fakeFetch(okHandler());
    const adapter = new TelegramAdapter({ token: TOKEN, fetchImpl, sleep: sleepNoop });

    await expect(
      adapter.deliver([{ kind: 'mediaGroup', photoIndexes: [] }], makeCtx(), {
        startAt: 0,
        knownIds: [],
        onDelivered: () => {},
      }),
    ).rejects.toThrow(TelegramAdapterError);
    expect(requests).toHaveLength(0);
  });

  it('honours retry_after on 429 and retries the same op', async () => {
    const sleep = vi.fn(sleepNoop);
    let first = true;
    const { fetchImpl, requests } = fakeFetch(() => {
      if (first) {
        first = false;
        return jsonResponse(
          {
            ok: false,
            error_code: 429,
            description: 'Too Many Requests',
            parameters: { retry_after: 7 },
          },
          429,
        );
      }
      return jsonResponse({ ok: true, result: { message_id: 55 } });
    });
    const adapter = new TelegramAdapter({ token: TOKEN, fetchImpl, sleep });

    const ids = await adapter.deliver([{ kind: 'message', text: 'hi', lang: 'uk' }], makeCtx(), {
      startAt: 0,
      knownIds: [],
      onDelivered: () => {},
    });

    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(7000);
    expect(requests).toHaveLength(2);
    expect(ids).toEqual([55]);
  });

  it('throws TelegramAdapterError with the description and without the token on 400', async () => {
    const { fetchImpl } = fakeFetch(() =>
      jsonResponse({ ok: false, error_code: 400, description: 'Bad Request: chat not found' }, 400),
    );
    const adapter = new TelegramAdapter({ token: TOKEN, fetchImpl, sleep: sleepNoop });

    const attempt = adapter.deliver([{ kind: 'message', text: 'hi', lang: 'uk' }], makeCtx(), {
      startAt: 0,
      knownIds: [],
      onDelivered: () => {},
    });
    await expect(attempt).rejects.toThrowError(TelegramAdapterError);
    await expect(attempt).rejects.toThrowError(/chat not found/);
    await expect(attempt).rejects.not.toThrowError(new RegExp(TOKEN));
  });

  it('throws cleanly on a non-ok HTTP response without a JSON description', async () => {
    const { fetchImpl } = fakeFetch(() => new Response('gateway exploded', { status: 502 }));
    const adapter = new TelegramAdapter({ token: TOKEN, fetchImpl, sleep: sleepNoop });

    await expect(
      adapter.deliver([{ kind: 'message', text: 'hi', lang: 'uk' }], makeCtx(), {
        startAt: 0,
        knownIds: [],
        onDelivered: () => {},
      }),
    ).rejects.toThrowError(/HTTP 502/);
  });

  it('resumes at startAt: skips op 0, resolves replyToOp from knownIds, reports only new ops', async () => {
    const { fetchImpl, requests } = fakeFetch(okHandler());
    const adapter = new TelegramAdapter({ token: TOKEN, fetchImpl, sleep: sleepNoop });
    const ops: SendOperation[] = [
      { kind: 'message', text: 'uk', lang: 'uk' },
      { kind: 'message', text: 'de', lang: 'de', replyToOp: 0 },
    ];
    const reported: { opIndex: number; remoteId: RemoteId }[] = [];

    const ids = await adapter.deliver(ops, makeCtx(), {
      startAt: 1,
      knownIds: [100],
      onDelivered: (opIndex, remoteId) => {
        reported.push({ opIndex, remoteId });
      },
    });

    expect(requests).toHaveLength(1); // no request for op 0
    expect(requests[0]!.json?.reply_parameters).toEqual({ message_id: 100 });
    expect(ids).toEqual([100, 1]);
    expect(reported).toEqual([{ opIndex: 1, remoteId: 1 }]);
  });

  it('awaits onDelivered before sending the next op', async () => {
    const events: string[] = [];
    const { fetchImpl, requests } = fakeFetch((req, n) => {
      events.push(`fetch:${n}`);
      return okHandler()(req, n);
    });
    const adapter = new TelegramAdapter({ token: TOKEN, fetchImpl, sleep: sleepNoop });
    const ops: SendOperation[] = [
      { kind: 'message', text: 'uk', lang: 'uk' },
      { kind: 'message', text: 'de', lang: 'de' },
    ];

    await adapter.deliver(ops, makeCtx(), {
      startAt: 0,
      knownIds: [],
      onDelivered: (opIndex) => {
        events.push(`delivered:${opIndex}`);
      },
    });

    expect(requests).toHaveLength(2);
    expect(events.indexOf('delivered:0')).toBeGreaterThan(-1);
    expect(events.indexOf('delivered:0')).toBeLessThan(events.indexOf('fetch:2'));
  });

  it('rejects settings without channelId before any fetch', async () => {
    const { fetchImpl, requests } = fakeFetch(okHandler());
    const adapter = new TelegramAdapter({ token: TOKEN, fetchImpl, sleep: sleepNoop });

    await expect(
      adapter.deliver([{ kind: 'message', text: 'hi', lang: 'uk' }], makeCtx({ settings: {} }), {
        startAt: 0,
        knownIds: [],
        onDelivered: () => {},
      }),
    ).rejects.toThrowError(TelegramAdapterError);
    expect(requests).toHaveLength(0);
  });

  it('rejects an empty resolved chat id before any fetch', async () => {
    const { fetchImpl, requests } = fakeFetch(okHandler());
    const adapter = new TelegramAdapter({ token: TOKEN, fetchImpl, sleep: sleepNoop });

    await expect(
      adapter.deliver(
        [{ kind: 'message', text: 'hi', lang: 'uk' }],
        makeCtx({ secrets: { resolve: async () => '' } }),
        { startAt: 0, knownIds: [], onDelivered: () => {} },
      ),
    ).rejects.toThrowError(/empty chat id/);
    expect(requests).toHaveLength(0);
  });

  it('rejects a progress that violates the ledger invariant before any fetch', async () => {
    const { fetchImpl, requests } = fakeFetch(okHandler());
    const adapter = new TelegramAdapter({ token: TOKEN, fetchImpl, sleep: sleepNoop });

    await expect(
      adapter.deliver([{ kind: 'message', text: 'hi', lang: 'uk' }], makeCtx(), {
        startAt: 1,
        knownIds: [],
        onDelivered: () => {},
      }),
    ).rejects.toThrowError(/invalid progress/);
    expect(requests).toHaveLength(0);
  });

  it('refuses to resolve replyToOp against a not-yet-sent op', async () => {
    const { fetchImpl, requests } = fakeFetch(okHandler());
    const adapter = new TelegramAdapter({ token: TOKEN, fetchImpl, sleep: sleepNoop });
    const ops: SendOperation[] = [
      { kind: 'message', text: 'uk', lang: 'uk', replyToOp: 1 },
      { kind: 'message', text: 'de', lang: 'de' },
    ];

    await expect(
      adapter.deliver(ops, makeCtx(), { startAt: 0, knownIds: [], onDelivered: () => {} }),
    ).rejects.toThrowError(/replyToOp 1/);
    expect(requests).toHaveLength(0);
  });

  it('rejects a mediaGroup referencing a missing photo index', async () => {
    const { fetchImpl, requests } = fakeFetch(okHandler());
    const adapter = new TelegramAdapter({ token: TOKEN, fetchImpl, sleep: sleepNoop });

    await expect(
      adapter.deliver(
        [{ kind: 'mediaGroup', photoIndexes: [3] }],
        makeCtx({ photos: [new Uint8Array([1])] }),
        { startAt: 0, knownIds: [], onDelivered: () => {} },
      ),
    ).rejects.toThrowError(/missing photo at index 3/);
    expect(requests).toHaveLength(0);
  });

  it('createTelegramAdapter builds a working adapter', async () => {
    const { fetchImpl } = fakeFetch(okHandler());
    const adapter = createTelegramAdapter({ token: TOKEN, fetchImpl, sleep: sleepNoop });
    expect(adapter.key).toBe('telegram');
    const ids = await adapter.deliver([{ kind: 'message', text: 'hi', lang: 'uk' }], makeCtx(), {
      startAt: 0,
      knownIds: [],
      onDelivered: () => {},
    });
    expect(ids).toEqual([1]);
  });
});

describe('TelegramAdapter: polls (T21)', () => {
  const pollOp: SendOperation = {
    kind: 'poll',
    question: 'Яка робота тижня?',
    options: ['1. Ваза', '2. Шаль'],
    replyToOp: 0,
  };

  it('sends a poll op via sendPoll, anonymous, replying to the album', async () => {
    const { fetchImpl, requests } = fakeFetch(okHandler());
    const adapter = new TelegramAdapter({ token: TOKEN, fetchImpl, sleep: sleepNoop });
    const ops: SendOperation[] = [
      { kind: 'mediaGroup', photoIndexes: [0, 1], caption: 'Голосуйте!', captionLang: 'uk' },
      pollOp,
    ];
    const photos = [new Uint8Array([1]), new Uint8Array([2])];

    const ids = await adapter.deliver(ops, makeCtx({ photos }), {
      startAt: 0,
      knownIds: [],
      onDelivered: () => {},
    });

    expect(ids).toEqual([101, 2]);
    expect(requests[1]!.url).toBe(`https://api.telegram.org/bot${TOKEN}/sendPoll`);
    expect(requests[1]!.json).toMatchObject({
      chat_id: 'chat-1',
      question: 'Яка робота тижня?',
      options: [{ text: '1. Ваза' }, { text: '2. Шаль' }],
      is_anonymous: true,
      reply_parameters: { message_id: 101 },
    });
  });

  it('resumes between album and poll: only sendPoll goes out, replying to the known album id', async () => {
    const { fetchImpl, requests } = fakeFetch(okHandler());
    const adapter = new TelegramAdapter({ token: TOKEN, fetchImpl, sleep: sleepNoop });
    const ops: SendOperation[] = [
      { kind: 'mediaGroup', photoIndexes: [0, 1], caption: 'Голосуйте!', captionLang: 'uk' },
      pollOp,
    ];
    const photos = [new Uint8Array([1]), new Uint8Array([2])];
    const reported: { opIndex: number; remoteId: RemoteId }[] = [];

    const ids = await adapter.deliver(ops, makeCtx({ photos }), {
      startAt: 1,
      knownIds: [555],
      onDelivered: (opIndex, remoteId) => {
        reported.push({ opIndex, remoteId });
      },
    });

    // Re-run after the album landed: no second album, no second poll — the
    // ledger remote id IS the poll message id.
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toMatch(/\/sendPoll$/);
    expect(requests[0]!.json?.reply_parameters).toEqual({ message_id: 555 });
    expect(ids).toEqual([555, 1]);
    expect(reported).toEqual([{ opIndex: 1, remoteId: 1 }]);
  });

  it('closePoll calls stopPoll and parses per-option and total counts', async () => {
    const { fetchImpl, requests } = fakeFetch(() =>
      jsonResponse({
        ok: true,
        result: {
          message_id: 42,
          options: [
            { text: '1. Ваза', voter_count: 7 },
            { text: '2. Шаль', voter_count: 3 },
          ],
          total_voter_count: 10,
        },
      }),
    );
    const adapter = new TelegramAdapter({ token: TOKEN, fetchImpl, sleep: sleepNoop });

    const result = await adapter.closePoll(42, makeCtx());

    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe(`https://api.telegram.org/bot${TOKEN}/stopPoll`);
    expect(requests[0]!.json).toMatchObject({ chat_id: 'chat-1', message_id: 42 });
    expect(result).toEqual({ optionVotes: [7, 3], totalVotes: 10 });
  });

  it('bounds stopPoll transport with a 30-second abort deadline', async () => {
    const signal = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(signal);
    const fetchImpl = vi.fn(async (_input: unknown, init?: RequestInit) => {
      expect(init?.signal).toBe(signal);
      throw new Error('aborted');
    }) as unknown as typeof fetch;
    try {
      const adapter = new TelegramAdapter({ token: TOKEN, fetchImpl });
      await expect(adapter.closePoll(42, makeCtx())).rejects.toThrow('request failed');
      expect(timeout).toHaveBeenCalledWith(30_000);
    } finally {
      timeout.mockRestore();
    }
  });

  it('closePoll parses a zero-vote poll', async () => {
    const { fetchImpl } = fakeFetch(() =>
      jsonResponse({
        ok: true,
        result: {
          options: [
            { text: '1. Ваза', voter_count: 0 },
            { text: '2. Шаль', voter_count: 0 },
          ],
          total_voter_count: 0,
        },
      }),
    );
    const adapter = new TelegramAdapter({ token: TOKEN, fetchImpl, sleep: sleepNoop });

    const result = await adapter.closePoll(7, makeCtx());
    expect(result).toEqual({ optionVotes: [0, 0], totalVotes: 0 });
  });

  it('closePoll rejects a malformed stopPoll result', async () => {
    const { fetchImpl } = fakeFetch(() => jsonResponse({ ok: true, result: { message_id: 42 } }));
    const adapter = new TelegramAdapter({ token: TOKEN, fetchImpl, sleep: sleepNoop });

    await expect(adapter.closePoll(42, makeCtx())).rejects.toThrowError(/malformed/);
  });

  it('closePoll reports Telegram errors without the token', async () => {
    const { fetchImpl } = fakeFetch(() =>
      jsonResponse({ ok: false, error_code: 400, description: 'message not found' }, 400),
    );
    const adapter = new TelegramAdapter({ token: TOKEN, fetchImpl, sleep: sleepNoop });

    const attempt = adapter.closePoll(99, makeCtx());
    await expect(attempt).rejects.toThrowError(/message not found/);
    await expect(attempt).rejects.not.toThrowError(new RegExp(TOKEN));
  });
});

describe('TelegramAdapter: existing message edits (T32a)', () => {
  const text: SendOperation = { kind: 'message', text: 'Work No 1', lang: 'de' };

  it.each<SendOperation>([
    text,
    { kind: 'mediaGroup', photoIndexes: [0, 1], caption: 'Work No 1' },
    { kind: 'mediaGroup', photoIndexes: [] },
  ])('edits $kind using the tenant destination and existing target', async (op) => {
    const { fetchImpl, requests } = fakeFetch(okHandler());
    const resolve = vi.fn(async () => 'tenant-chat');
    const adapter = new TelegramAdapter({ token: TOKEN, fetchImpl });
    await adapter.editMessage(123, op, makeCtx({ secrets: { resolve } }));
    expect(resolve).toHaveBeenCalledExactlyOnceWith('TEST_CHANNEL');
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toMatch(
      op.kind === 'message' ? /\/editMessageText$/ : /\/editMessageCaption$/,
    );
    expect(requests[0]!.json).toEqual({
      chat_id: 'tenant-chat',
      message_id: 123,
      ...(op.kind === 'message'
        ? { text: op.text, link_preview_options: { is_disabled: true } }
        : { caption: op.kind === 'mediaGroup' ? (op.caption ?? '') : '' }),
    });
  });

  it('treats an unchanged message as successful reconciliation', async () => {
    const { fetchImpl, requests } = fakeFetch(() =>
      jsonResponse(
        {
          ok: false,
          error_code: 400,
          description:
            'Bad Request: message is not modified: specified new message content is the same',
        },
        400,
      ),
    );
    await expect(
      new TelegramAdapter({ token: TOKEN, fetchImpl }).editMessage(123, text, makeCtx()),
    ).resolves.toBeUndefined();
    expect(requests).toHaveLength(1);
  });

  it('retries rate limits within the attempt budget', async () => {
    const { fetchImpl, requests } = fakeFetch(() =>
      jsonResponse(
        { ok: false, error_code: 429, description: 'private name', parameters: { retry_after: 2 } },
        429,
      ),
    );
    const sleep = vi.fn(sleepNoop);
    const adapter = new TelegramAdapter({ token: TOKEN, fetchImpl, sleep, maxAttempts: 3 });
    await expect(adapter.editMessage(123, text, makeCtx())).rejects.toThrow('Too Many Requests');
    expect(requests).toHaveLength(3);
    expect(sleep.mock.calls).toEqual([[2000], [2000]]);
  });

  it('recovers from a rate limit without sending a new message', async () => {
    const { fetchImpl, requests } = fakeFetch((req, n) =>
      n === 1
        ? jsonResponse({ ok: false, parameters: { retry_after: 0 } }, 429)
        : okHandler()(req, n),
    );
    await new TelegramAdapter({ token: TOKEN, fetchImpl, sleep: sleepNoop }).editMessage(
      '123',
      text,
      makeCtx(),
    );
    expect(requests).toHaveLength(2);
    expect(requests.every((req) => req.url.endsWith('/editMessageText'))).toBe(true);
  });

  it.each([400, 403, 500])('sanitizes permanent/API rejection %s without retry', async (status) => {
    const { fetchImpl, requests } = fakeFetch(() =>
      jsonResponse({ ok: false, description: `private name ${TOKEN}` }, status),
    );
    const attempt = new TelegramAdapter({ token: TOKEN, fetchImpl }).editMessage(
      123,
      text,
      makeCtx(),
    );
    await expect(attempt).rejects.toThrow(`HTTP ${status}`);
    await expect(attempt).rejects.not.toThrow('private name');
    await expect(attempt).rejects.not.toThrow(TOKEN);
    expect(requests).toHaveLength(1);
  });

  it('sanitizes transport failures and sets a deadline', async () => {
    const fetchImpl = vi.fn(async (_input: unknown, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      throw new Error(`https://api.telegram.org/bot${TOKEN}/editMessageText private name`);
    }) as unknown as typeof fetch;
    const attempt = new TelegramAdapter({ token: TOKEN, fetchImpl }).editMessage(
      123,
      text,
      makeCtx(),
    );
    await expect(attempt).rejects.toThrow('request failed');
    await expect(attempt).rejects.not.toThrow(TOKEN);
    await expect(attempt).rejects.not.toThrow('private name');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each<SendOperation>([{ kind: 'video' }, { kind: 'poll', question: 'q', options: ['a', 'b'] }])(
    'rejects unsupported $kind without fetch',
    async (op) => {
      const { fetchImpl, requests } = fakeFetch(okHandler());
      await expect(
        new TelegramAdapter({ token: TOKEN, fetchImpl }).editMessage(123, op, makeCtx()),
      ).rejects.toThrow('operation kind');
      expect(requests).toHaveLength(0);
    },
  );

  it.each([0, -1, '', '123/other', 1.5])('rejects invalid target %s', async (id) => {
    const { fetchImpl, requests } = fakeFetch(okHandler());
    await expect(
      new TelegramAdapter({ token: TOKEN, fetchImpl }).editMessage(id, text, makeCtx()),
    ).rejects.toThrow('valid message id');
    expect(requests).toHaveLength(0);
  });

  it.each([
    makeCtx({ settings: {} }),
    makeCtx({ secrets: { resolve: async () => '' } }),
    makeCtx({
      secrets: {
        resolve: async () => {
          throw new Error('private name');
        },
      },
    }),
  ])('sanitizes destination failures without fetch', async (ctx) => {
    const { fetchImpl, requests } = fakeFetch(okHandler());
    await expect(
      new TelegramAdapter({ token: TOKEN, fetchImpl }).editMessage(123, text, ctx),
    ).rejects.toThrow('destination resolution failed');
    expect(requests).toHaveLength(0);
  });
});

it.each([-1, 301, Infinity, NaN, null, '2'])(
  'rejects out-of-range retry_after %s on send and edit',
  async (retry_after) => {
    for (const edit of [false, true]) {
      const { fetchImpl, requests } = fakeFetch(() =>
        jsonResponse({ ok: false, parameters: { retry_after } }, 429),
      );
      const sleep = vi.fn(sleepNoop);
      const adapter = new TelegramAdapter({ token: TOKEN, fetchImpl, sleep });
      const op: SendOperation = { kind: 'message', text: 'Fixture', lang: 'uk' };
      await expect(
        edit ? adapter.editMessage(123, op, makeCtx()) : adapter.deliver([op], makeCtx()),
      ).rejects.toThrow();
      expect(requests).toHaveLength(1);
      expect(sleep).not.toHaveBeenCalled();
    }
  },
);
