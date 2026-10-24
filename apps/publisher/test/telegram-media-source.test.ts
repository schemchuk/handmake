import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

import { TelegramMediaSource } from '../src/photos/telegram-media-source';

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

const tinyPhoto = () =>
  sharp({
    create: { width: 16, height: 12, channels: 3, background: { r: 200, g: 150, b: 100 } },
  })
    .png()
    .toBuffer();

const okGetFile = (filePath: string) =>
  Response.json({ ok: true, result: { file_path: filePath } });

describe('TelegramMediaSource', () => {
  it('downloads by file_id and returns the raw file bytes', async () => {
    const raw = await tinyPhoto();
    const { fetchImpl, calls } = fakeFetch((url) => {
      if (url.includes('/getFile')) return okGetFile('photos/file_42.jpg');
      return new Response(raw, { status: 200 });
    });
    const source = new TelegramMediaSource({ token: TOKEN, fetchImpl });

    const result = await source.fetchPhoto('FILE_ID_42');

    expect(result).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(result).equals(Buffer.from(raw))).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe(`${API_BASE}/bot${TOKEN}/getFile?file_id=FILE_ID_42`);
    expect(calls[1]?.url).toBe(`${API_BASE}/file/bot${TOKEN}/photos/file_42.jpg`);
    expect(calls[1]?.init).toMatchObject({ redirect: 'follow' });
  });

  it('throws with the Telegram description when getFile fails, without leaking the token', async () => {
    const { fetchImpl } = fakeFetch(() =>
      Response.json({ ok: false, description: 'Bad Request: file not found' }),
    );
    const source = new TelegramMediaSource({ token: TOKEN, fetchImpl });

    await expect(source.fetchPhoto('MISSING')).rejects.toThrow(/Bad Request: file not found/);
    await expect(source.fetchPhoto('MISSING')).rejects.not.toThrow(new RegExp(TOKEN));
  });

  it('throws when the getFile response is malformed JSON', async () => {
    const { fetchImpl } = fakeFetch(() => new Response('<not json>', { status: 200 }));
    const source = new TelegramMediaSource({ token: TOKEN, fetchImpl });

    await expect(source.fetchPhoto('FILE_ID_42')).rejects.toThrow(/malformed JSON/);
  });

  it('throws when getFile returns a non-200 status', async () => {
    const { fetchImpl } = fakeFetch(() => new Response('oops', { status: 500 }));
    const source = new TelegramMediaSource({ token: TOKEN, fetchImpl });

    await expect(source.fetchPhoto('FILE_ID_42')).rejects.toThrow(/HTTP 500/);
  });

  it('throws when the file download returns a non-200 status', async () => {
    const { fetchImpl } = fakeFetch((url) =>
      url.includes('/getFile')
        ? okGetFile('photos/file_42.jpg')
        : new Response('not found', { status: 404 }),
    );
    const source = new TelegramMediaSource({ token: TOKEN, fetchImpl });

    const failure = source.fetchPhoto('FILE_ID_42');
    await expect(failure).rejects.toThrow(/HTTP 404/);
    await expect(failure).rejects.not.toThrow(new RegExp(TOKEN));
  });
});
