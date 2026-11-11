import { afterEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/composition';
import type { Env } from '../src/env';
import { botTexts } from '../src/texts';
import { fakeDb } from './helpers';

const mocks = vi.hoisted(() => ({
  cron: vi.fn(),
  poll: vi.fn(),
  notices: vi.fn(),
  collect: vi.fn(),
}));
vi.mock('../src/announcement-cron', () => ({ runAnnouncementCron: mocks.cron }));
vi.mock('../src/poll-cron', () => ({ runPollCron: mocks.poll }));
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

it.each([false, true])(
  'runs all cron steps in order and isolates poll failure (%s) from notice failure',
  async (pollFails) => {
    const calls: string[] = [];
    mocks.cron.mockImplementation(async () => {
      calls.push('announcement');
    });
    mocks.poll.mockImplementation(async () => {
      calls.push('poll');
      if (pollFails) throw new Error('poll offline');
    });
    mocks.notices.mockImplementation(async () => {
      calls.push('notices');
      throw new Error('offline');
    });
    mocks.collect.mockImplementation(async () => {
      calls.push('collect');
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = createApp(
      {
        DB: fakeDb(),
        TELEGRAM_BOT_TOKEN: 'fixture',
        TELEGRAM_ALLOWED_USER_IDS: '{"11":"one"}',
        GITHUB_REPO: 'owner/repo',
      } as Env,
      botTexts,
    );
    await expect(
      app.scheduled({ cron: '* * * * *', scheduledTime: Date.now() } as ScheduledEvent),
    ).resolves.toBe(0);
    expect(calls).toEqual(['announcement', 'poll', 'notices', 'collect']);
    expect(mocks.collect.mock.calls[0]![1].capabilities).toEqual({});
    expect(error).toHaveBeenCalledTimes(pollFails ? 2 : 1);
    if (pollFails) {
      expect(error).toHaveBeenNthCalledWith(1, 'poll cron failed', {
        tenantId: 'one',
        operation: 'poll cron failed',
        message: 'poll offline',
      });
    }
    expect(error).toHaveBeenNthCalledWith(pollFails ? 2 : 1, 'AI cost notification failed', {
      tenantId: 'one',
      operation: 'AI cost notification failed',
      message: 'offline',
    });
  },
);
