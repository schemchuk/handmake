import { CommentReplyRejectedError, type ChannelCommentsCapability } from '@handmake/core';
import { describe, expect, it, vi } from 'vitest';
import { createBot } from '../src/bot';
import { createCommentStore, type CommentNetwork } from '../src/comment-store';
import { createD1DraftStore } from '../src/draft-store';
import { botTexts } from '../src/texts';
import { callbackQueryUpdate, makeD1, mockTelegramApi, sentTexts, textUpdate } from './helpers';

async function setup(network: CommentNetwork = 'instagram') {
  const db = await makeD1();
  const store = createCommentStore(db);
  const now = new Date();
  const add = async (id = 'c1', tenantId = 'tenant') => {
    await store.collect({
      tenantId,
      network,
      id,
      postId: 'p1',
      handle: 'reader',
      text: 'hello',
      commentCreatedAt: now.toISOString(),
      createdAt: now,
      updatedAt: now,
    });
    await store.claimDrafting(tenantId, network, id, now);
    await store.storeDraft(
      tenantId,
      network,
      id,
      { translationUk: 'translation', replyDe: 'Danke!', notesUk: '' },
      now,
    );
  };
  await add();
  const reply = vi.fn().mockResolvedValue('r1');
  const capability: ChannelCommentsCapability = {
    replyToComment: reply,
    listComments: vi.fn(),
    listPosts: vi.fn(),
  };
  const tasks: (() => Promise<void>)[] = [];
  const bot = createBot({
    token: '123:fixture',
    texts: botTexts,
    drafts: createD1DraftStore(db),
    resolveTenant: (id) => (id === 1 ? 'tenant' : id === 2 ? 'other' : undefined),
    translator: { translate: vi.fn() },
    publishRunner: { run: vi.fn() },
    background: (task) => {
      tasks.push(task);
    },
    comments: {
      store,
      capabilities: { [network]: capability },
      context: { secrets: { resolve: async () => '' } },
    },
  });
  const calls = mockTelegramApi(bot);
  await bot.init();
  const click = (action: string, user = 1, id = 'c1', chat = user) =>
    bot.handleUpdate(callbackQueryUpdate(user, chat, `comment:${network}:${id}:${action}`));
  const flush = async () => {
    while (tasks.length) await tasks.shift()!();
  };
  const row = (tenantId = 'tenant', id = 'c1') => store.get(tenantId, network, id);
  return { db, store, bot, calls, reply, tasks, add, click, flush, row, network };
}

describe.each(['instagram', 'facebook'] as const)('comment session: %s', (network) => {
  it('serializes racing sends and scrubs handled reader data while retaining dedupe', async () => {
    const s = await setup(network);
    await Promise.all([s.click('send'), s.click('send'), s.click('skip')]);
    await s.flush();
    // Either skip or send wins; never two external replies.
    expect(s.reply.mock.calls.length).toBeLessThanOrEqual(1);
    expect(['sent', 'skipped']).toContain((await s.row())?.status);
    expect(await s.row()).toMatchObject({ handle: '', text: '', replyDe: null });
    await s.click('send');
    await s.flush();
    expect(s.reply.mock.calls.length).toBeLessThanOrEqual(1);
  });
  it('sends the claimed draft once and ignores subsequent old buttons', async () => {
    const s = await setup(network);
    await Promise.all([s.click('send'), s.click('send')]);
    expect(s.tasks).toHaveLength(1);
    await s.flush();
    await s.click('send');
    await s.flush();
    expect(s.reply).toHaveBeenCalledExactlyOnceWith('c1', 'Danke!', expect.any(Object));
    expect((await s.row())?.status).toBe('sent');
  });
  it('reopens confirmed rejection, then permits a successful author retry', async () => {
    const s = await setup(network);
    s.reply.mockRejectedValueOnce(new CommentReplyRejectedError());
    await s.click('send');
    await s.flush();
    expect((await s.row())?.status).toBe('drafted');
    expect(sentTexts(s.calls)).toContain(botTexts.commentSendFailed);
    await s.click('send');
    await s.flush();
    expect(s.reply).toHaveBeenCalledTimes(2);
    expect((await s.row())?.status).toBe('sent');
  });
  it('quarantines stale ambiguous sends without another external call', async () => {
    const s = await setup(network);
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      s.reply.mockRejectedValueOnce(new Error('private reader data'));
      await s.click('send');
      await s.flush();
      expect((await s.row())?.status).toBe('sending');
      expect(sentTexts(s.calls)).toContain(botTexts.commentSendUncertain);
      expect(JSON.stringify(log.mock.calls)).not.toContain('private reader data');
      expect(await s.store.reclaimSending('other', new Date(Date.now() + 1), new Date())).toBe(0);
      expect(await s.store.reclaimSending('tenant', new Date(0), new Date())).toBe(0);
      expect(await s.store.reclaimSending('tenant', new Date(Date.now() + 1), new Date())).toBe(1);
      await s.click('send');
      await s.flush();
      expect(s.reply).toHaveBeenCalledTimes(1);
      expect(await s.row()).toMatchObject({
        status: 'skipped',
        handle: '',
        text: '',
        replyDe: null,
      });
    } finally {
      log.mockRestore();
    }
  });
  it('edits only the last armed comment for this tenant and chat, then sends the edit', async () => {
    const s = await setup(network);
    await s.add('c2');
    await s.click('edit');
    await s.click('edit', 1, 'c2');
    expect(await s.store.applyEdit('other', '1', 'wrong tenant', new Date())).toBeNull();
    expect(await s.store.applyEdit('tenant', '8', 'wrong chat', new Date())).toBeNull();
    await s.bot.handleUpdate(textUpdate(1, 'Vielen Dank!'));
    expect((await s.row('tenant', 'c2'))?.replyDe).toBe('Vielen Dank!');
    expect((await s.row())?.replyDe).toBe('Danke!');
    expect(sentTexts(s.calls).at(-1)).toContain('Vielen Dank!');
    await s.click('send', 1, 'c2');
    await s.flush();
    expect(s.reply).toHaveBeenCalledExactlyOnceWith('c2', 'Vielen Dank!', expect.any(Object));
  });
  it('sanitizes card delivery errors so reader text cannot reach Worker logs', async () => {
    const s = await setup(network);
    await s.click('edit');
    s.bot.api.config.use(async () => {
      throw new Error('private reader text');
    });
    const error = await s.bot.handleUpdate(textUpdate(1, 'Neue Antwort')).catch((e: unknown) => e);
    expect(String(error)).toContain('comment card delivery failed');
    expect(String(error)).not.toContain('private reader text');
    expect((await s.row())?.replyDe).toBe('Neue Antwort');
  });
  it('expires edit arms at 30 minutes and survives a new store instance', async () => {
    const s = await setup(network);
    const now = new Date();
    await s.store.armEdit('tenant', network, 'c1', '1', now);
    expect(
      await createCommentStore(s.db).applyEdit(
        'tenant',
        '1',
        'late',
        new Date(now.getTime() + 1800000),
      ),
    ).toBeNull();
    expect(
      await createCommentStore(s.db).applyEdit(
        'tenant',
        '1',
        'in time',
        new Date(now.getTime() + 1799999),
      ),
    ).toMatchObject({ replyDe: 'in time' });
  });
  it('clears an edit arm on skip; retention deletes its tombstone', async () => {
    const s = await setup(network);
    await s.click('edit');
    await s.click('skip');
    expect(await s.store.applyEdit('tenant', '1', 'late', new Date())).toBeNull();
    expect(await s.row()).toMatchObject({ status: 'skipped', handle: '', text: '', replyDe: null });
    expect(await s.store.deleteOlderThan(new Date(Date.now() + 30 * 86400000))).toBe(1);
    expect(await s.row()).toBeNull();
  });
  it('keeps unknown senders and other tenants outside the inbox', async () => {
    const s = await setup(network);
    await s.click('send', 99);
    await s.click('edit', 99);
    await s.bot.handleUpdate(textUpdate(99, 'private text'));
    await s.click('send', 2);
    await s.click('skip', 2);
    await s.flush();
    expect(s.reply).not.toHaveBeenCalled();
    expect((await s.row())?.status).toBe('drafted');
    expect(sentTexts(s.calls)).toContain(botTexts.refusalText);
  });
});
