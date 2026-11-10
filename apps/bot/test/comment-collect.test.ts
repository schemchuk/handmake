import { readFileSync } from 'node:fs';
import { Bot, GrammyError } from 'grammy';
import { expect, it, vi } from 'vitest';
import { parseTenantConfig, type ChannelCommentsCapability } from '@handmake/core';
import {
  buildCommentCard,
  runCommentCollect,
  type CommentCollectOptions,
} from '../src/comment-collect';
import { createCommentStore } from '../src/comment-store';
import type { AppContext } from '../src/context';
import { botTexts } from '../src/texts';
import { makeD1 } from './helpers';

const now = new Date('2026-11-09T12:00:00Z');
const config = parseTenantConfig(
  readFileSync(new URL('../../../config/tenants/faden-und-stimmung.yaml', import.meta.url), 'utf8'),
);
const comment = { id: 'c1', handle: 'reader', text: 'hello', createdAt: now.toISOString() };
async function setup() {
  const store = createCommentStore(await makeD1());
  const send = vi.fn().mockResolvedValue({});
  const draft = vi.fn().mockResolvedValue({ translationUk: 'T', replyDe: 'D', notesUk: '' });
  const capability: ChannelCommentsCapability = {
    listPosts: vi.fn().mockResolvedValue([{ id: 'p1' }]),
    listComments: vi.fn().mockResolvedValue([comment]),
    replyToComment: vi.fn(),
  };
  const bot = new Bot<AppContext>('123:fixture');
  bot.api.sendMessage = send;
  const options: CommentCollectOptions = {
    store,
    bot,
    texts: botTexts,
    allowList: new Map([[1, 'tenant']]),
    tenantConfigs: {
      load: async () => ({
        ...config,
        channels: { instagram: { language: 'de' }, facebook: { language: 'de' } },
      }),
    },
    capabilities: { instagram: capability },
    commentsContext: { secrets: { resolve: async () => '' } },
    drafterFor: vi.fn(async () => ({ draft })),
  };
  return { options, store, send, draft, capability };
}
it('deduplicates overlapping ticks before paid drafting and notification', async () => {
  const s = await setup();
  await Promise.all([runCommentCollect(now, s.options), runCommentCollect(now, s.options)]);
  await runCommentCollect(now, s.options);
  expect(s.draft).toHaveBeenCalledTimes(1);
  expect(s.send).toHaveBeenCalledTimes(1);
  expect(await s.store.getWatermark('tenant', 'instagram')).toEqual(now);
});
it('rejects expired and undated comments, including after retention deletion', async () => {
  const s = await setup();
  vi.mocked(s.capability.listComments).mockResolvedValue([
    { ...comment, createdAt: '2020-01-01' },
    { ...comment, id: 'bad', createdAt: '' },
  ]);
  await runCommentCollect(now, s.options);
  expect(s.draft).not.toHaveBeenCalled();
  expect(s.send).not.toHaveBeenCalled();
});
it('recovers pending drafts independently of the advanced API watermark', async () => {
  const s = await setup();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  s.draft.mockRejectedValueOnce(new Error('reader data'));
  await runCommentCollect(now, s.options);
  vi.mocked(s.capability.listComments).mockRejectedValue(new Error('API unavailable'));
  await runCommentCollect(now, s.options);
  expect(s.draft).toHaveBeenCalledTimes(2);
  expect(s.send).toHaveBeenCalledTimes(1);
  vi.restoreAllMocks();
});
it.each([false, true])('retries confirmed rejection only (ambiguous=%s)', async (ambiguous) => {
  const s = await setup();
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  s.send.mockRejectedValueOnce(
    ambiguous
      ? new Error('reader secret')
      : new GrammyError(
          'failure',
          { ok: false, error_code: 429, description: 'reader secret' },
          'sendMessage',
          {},
        ),
  );
  await runCommentCollect(now, s.options);
  await runCommentCollect(now, s.options);
  expect(s.send).toHaveBeenCalledTimes(ambiguous ? 1 : 2);
  expect(s.draft).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(log.mock.calls)).not.toContain('reader secret');
  vi.restoreAllMocks();
});
it('keeps the watermark on partial API failure and isolates networks', async () => {
  const s = await setup();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  s.options.capabilities.facebook = {
    ...s.capability,
    listComments: vi.fn().mockRejectedValue(new Error('reader secret')),
  };
  await runCommentCollect(now, s.options);
  expect(s.send).toHaveBeenCalledTimes(1);
  expect(await s.store.getWatermark('tenant', 'facebook')).toBeUndefined();
  vi.restoreAllMocks();
});

it('does not recollect an API comment after its retained row was deleted', async () => {
  const s = await setup();
  await runCommentCollect(now, s.options);
  const later = new Date(now.getTime() + 31 * 86400000);
  await s.store.deleteOlderThan(new Date(later.getTime() - 30 * 86400000));
  await runCommentCollect(later, s.options);
  expect(s.draft).toHaveBeenCalledTimes(1);
  expect(s.send).toHaveBeenCalledTimes(1);
});
it('does not advance any network watermark after a later post page fails', async () => {
  const s = await setup();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.mocked(s.capability.listPosts).mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);
  vi.mocked(s.capability.listComments)
    .mockResolvedValueOnce([comment])
    .mockRejectedValueOnce(new Error('pagination limit'));
  await runCommentCollect(now, s.options);
  expect(await s.store.getWatermark('tenant', 'instagram')).toBeUndefined();
  vi.restoreAllMocks();
});

it('guards callback byte length, including multibyte ids, before reserving notification', () => {
  const draft = { translationUk: 'T', replyDe: 'D', notesUk: '' };
  for (const id of ['x'.repeat(60), 'ä'.repeat(30), 'bad:id']) {
    expect(() =>
      buildCommentCard({ ...comment, network: 'instagram', id }, draft, botTexts),
    ).toThrow('comment callback exceeds supported format');
  }
  const card = buildCommentCard(
    { ...comment, network: 'facebook', id: '123_456' },
    draft,
    botTexts,
  );
  for (const button of card.keyboard.inline_keyboard.flat())
    expect(new TextEncoder().encode(button.callback_data).length).toBeLessThanOrEqual(64);
});
it('does not report delivered cards as uncertain every hour', async () => {
  const s = await setup();
  const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    await runCommentCollect(now, s.options);
    await runCommentCollect(new Date(now.getTime() + 7200000), s.options);
    expect(log).not.toHaveBeenCalled();
  } finally {
    log.mockRestore();
  }
});
it('notifies the author once when stale sends are quarantined', async () => {
  const s = await setup();
  const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    await runCommentCollect(now, s.options);
    await s.store.transition('tenant', 'instagram', 'c1', 'drafted', 'sending', now);
    await runCommentCollect(new Date(now.getTime() + 7200000), s.options);
    await runCommentCollect(new Date(now.getTime() + 10800000), s.options);
    expect(s.send).toHaveBeenCalledTimes(2);
    expect(s.send).toHaveBeenLastCalledWith('1', botTexts.commentSendReclaimed);
  } finally {
    log.mockRestore();
  }
});

it('continues collecting after the quarantine warning fails without logging reader data', async () => {
  const s = await setup();
  const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    await runCommentCollect(now, s.options);
    await s.store.transition('tenant', 'instagram', 'c1', 'drafted', 'sending', now);
    const later = new Date(now.getTime() + 7200000);
    vi.mocked(s.capability.listComments).mockResolvedValue([
      { ...comment, id: 'c2', createdAt: later.toISOString() },
    ]);
    s.send.mockRejectedValueOnce(new Error('private reader data'));
    await runCommentCollect(later, s.options);
    expect(s.draft).toHaveBeenCalledTimes(2);
    expect((await s.store.get('tenant', 'instagram', 'c2'))?.notifiedAt).toBeTruthy();
    expect(log).toHaveBeenCalledWith('comment quarantine warning failed', { count: 1 });
    expect(JSON.stringify(log.mock.calls)).not.toContain('private reader data');
  } finally {
    log.mockRestore();
  }
});

it('collects Threads once and names the network on the author card', async () => {
  const s = await setup();
  s.options.capabilities = { threads: s.capability };
  s.options.tenantConfigs = {
    load: async () => ({ ...config, channels: { threads: { language: 'de' } } }),
  };
  await runCommentCollect(now, s.options);
  await runCommentCollect(now, s.options);
  expect(s.draft).toHaveBeenCalledTimes(1);
  expect(s.send).toHaveBeenCalledTimes(1);
  expect(s.send.mock.calls[0]?.[1]).toContain('Threads');
  expect(JSON.stringify(s.send.mock.calls)).toContain('comment:threads:c1:send');
  expect(await s.store.getWatermark('tenant', 'threads')).toEqual(now);
});

it.each(['threads', 'instagram', 'facebook'] as const)(
  'shows the network limit and removes Send only for oversized %s drafts',
  (network) => {
    const card = (replyDe: string) =>
      buildCommentCard(
        { ...comment, network },
        { translationUk: 'T', replyDe, notesUk: '' },
        botTexts,
      );
    const oversized = card('🧵'.repeat(126));
    const hasSend = (value: ReturnType<typeof card>) =>
      value.keyboard.inline_keyboard
        .flat()
        .some((button) => button.callback_data.endsWith(':send'));
    expect(hasSend(oversized)).toBe(network !== 'threads');
    expect(hasSend(card('🧵'.repeat(125)))).toBe(true);
    if (network === 'threads') expect(oversized.text).toContain('500 байтів UTF-8');
  },
);
