import { createDraft, showDraftDataSchema } from '@handmake/core';
import type { ShowDraftData, ShowResultStore } from '@handmake/core';
import { InputFile } from 'grammy';
import { beforeEach, expect, it, vi } from 'vitest';
import type { AppContext } from '../src/context';
import type { D1DraftStore, StoredDraft } from '../src/draft-store';
import { createShowPreview } from '../src/show-preview';
import { botTexts } from '../src/texts';

const tenant = 'fixture';
const id = '01JBCA1B2C3D4E5F6G7H8J9K0M';
let stored: StoredDraft;
let latest: StoredDraft | undefined;
let data: ShowDraftData;
let ctx: AppContext;
let preview: ReturnType<typeof createShowPreview>;
const documents = vi.fn(async (_file: InputFile, _options: { caption: string }) => ({}));
const reply = vi.fn(async (_text: string, _options?: unknown) => ({}));
const original = vi.fn(async (_tenant: string, _ref: string) => ({
  bytes: new Uint8Array([1, 2, 3]),
  mimeType: 'image/jpeg' as const,
}));
const marked = vi.fn<ShowResultStore['get']>();
const session = vi.fn(async () => ({ kind: 'show', draftId: id }));
const chatId = vi.fn(async () => '11');
const result = (attempt: string) => {
  const receipt = Object.values(data.outputs).find((r) => r.attemptId === attempt)!;
  const { ref: _ref, attemptId: _attempt, ...metadata } = receipt;
  return {
    ref: `show-marked:v1:${tenant}:${id}:${attempt}`,
    result: {
      ...metadata,
      mimeType: attempt === 'video' ? ('video/mp4' as const) : ('image/png' as const),
      bytes: new Uint8Array([4, 5, 6]),
    },
  };
};
beforeEach(() => {
  vi.clearAllMocks();
  data = showDraftDataSchema.parse({
    plan: {
      workId: id,
      template: 'interior',
      originals: ['first', 'second'],
      imageCount: 3,
      provider: {
        image: { model: 'fixture', eurPerImage: 0.1 },
        video: { model: 'fixture', eurPerSecond: 0.1 },
      },
    },
    outputs: Object.fromEntries(
      ['image-0', 'image-1', 'image-2', 'video'].map((slot) => [
        slot,
        {
          attemptId: slot,
          ref: `show-raw:v1:${tenant}:${id}:${slot}`,
          callId: `call-${slot}`,
          model: 'fixture',
          promptVersion: 'fixture@1',
          costEur: 0.1,
          mimeType: slot === 'video' ? 'video/mp4' : 'image/jpeg',
        },
      ]),
    ),
  });
  stored = {
    draft: {
      ...createDraft(tenant, id, new Date(), { kind: 'show' }),
      state: 'ready',
      extras: { show: data },
    },
    version: 7,
    pendingEdit: null,
  };
  latest = structuredClone(stored);
  session.mockResolvedValue({ kind: 'show', draftId: id });
  chatId.mockResolvedValue('11');
  original.mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/jpeg' });
  marked.mockImplementation(async (_tenant, _show, attempt) => result(attempt));
  ctx = {
    tenantId: tenant,
    chat: { id: 11, type: 'private' },
    reply,
    replyWithDocument: documents,
  } as unknown as AppContext;
  preview = createShowPreview({
    texts: botTexts,
    original,
    marked: { get: marked },
    drafts: {
      getSessionShow: async (t: string, chat: string, show: string) => {
        const active = await session();
        return t === tenant && chat === (await chatId()) && show === active.draftId
          ? latest
          : undefined;
      },
    } as unknown as D1DraftStore,
  });
});

it('delivers every frozen original and current marked image/video as exact documents with filenames', async () => {
  await preview(ctx, stored);
  expect(documents).toHaveBeenCalledTimes(6);
  const files = documents.mock.calls.map(([file]) => file);
  expect(files.map((f) => f.filename)).toEqual([
    `${id}-original-1.jpg`,
    `${id}-original-2.jpg`,
    `${id}-image-0.png`,
    `${id}-image-1.png`,
    `${id}-image-2.png`,
    `${id}-video.mp4`,
  ]);
  expect(await files[0]!.toRaw()).toEqual(new Uint8Array([1, 2, 3]));
  expect(await files[2]!.toRaw()).toEqual(new Uint8Array([4, 5, 6]));
  expect(original.mock.calls).toEqual([
    [tenant, 'first'],
    [tenant, 'second'],
  ]);
  expect(marked.mock.calls.every(([t, s]) => t === tenant && s === id)).toBe(true);
  expect(reply.mock.calls.at(-1)![0]).toBe(botTexts.showPreviewStatus(0));
  expect(JSON.stringify(reply.mock.calls)).toContain(`show:${id}:preview:7`);
  expect(JSON.stringify(reply.mock.calls)).not.toMatch(/publish|approve|https:/);
});
it.each(['collecting', 'translating', 'failed', 'ready'] as const)(
  'permits read-only preview in %s state',
  async (state) => {
    stored.draft.state = state;
    latest = structuredClone(stored);
    await preview(ctx, stored);
    expect(documents).toHaveBeenCalledTimes(6);
  },
);
it('reports unfinished and missing marked media without falling back to raw output', async () => {
  delete data.outputs['video'];
  latest = structuredClone(stored);
  original.mockRejectedValueOnce(new Error('missing'));
  marked.mockResolvedValueOnce(undefined);
  await preview(ctx, stored);
  expect(documents).toHaveBeenCalledTimes(3);
  expect(reply.mock.calls.at(-1)![0]).toBe(botTexts.showPreviewStatus(3));
});
it.each([
  'foreign-tenant',
  'other-chat',
  'group',
  'other-session',
  'stale',
  'published',
  'deleted',
])('denies %s before resolving private media', async (reason) => {
  if (reason === 'foreign-tenant') ctx.tenantId = 'other';
  if (reason === 'other-chat') chatId.mockResolvedValue('12');
  if (reason === 'group') (ctx.chat as { type: string }).type = 'group';
  if (reason === 'other-session') session.mockResolvedValue({ kind: 'show', draftId: 'other' });
  if (reason === 'stale') latest!.version++;
  if (reason === 'published') latest!.draft.state = 'published';
  if (reason === 'deleted') latest = undefined;
  await expect(preview(ctx, stored)).rejects.toThrow();
  expect(original).not.toHaveBeenCalled();
  expect(marked).not.toHaveBeenCalled();
  expect(documents).not.toHaveBeenCalled();
});
it.each(['ref', 'mimeType', 'callId', 'model', 'promptVersion', 'costEur'])(
  'refuses mismatched marked %s',
  async (field) => {
    marked.mockImplementationOnce(async () => {
      const value = result('image-0');
      if (field === 'ref') value.ref = 'show-raw:v1:other';
      else Object.assign(value.result, { [field]: field === 'costEur' ? 9 : 'invalid' });
      return value;
    });
    await preview(ctx, stored);
    expect(documents).toHaveBeenCalledTimes(2);
    expect(reply.mock.calls.at(-1)![0]).toBe(botTexts.showPreviewInterruptedText);
  },
);
it('stops when asynchronous marking returns after the output has been superseded', async () => {
  marked.mockImplementationOnce(async () => {
    latest!.version++;
    return result('image-0');
  });
  await preview(ctx, stored);
  expect(documents).toHaveBeenCalledTimes(2);
  expect(reply.mock.calls.at(-1)![0]).toBe(botTexts.showPreviewInterruptedText);
});
it('checks output identity even if a faulty store does not advance its version', async () => {
  marked.mockImplementationOnce(async () => {
    (latest!.draft.extras['show'] as ShowDraftData).outputs['image-0']!.attemptId = 'replacement';
    return result('image-0');
  });
  await preview(ctx, stored);
  expect(documents).toHaveBeenCalledTimes(2);
});
it('stops after interrupted delivery and permits explicit replay from the same immutable version', async () => {
  documents.mockRejectedValueOnce(new Error('network'));
  await preview(ctx, stored);
  expect(documents).toHaveBeenCalledTimes(1);
  expect(reply.mock.calls.at(-1)![0]).toBe(botTexts.showPreviewInterruptedText);
  await preview(ctx, stored);
  expect(documents).toHaveBeenCalledTimes(7);
  expect(latest).toEqual(stored);
});
it('stops delivery when the author switches sessions during download', async () => {
  original.mockImplementationOnce(async () => {
    session.mockResolvedValue({ kind: 'show', draftId: 'another' });
    return { bytes: new Uint8Array([1]), mimeType: 'image/jpeg' };
  });
  await preview(ctx, stored);
  expect(documents).not.toHaveBeenCalled();
});

it('logs fixed diagnostics for unavailable media and interrupted delivery without external details', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const sensitive = new Error('https://api.telegram.org/bot123:SECRET-token/file');
  original.mockRejectedValueOnce(sensitive);
  marked.mockRejectedValueOnce(sensitive);
  documents.mockRejectedValueOnce(sensitive);
  try {
    await preview(ctx, stored);
    expect(log.mock.calls).toEqual([
      ['show preview failed', 'original unavailable'],
      ['show preview failed', 'delivery interrupted'],
    ]);
    log.mockClear();
    await preview(ctx, stored);
    expect(log.mock.calls).toEqual([['show preview failed', 'marked media unavailable']]);
    expect(JSON.stringify(log.mock.calls)).not.toContain('SECRET');
  } finally {
    log.mockRestore();
  }
});

it('shows the authentic block and keeps regeneration and cancellation controls', async () => {
  stored.draft.extras['showAuthentic'] = {
    items: [
      { fileId: 'private-photo', kind: 'photo' },
      { fileId: 'private-video', kind: 'video' },
    ],
    confirmed: true,
    editing: false,
    people: 'both',
  };
  latest = structuredClone(stored);
  ctx.replyWithPhoto = vi.fn() as never;
  ctx.replyWithVideo = vi.fn() as never;
  await preview(ctx, stored);
  expect(ctx.replyWithPhoto).toHaveBeenCalledWith('private-photo', {
    caption: 'Оригінальна робота',
  });
  expect(ctx.replyWithVideo).toHaveBeenCalledWith('private-video', {
    caption: 'Оригінальна робота',
  });
  const keyboard = JSON.stringify(reply.mock.calls.at(-1)?.[1]);
  expect(keyboard).toContain(':regen:');
  expect(keyboard).toContain(':owncancel:');
});
