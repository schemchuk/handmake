import { afterEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/composition';
import type { Env } from '../src/env';
import { botTexts } from '../src/texts';
import { fakeDb } from './helpers';

const mocks = vi.hoisted(() => ({ cron: vi.fn(), notices: vi.fn() }));
vi.mock('../src/announcement-cron', () => ({ runAnnouncementCron: mocks.cron }));
vi.mock('../src/ai-cost-runtime', () => ({
  createAiCostRuntime: () => ({ notices: mocks.notices, translatorFor: vi.fn() }),
}));
afterEach(() => vi.restoreAllMocks());

it('runs announcements before notices and catches notification failures separately', async () => {
  const calls: string[] = [];
  mocks.cron.mockImplementation(async () => {
    calls.push('announcement');
  });
  mocks.notices.mockImplementation(async () => {
    calls.push('notices');
    throw new Error('offline');
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
  expect(calls).toEqual(['announcement', 'notices']);
  expect(error).toHaveBeenCalledExactlyOnceWith('AI cost notification failed');
});
