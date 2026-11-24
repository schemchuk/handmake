import { buildApprovedWorkJob, createDraft, signCallbackBody } from '@handmake/core';
import type { Draft, TenantConfig } from '@handmake/core';
import { expect, it, vi } from 'vitest';

import { prepareDispatch } from '../src/channel-followups';
import type { FollowupStore } from '../src/channel-followups';
import type { Env } from '../src/env';
import { handlePublishedCallback } from '../src/published-callback';
import { botTexts } from '../src/texts';

const { schedule, get, markPublished } = vi.hoisted(() => ({
  schedule: vi.fn(),
  get: vi.fn(),
  markPublished: vi.fn(),
}));
vi.mock('../src/channel-followups', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/channel-followups')>()),
  createD1FollowupStore: () => ({ schedule, markDone: vi.fn() }),
}));
vi.mock('../src/draft-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/draft-store')>()),
  createD1DraftStore: () => ({ get, markPublished, chatIdOf: async () => undefined }),
}));

const tenantId = 'tenant';
const draftId = '01JBCA1B2C3D4E5F6G7H8J9K0M';
const now = new Date('2026-11-23T17:30:00Z');
const config = {
  meetingSchedule: { timezone: 'Europe/Berlin' },
  channels: { pinterest: { delay: { nextDayAt: '09:00' } } },
} as TenantConfig;

it.each([
  [false, 'publishing'],
  [true, 'publishing'],
  [true, 'scheduled'],
] as const)(
  'schedules Pinterest only on publisher confirmation (%s, %s)',
  async (confirmed, state) => {
    vi.clearAllMocks();
    const draft: Draft = {
      ...createDraft(tenantId, draftId, now, { kind: 'work' }),
      state: 'publishing',
      photoRefs: ['photo'],
      texts: { uk: 'Шарф', de: 'Schal' },
      extras: {
        work: {
          config: { kind: 'interior', collection: 'fixture', channels: ['pinterest'] },
          generated: {
            uk: { description: 'Шарф', provenance: 'ai-generated' },
            de: { description: 'Schal', provenance: 'ai-generated' },
          },
        },
      },
    };
    get.mockResolvedValue({ draft: { ...draft, state } });
    markPublished.mockResolvedValue(true);
    const tenantConfigs = { load: async () => config };
    const job = buildApprovedWorkJob(draft);
    const followups = { schedule } as unknown as FollowupStore;
    expect((await prepareDispatch(job, { tenantConfigs, followups }, now)).channels).toEqual([]);
    expect(schedule).not.toHaveBeenCalled();

    const body = JSON.stringify({
      tenantId,
      postId: draftId,
      kind: 'work',
      date: now.toISOString(),
      photos: [],
      channels: {},
      ...(confirmed && { pinterestPendingSince: now.toISOString() }),
    });
    const request = new Request('https://example.invalid/callbacks/published', {
      method: 'POST',
      body,
      headers: { 'x-handmake-signature': await signCallbackBody('signing-fixture', body) },
    });
    const env = {
      PUBLISH_CALLBACK_SECRET: 'signing-fixture',
      DB: { prepare: () => ({ bind: vi.fn() }), batch: vi.fn() },
    } as unknown as Env;
    expect(
      (await handlePublishedCallback(env, request, { tenantConfigs, texts: botTexts })).status,
    ).toBe(200);
    if (confirmed) {
      expect(schedule).toHaveBeenCalledExactlyOnceWith(
        tenantId,
        draftId,
        job,
        [{ channel: 'pinterest', dueAt: new Date('2026-11-24T08:00:00Z') }],
        expect.any(Date),
      );
      expect(schedule.mock.invocationCallOrder[0]).toBeLessThan(
        markPublished.mock.invocationCallOrder[0]!,
      );
    } else expect(schedule).not.toHaveBeenCalled();
  },
);
