import { readFileSync } from 'node:fs';
import { renderChannelShow, showSchema } from '@handmake/core';
import { FakeChannelAdapter } from '@handmake/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { renderTelegramShow, TelegramAdapter } from '../src';

const fixture = () =>
  showSchema.parse(
    JSON.parse(
      readFileSync(new URL('../../core/test/fixtures/show.json', import.meta.url), 'utf8'),
    ),
  );
const context = {
  site: { baseUrl: 'https://craft.example', defaultLanguage: 'de' },
  languages: ['de', 'uk'],
};
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 99]);
const video = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 99]);
const delivery = () => ({
  photos: [png, png, png],
  video,
  settings: { channelId: 'CHAT' },
  secrets: { resolve: async () => 'chat' },
  idempotencyBase: 'tenant:show:telegram',
});

describe('show rendering', () => {
  it('preserves descriptions, discloses AI and links each language to its canonical route', () => {
    const show = fixture();
    const ops = renderTelegramShow(show, context);
    expect(ops).toEqual(renderTelegramShow(show, context));
    expect(ops[0]).toEqual({
      kind: 'mediaGroup',
      photoIndexes: [0, 1, 2],
      captionLang: 'de',
      caption: `Fixture DE\n\nKI-generiertes Model\nhttps://craft.example/shows/${show.id.toLowerCase()}/`,
    });
    expect(ops[1]).toEqual({ kind: 'video', replyToOp: 0 });
    expect(ops[2]).toEqual({
      kind: 'message',
      lang: 'uk',
      replyToOp: 0,
      text: `Fixture UA\n\nМодель згенерована ШІ (KI-generiertes Model)\nhttps://craft.example/uk/shows/${show.id.toLowerCase()}/`,
    });
    expect(renderTelegramShow(show, { ...context, languages: ['uk', 'uk'] })[0]).toMatchObject({
      captionLang: 'uk',
    });
  });
  it('shares the German footer with the canonical show link and counts its length', () => {
    const show = fixture();
    const settings = { joinUrl: 'https://t.me/fixture_channel' };
    const configured = { ...context, settings };
    const line = `Kanal abonnieren: ${settings.joinUrl}`;
    const ops = renderTelegramShow(show, configured);
    expect(ops[0]).toMatchObject({ caption: expect.stringContaining(`\n\n${line}`) });
    expect(ops[2]).toEqual(renderTelegramShow(show, context)[2]);
    show.versions.de!.description = 'x'.repeat(1024);
    expect(renderTelegramShow(show, configured)[0]).not.toHaveProperty('caption');
    const suffixLength =
      (renderTelegramShow(fixture(), configured)[0] as { caption: string }).caption.length -
      fixture().versions.de!.description.length;
    show.versions.de!.description = 'x'.repeat(4096 - suffixLength);
    expect(renderTelegramShow(show, configured)[2]).toMatchObject({ text: expect.any(String) });
    show.versions.de!.description += 'x';
    expect(() => renderTelegramShow(show, configured)).toThrow(/message limit/);
  });
  it('renders only tenant languages and requires a localized disclosure', () => {
    const show = fixture();
    expect(renderTelegramShow(show, { ...context, languages: ['uk'] })).toHaveLength(2);
    show.versions.en = { ...show.versions.de!, description: 'English description' };
    expect(renderTelegramShow(show, { ...context, languages: ['en'] })[0]).toMatchObject({
      caption: expect.stringContaining('AI-generated model'),
    });
    show.versions.fr = show.versions.en;
    expect(() => renderTelegramShow(show, { ...context, languages: ['fr'] })).toThrow(
      'disclosure language',
    );
  });
  it('moves an overflowing caption into a reply without truncation and checks the complete message', () => {
    const show = fixture();
    show.versions.de!.description = 'x'.repeat(1024);
    const ops = renderTelegramShow(show, context);
    expect(ops[0]).not.toHaveProperty('caption');
    expect(ops[2]).toMatchObject({
      kind: 'message',
      replyToOp: 0,
      text: expect.stringContaining('x'.repeat(1024)),
    });
    show.versions.de!.description = 'x'.repeat(4096);
    expect(() => renderTelegramShow(show, context)).toThrow('message limit');
  });
  it.each([1024, 4096])('accepts the exact %i character boundary including the link', (limit) => {
    const show = fixture();
    const initial = renderTelegramShow(show, context)[0]!;
    if (initial.kind !== 'mediaGroup') throw new Error('expected album');
    const overhead = initial.caption!.length - show.versions.de!.description.length;
    show.versions.de!.description = 'x'.repeat(limit - overhead);
    const ops = renderTelegramShow(show, context);
    if (limit === 1024) expect(ops[0]).toMatchObject({ caption: expect.any(String) });
    else expect(ops[2]).toMatchObject({ kind: 'message', text: expect.any(String) });
    const op = limit === 1024 ? ops[0]! : ops[2]!;
    expect(
      op.kind === 'mediaGroup' ? op.caption!.length : op.kind === 'message' ? op.text.length : 0,
    ).toBe(limit);
  });
  it('never links a site-excluded show copy to its (unbuilt) page (PR #89)', () => {
    const show = { ...fixture(), siteExcluded: true };
    const ops = renderTelegramShow(show, context);
    const showUrl = `https://craft.example/shows/${show.id.toLowerCase()}/`;
    expect(ops[0]).toMatchObject({
      kind: 'mediaGroup',
      caption: `Fixture DE\n\nKI-generiertes Model`,
    });
    expect(ops[2]).toMatchObject({
      kind: 'message',
      text: `Fixture UA\n\nМодель згенерована ШІ (KI-generiertes Model)`,
    });
    expect(JSON.stringify(ops)).not.toContain(showUrl);
  });
  it('rejects missing video, invalid origin and unsupported adapters', () => {
    const show = fixture();
    expect(() =>
      renderTelegramShow({ ...show, video: undefined } as unknown as typeof show, context),
    ).toThrow('video');
    expect(() =>
      renderTelegramShow(show, {
        ...context,
        site: { ...context.site, baseUrl: 'https://craft.example/path' },
      }),
    ).toThrow('origin');
    expect(() =>
      renderChannelShow(new FakeChannelAdapter({ key: 'other' }), show, context),
    ).toThrow('does not support shows');
  });
});

describe('show delivery', () => {
  function setup(responses: { status?: number; body?: unknown }[] = []) {
    const requests: { method: string; form?: FormData }[] = [];
    const fetchImpl = vi.fn(async (url: unknown, init?: RequestInit) => {
      const method = String(url).split('/').at(-1)!;
      requests.push({ method, form: init?.body instanceof FormData ? init.body : undefined });
      const response = responses.shift();
      return new Response(
        JSON.stringify(
          response?.body ?? {
            ok: true,
            result: method === 'sendMediaGroup' ? [{ message_id: 71 }] : { message_id: 72 },
          },
        ),
        { status: response?.status ?? 200 },
      );
    });
    const sleep = vi.fn(async () => {});
    return {
      adapter: new TelegramAdapter({
        token: 'fixture',
        fetchImpl: fetchImpl as typeof fetch,
        sleep,
      }),
      requests,
      sleep,
    };
  }
  it('uploads PNG and MP4 bytes unchanged and persists each operation before sending the next', async () => {
    const { adapter, requests } = setup();
    const persisted: number[] = [];
    const ops = renderChannelShow(adapter, fixture(), context);
    await adapter.deliver(ops, delivery(), {
      startAt: 0,
      knownIds: [],
      onDelivered: async (index) => {
        expect(requests).toHaveLength(index + 1);
        persisted.push(index);
      },
    });
    expect(persisted).toEqual([0, 1, 2]);
    const photo = requests[0]!.form!.get('media0') as File;
    expect(photo.name).toBe('photo0.png');
    expect(photo.type).toBe('image/png');
    expect(new Uint8Array(await photo.arrayBuffer())).toEqual(png);
    const clip = requests[1]!.form!.get('video') as File;
    expect(clip.type).toBe('video/mp4');
    expect(new Uint8Array(await clip.arrayBuffer())).toEqual(video);
    expect(JSON.parse(String(requests[1]!.form!.get('reply_parameters')))).toEqual({
      message_id: 71,
    });
  });
  it('resumes at video using the recorded album id', async () => {
    const { adapter, requests } = setup();
    const onDelivered = vi.fn();
    const ids = await adapter.deliver(
      renderTelegramShow(fixture(), context),
      { ...delivery(), photos: [] },
      { startAt: 1, knownIds: [91], onDelivered },
    );
    expect(requests.map((r) => r.method)).toEqual(['sendVideo', 'sendMessage']);
    expect(JSON.parse(String(requests[0]!.form!.get('reply_parameters')))).toEqual({
      message_id: 91,
    });
    expect(ids).toEqual([91, 72, 72]);
    expect(onDelivered).toHaveBeenCalledWith(1, 72);
  });
  it('fails before sending the album when video bytes are absent', async () => {
    const { adapter, requests } = setup();
    await expect(
      adapter.deliver(renderTelegramShow(fixture(), context), { ...delivery(), video: undefined }),
    ).rejects.toThrow('video bytes');
    expect(requests).toHaveLength(0);
  });
  it('stops when progress persistence fails', async () => {
    const { adapter, requests } = setup();
    await expect(
      adapter.deliver(renderTelegramShow(fixture(), context), delivery(), {
        startAt: 0,
        knownIds: [],
        onDelivered: () => {
          throw new Error('ledger unavailable');
        },
      }),
    ).rejects.toThrow('ledger unavailable');
    expect(requests.map((r) => r.method)).toEqual(['sendMediaGroup']);
  });
  it('retries rate-limited video and preserves its reply target and bytes', async () => {
    const second = setup([{ status: 429, body: { ok: false, parameters: { retry_after: 2 } } }]);
    await second.adapter.deliver(renderTelegramShow(fixture(), context), delivery(), {
      startAt: 1,
      knownIds: [91],
      onDelivered: () => {},
    });
    expect(second.sleep).toHaveBeenCalledWith(2000);
    expect(second.requests.slice(0, 2).map((r) => r.method)).toEqual(['sendVideo', 'sendVideo']);
    for (const req of second.requests.slice(0, 2)) {
      expect(new Uint8Array(await (req.form!.get('video') as File).arrayBuffer())).toEqual(video);
      expect(JSON.parse(String(req.form!.get('reply_parameters')))).toEqual({ message_id: 91 });
    }
  });
  it.each([
    { status: 500, body: { ok: false } },
    { status: 200, body: { ok: true, result: {} } },
  ])('does not report failed or malformed video delivery', async (response) => {
    const { adapter, requests } = setup([response]);
    const onDelivered = vi.fn();
    await expect(
      adapter.deliver(renderTelegramShow(fixture(), context), delivery(), {
        startAt: 1,
        knownIds: [91],
        onDelivered,
      }),
    ).rejects.toThrow('sendVideo');
    expect(onDelivered).not.toHaveBeenCalled();
    expect(requests).toHaveLength(1);
  });
});
