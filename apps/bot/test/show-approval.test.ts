import { createDraft, showDraftDataSchema, signCallbackBody } from '@handmake/core';
import type { Work, PublishJob } from '@handmake/core';
import type { InputFile } from 'grammy';
import { beforeEach, expect, it, vi } from 'vitest';
import { MissingShowVerification } from '../src/show-verification';
import { handlePublishedCallback } from '../src/published-callback';
import type { Env } from '../src/env';
import { createShowApproval } from '../src/show-approval';
import { createD1DraftStore } from '../src/draft-store';
import type { AppContext } from '../src/context';
import { callbackQueryUpdate, makeD1, mockTelegramApi, textUpdate } from './helpers';
import { createBot } from '../src/bot';
import { botTexts } from '../src/texts';
import { FakeTranslator } from '@handmake/core/testing';

const tenant = 'fixture';
const id = '01JBCA1B2C3D4E5F6G7H8J9K0M';
let db: D1Database;
let store: ReturnType<typeof createD1DraftStore>;
let approval: ReturnType<typeof createShowApproval>;
let ctx: AppContext;
const reply = vi.fn(async (_text: string, _options?: unknown) => ({}));
const upload = vi.fn(async (file: InputFile) => ({
  document: {
    file_id: `tg-${file.filename}`,
    file_unique_id: `unique-${file.filename}`,
    file_name: file.filename,
    file_size: 3,
    mime_type: file.filename?.endsWith('.mp4') ? 'video/mp4' : 'image/png',
  },
}));
const work: Work = {
  id,
  tenant,
  date: '2026-11-03T00:00:00.000Z',
  collection: 'fixture',
  kind: 'interior',
  photos: ['original.jpg'],
  versions: {
    uk: { description: 'Текст авторки', provenance: 'human' },
    de: { description: 'Beschreibung', provenance: 'ai-assisted' },
  },
};
const data = showDraftDataSchema.parse({
  plan: {
    workId: id,
    template: 'interior',
    originals: ['one', 'two'],
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
        callId: slot,
        model: 'fixture',
        promptVersion: 'fixture@1',
        costEur: 0.1,
        mimeType: slot === 'video' ? 'video/mp4' : 'image/jpeg',
      },
    ]),
  ),
});
beforeEach(async () => {
  vi.clearAllMocks();
  db = await makeD1();
  store = createD1DraftStore(db);
  await store.create(
    {
      ...createDraft(tenant, id, new Date(), { kind: 'show' }),
      state: 'ready',
      extras: { show: data },
    },
    '11',
  );
  await store.setChatSession(tenant, '11', { kind: 'show', draftId: id }, new Date());
  ctx = {
    tenantId: tenant,
    chat: { id: 11, type: 'private' },
    reply,
    replyWithDocument: upload,
  } as unknown as AppContext;
  approval = createShowApproval({
    drafts: store,
    works: { readWork: async () => work, listWorks: async () => [work] },
    verified: {
      get: async (scope) => {
        const rawReceipt = data.outputs[scope.attemptId]!;
        const markedReceipt = {
          ...rawReceipt,
          ref: `show-marked:v1:${tenant}:${id}:${scope.attemptId}`,
          mimeType: scope.attemptId === 'video' ? ('video/mp4' as const) : ('image/png' as const),
        };
        const { attemptId: _a, ref, ...metadata } = markedReceipt;
        return {
          ref,
          result: { ...metadata, bytes: new Uint8Array([1, 2, 3]) },
          evidence: {
            ...scope,
            rawSha256: 'a'.repeat(64),
            markedSha256: 'b'.repeat(64),
            rawReceipt,
            markedReceipt,
            marker: {
              visible: 'KI-generiertes Model',
              machineReadable: { format: 'XMP', value: 'fixture' },
            },
          },
        };
      },
    },
  });
});
const stored = async () => (await store.get(tenant, id))!;
const present = async () => approval.present(ctx, await stored());
const approve = async () => {
  const s = await stored();
  return approval.approve(ctx, s, String(s.version));
};
it('shows exact documents and complete inherited language versions before version-bound consent', async () => {
  await present();
  expect(upload.mock.calls.map(([file]) => file.filename)).toEqual([
    'image-0.png',
    'image-1.png',
    'image-2.png',
    'video.mp4',
  ]);
  for (const [file] of upload.mock.calls)
    expect(await file.toRaw()).toEqual(new Uint8Array([1, 2, 3]));
  expect(reply.mock.calls.map(([text]) => text)).toContain(work.versions.uk!.description);
  expect(reply.mock.calls.map(([text]) => text)).toContain(work.versions.de!.description);
  const job = await approve();
  expect(job?.kind).toBe('show');
  if (job?.kind !== 'show') throw new Error('missing job');
  expect(job.show.show.versions).toEqual(work.versions);
  expect(job.show.show.workId).toBe(id);
  expect((await stored()).draft.state).toBe('publishing');
  expect(await approval.approve(ctx, await stored(), '1')).toBeUndefined();
  await store.revertPublishing(tenant, id, new Date());
  expect(await approval.approve(ctx, await stored(), '1')).toEqual(job);
  expect(
    await store.updateShow(
      { ...(await stored()).draft, state: 'failed' },
      (await stored()).version,
    ),
  ).toBe(false);
});
it.each(['upload', 'identity', 'notification'])(
  'recovers interrupted %s without approving partial delivery',
  async (failure) => {
    if (failure === 'upload') upload.mockRejectedValueOnce(new Error('interrupted'));
    if (failure === 'identity')
      upload.mockResolvedValueOnce({ document: { file_id: 'bad' } } as never);
    if (failure === 'notification') reply.mockRejectedValueOnce(new Error('interrupted'));
    await expect(present()).rejects.toThrow();
    expect((await stored()).draft.extras['showProposal']).toBeUndefined();
    await present();
    expect(await approve()).toBeDefined();
  },
);
it('rejects stale consent after regeneration or cancellation wins the version CAS', async () => {
  await present();
  const old = await stored();
  await store.updateShow({ ...old.draft, state: 'translating' }, old.version);
  await expect(approval.approve(ctx, old, String(old.version))).rejects.toThrow('stale');
  expect((await stored()).draft.extras['showApproved']).toBeUndefined();
});
it('only one concurrent approval wins and frozen payload survives a failed dispatch', async () => {
  await present();
  const s = await stored();
  const jobs = await Promise.all([
    approval.approve(ctx, s, String(s.version)),
    approval.approve(ctx, s, String(s.version)),
  ]);
  expect(jobs.filter(Boolean)).toHaveLength(1);
  const frozen = (await stored()).draft.extras['showApproved'] as PublishJob;
  await store.revertPublishing(tenant, id, new Date());
  expect(await approval.approve(ctx, await stored(), String(s.version))).toEqual(frozen);
});
it('denies another tenant and chat', async () => {
  await expect(
    approval.present({ ...ctx, tenantId: 'other' } as AppContext, await stored()),
  ).rejects.toThrow('stale');
  await expect(
    approval.present({ ...ctx, chat: { id: 12, type: 'private' } } as AppContext, await stored()),
  ).rejects.toThrow('stale');
});

it('recovers a lost consent notification by presenting the same generation again', async () => {
  const originalReply = reply.getMockImplementation()!;
  reply.mockImplementation(async (text, options) => {
    if (text.startsWith('Схвалити')) throw new Error('notification lost');
    return originalReply(text, options);
  });
  await expect(present()).rejects.toThrow('notification lost');
  expect((await stored()).draft.extras['showProposal']).toBeDefined();
  expect((await stored()).draft.extras['showApproved']).toBeUndefined();
  reply.mockImplementation(originalReply);
  await present();
  expect(await approve()).toBeDefined();
});
it('rejects approval if cancellation wins during integrity rechecking', async () => {
  await present();
  const s = await stored();
  const get = store.get.bind(store);
  let reads = 0;
  vi.spyOn(store, 'get').mockImplementation(async (tenant, id) => {
    if (++reads === 2)
      await store.updateShow(
        { ...s.draft, extras: { ...s.draft.extras, showCancelled: true } },
        s.version,
      );
    return get(tenant, id);
  });
  await expect(approval.approve(ctx, s, String(s.version))).rejects.toThrow('stale');
  expect((await get(tenant, id))!.draft.extras['showApproved']).toBeUndefined();
});
it('does not persist partial document delivery and can retry the whole verified snapshot', async () => {
  const send = upload.getMockImplementation()!;
  upload.mockImplementationOnce(send).mockRejectedValueOnce(new Error('partial upload'));
  await expect(present()).rejects.toThrow('partial');
  expect((await stored()).draft.extras['showProposal']).toBeUndefined();
  await present();
  expect(await approve()).toBeDefined();
});

it('routes version-bound consent and frozen dispatch retries through the real bot session', async () => {
  await present();
  const jobs: PublishJob[] = [];
  const tasks: Promise<void>[] = [];
  const bot = createBot({
    token: 'TEST_TOKEN',
    drafts: store,
    texts: botTexts,
    resolveTenant: (user) => (user === 11 ? tenant : undefined),
    translator: new FakeTranslator(),
    publishRunner: {
      run: async (job) => {
        jobs.push(structuredClone(job));
        if (jobs.length === 1) throw new Error('dispatch interrupted');
      },
    },
    background: (task) => {
      tasks.push(task());
    },
    show: {
      approval,
      works: { listWorks: async () => [work], readWork: async () => work },
      configs: { load: async () => ({ id: tenant, shows: data.plan.provider, ai: {} }) as never },
    },
  });
  const calls = mockTelegramApi(bot);
  await bot.init();
  await bot.handleUpdate(callbackQueryUpdate(11, 11, `show:${id}:approve:1`));
  await Promise.all(tasks);
  expect((await stored()).draft.state).toBe('ready');
  await bot.handleUpdate(textUpdate(11, '/discard'));
  expect((await stored()).draft.extras['showCancelled']).toBeUndefined();
  await bot.handleUpdate(textUpdate(11, '/show'));
  expect(JSON.stringify(calls)).toContain(`show:${id}:approve:1`);
  expect(JSON.stringify(calls)).toContain(botTexts.showPublishRetryButton);
  await bot.handleUpdate(callbackQueryUpdate(11, 11, `show:${id}:approve:1`));
  await Promise.all(tasks);
  expect(jobs).toHaveLength(2);
  expect(jobs[1]).toEqual(jobs[0]);
});

it('reports a failed verification dispatch clearly and leaves the ready show retryable', async () => {
  const initial = await stored();
  const backfill = vi.fn(async () => {
    throw new Error('dispatch failed');
  });
  const legacy = createShowApproval({
    drafts: store,
    backfill,
    verified: {
      get: async () => {
        throw new MissingShowVerification();
      },
    },
    works: { readWork: async () => work, listWorks: async () => [work] },
  });
  await legacy.present(ctx, initial);
  expect(reply).toHaveBeenCalledWith(expect.stringContaining('Не вдалося запустити перевірку'));
  expect(await stored()).toEqual(initial);
  expect(upload).not.toHaveBeenCalled();
});

it('never dispatches a backfill for invalid evidence or a stale private session', async () => {
  const backfill = vi.fn();
  const invalid = createShowApproval({
    drafts: store,
    backfill,
    verified: {
      get: async () => {
        throw new Error('verification integrity failed');
      },
    },
    works: { readWork: async () => work, listWorks: async () => [work] },
  });
  await expect(invalid.present(ctx, await stored())).rejects.toThrow('integrity');
  await expect(
    invalid.present({ ...ctx, tenantId: 'other' } as AppContext, await stored()),
  ).rejects.toThrow('stale');
  expect(backfill).not.toHaveBeenCalled();
});

it.each([false, true])(
  'sends the show result to the approving chat after approve (retry: %s)',
  async (retry) => {
    await present();
    const initial = await stored();
    expect(await approve()).toBeDefined();
    expect((await stored()).draft.extras['approvalChatId']).toBe('11');
    if (retry) {
      await store.revertPublishing(tenant, id, new Date());
      // Simulate a frozen legacy approval without the newly captured chat.
      await db
        .prepare(
          "UPDATE drafts SET extras = json_remove(extras, '$.approvalChatId') WHERE tenant_id = ? AND id = ?",
        )
        .bind(tenant, id)
        .run();
      expect(await approval.approve(ctx, await stored(), String(initial.version))).toBeDefined();
      expect((await stored()).draft.extras['approvalChatId']).toBe('11');
    }
    const secret = 'test-callback-secret';
    const body = JSON.stringify({
      kind: 'show',
      tenantId: tenant,
      postId: id,
      date: '2026-11-05',
      photos: [],
      channels: {},
    });
    const sent = vi.fn(async () => new Response('{}'));
    const signature = await signCallbackBody(secret, body);
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await handlePublishedCallback(
        { DB: db, PUBLISH_CALLBACK_SECRET: secret, TELEGRAM_BOT_TOKEN: 'TEST_TOKEN' } as Env,
        new Request('https://example.test/callbacks/published', {
          method: 'POST',
          headers: { 'x-handmake-signature': signature },
          body,
        }),
        {
          texts: botTexts,
          tenantConfigs: {
            load: async () => ({ site: { baseUrl: 'https://example.test' } }) as never,
          },
          fetchImpl: sent as unknown as typeof fetch,
        },
      );
      expect(response.status).toBe(200);
    }
    expect(sent).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(String((sent.mock.calls[0] as unknown as [string, RequestInit])[1].body)),
    ).toEqual({
      chat_id: '11',
      text: `Показ опубліковано. https://example.test/shows/${id.toLowerCase()}/`,
    });
  },
);
