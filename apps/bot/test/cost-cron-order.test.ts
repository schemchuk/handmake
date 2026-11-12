import { afterEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/composition';
import type { Env } from '../src/env';
import { botTexts } from '../src/texts';
import { fakeDb } from './helpers';

const mocks = vi.hoisted(() => ({
  cron: vi.fn(),
  poll: vi.fn(),
  closing: vi.fn(),
  notices: vi.fn(),
  collect: vi.fn(),
  reconcile: vi.fn(),
}));
vi.mock('../src/name-reconciliation', () => ({
  createNameReconciler: () => ({ tick: mocks.reconcile }),
}));
vi.mock('../src/announcement-cron', () => ({ runAnnouncementCron: mocks.cron }));
vi.mock('../src/poll-cron', () => ({ runPollCron: mocks.poll }));
vi.mock('../src/poll-closing-runtime', () => ({
  runPollClosingCron: mocks.closing,
  registerPollResultCallbacks: vi.fn(),
}));
vi.mock('../src/comment-collect', () => ({ runCommentCollect: mocks.collect }));
vi.mock('../src/ai-cost-runtime', () => ({
  createAiCostRuntime: () => ({
    notices: mocks.notices,
    translatorFor: vi.fn(),
    textGeneratorFor: vi.fn(),
    commentDrafterFor: vi.fn(),
  }),
}));
afterEach(() => vi.restoreAllMocks());

it.each([
  [false, false],
  [true, false],
  [false, true],
  [true, true],
])(
  'isolates opening (%s) and closing (%s) failures from later cron work',
  async (pollFails, closingFails) => {
    const calls: string[] = [];
    mocks.cron.mockImplementation(async () => {
      calls.push('announcement');
    });
    mocks.poll.mockImplementation(async () => {
      calls.push('poll');
      if (pollFails) throw new Error('poll offline');
    });
    mocks.closing.mockImplementation(async () => {
      calls.push('closing');
      if (closingFails) throw new Error('closing offline');
    });
    mocks.notices.mockImplementation(async () => {
      calls.push('notices');
      throw new Error('offline');
    });
    mocks.collect.mockImplementation(async () => {
      calls.push('collect');
    });
    mocks.reconcile.mockImplementation(async () => {
      calls.push('reconcile');
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = createApp(
      {
        DB: fakeDb(),
        PUBLISH_LIVE: 'true',
        TELEGRAM_BOT_TOKEN: 'fixture',
        TELEGRAM_ALLOWED_USER_IDS: '{"11":"one"}',
        GITHUB_REPO: 'owner/repo',
      } as Env,
      botTexts,
    );
    await expect(
      app.scheduled({ cron: '* * * * *', scheduledTime: Date.now() } as ScheduledEvent),
    ).resolves.toBe(0);
    expect(calls).toEqual(['announcement', 'poll', 'closing', 'notices', 'collect', 'reconcile']);
    expect(mocks.collect.mock.calls[0]![1].capabilities).toEqual({});
    expect(error).toHaveBeenCalledTimes(1 + Number(pollFails) + Number(closingFails));
    if (pollFails) {
      expect(error).toHaveBeenNthCalledWith(1, 'poll cron failed', {
        tenantId: 'one',
        operation: 'poll cron failed',
        message: 'poll offline',
      });
    }
    expect(error).toHaveBeenNthCalledWith(
      1 + Number(pollFails) + Number(closingFails),
      'AI cost notification failed',
      {
        tenantId: 'one',
        operation: 'AI cost notification failed',
        message: 'offline',
      },
    );
  },
);
