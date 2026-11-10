import { GrammyError, type Bot } from 'grammy';

import type {
  ChannelCommentsCapability,
  ChannelCommentsContext,
  CommentDraft,
  CommentDrafter,
} from '@handmake/core';

import type { AllowList } from './allow-list';
import type { AppContext } from './context';
import {
  commentReplyTooLong,
  commentRetentionDays,
  type CommentNetwork,
  type CommentStore,
} from './comment-store';
import type { BotTexts } from './texts';
import type { TenantConfigSource } from './tenant-config-source';

export const collectPostLimit = 25;

const networkLabels: Record<CommentNetwork, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  threads: 'Threads',
};

export interface CommentCollectOptions {
  store: CommentStore;
  tenantConfigs: TenantConfigSource;
  allowList: AllowList;
  capabilities: Partial<Record<CommentNetwork, ChannelCommentsCapability>>;
  commentsContext: ChannelCommentsContext;
  drafterFor: (tenantId: string, commentId: string) => Promise<CommentDrafter>;
  bot: Bot<AppContext>;
  texts: BotTexts;
}

export async function runCommentCollect(now: Date, options: CommentCollectOptions): Promise<void> {
  const authorsByTenant = new Map<string, number>();
  for (const [userId, tenantId] of options.allowList) {
    if (!authorsByTenant.has(tenantId)) authorsByTenant.set(tenantId, userId);
  }
  for (const [tenantId, authorId] of authorsByTenant) {
    try {
      await collectTenant(now, tenantId, authorId, options);
    } catch {
      console.error('comment tenant collection failed');
    }
  }
}

async function collectTenant(
  now: Date,
  tenantId: string,
  authorId: number,
  options: CommentCollectOptions,
): Promise<void> {
  const uncertain = await options.store.countUncertain(tenantId, new Date(now.getTime() - 3600000));
  if (uncertain.drafting) console.warn('comment reconciliation required', uncertain);
  const reclaimed = await options.store.reclaimSending(
    tenantId,
    new Date(now.getTime() - 3600000),
    now,
  );
  if (reclaimed) {
    console.warn('comment sends quarantined', { count: reclaimed });
    try {
      await options.bot.api.sendMessage(String(authorId), options.texts.commentSendReclaimed);
    } catch {
      console.warn('comment quarantine warning failed', { count: reclaimed });
    }
  }
  const config = await options.tenantConfigs.load(tenantId);
  const networks: CommentNetwork[] = [];
  if (config.channels.instagram && options.capabilities.instagram) networks.push('instagram');
  if (config.channels.threads && options.capabilities.threads) networks.push('threads');
  if (config.channels.facebook && options.capabilities.facebook) networks.push('facebook');
  if (networks.length === 0) return;
  await notifyPending(now, tenantId, authorId, options);
  for (const network of networks) {
    try {
      await collectNetwork(now, tenantId, network, authorId, options);
    } catch {
      console.error(`comment collection failed: ${network}`);
    }
  }
}

async function collectNetwork(
  now: Date,
  tenantId: string,
  network: CommentNetwork,
  authorId: number,
  options: CommentCollectOptions,
): Promise<void> {
  const capability = options.capabilities[network]!;
  const since = await options.store.getWatermark(tenantId, network);
  let watermark = since;
  const cutoff = now.getTime() - commentRetentionDays * 86400000;
  try {
    const posts = await capability.listPosts(collectPostLimit, options.commentsContext);
    for (const post of posts) {
      const comments = await capability
        .listComments(post.id, since, options.commentsContext)
        .catch(() => {
          console.error(`comment post scan failed; network watermark retained: ${network}`);
          throw new Error('comment post scan failed');
        });
      for (const comment of comments) {
        const created = Date.parse(comment.createdAt);
        if (!Number.isFinite(created) || created < cutoff) continue;
        if (watermark === undefined || created > watermark.getTime()) {
          watermark = new Date(created);
        }
        await options.store.collect({
          tenantId,
          network,
          id: comment.id,
          postId: post.id,
          handle: comment.handle,
          text: comment.text,
          commentCreatedAt: comment.createdAt,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  } finally {
    for (const row of await options.store.listPendingDrafts(tenantId, network)) {
      const created = Date.parse(row.commentCreatedAt);
      if (!Number.isFinite(created) || created < cutoff) continue;
      try {
        await draftAndNotify(now, tenantId, network, row.postId, row, authorId, options);
      } catch {
        console.error(`comment drafting failed: ${network}`);
      }
    }
  }
  if (watermark !== undefined && (since === undefined || watermark > since)) {
    await options.store.setWatermark(tenantId, network, watermark, now);
  }
}

async function draftAndNotify(
  now: Date,
  tenantId: string,
  network: CommentNetwork,
  postId: string,
  comment: { id: string; handle: string; text: string },
  authorId: number,
  options: CommentCollectOptions,
): Promise<void> {
  const claimed = await options.store.claimDrafting(tenantId, network, comment.id, now);
  if (!claimed) return;
  let draft: CommentDraft;
  try {
    const drafter = await options.drafterFor(tenantId, comment.id);
    draft = await drafter.draft({
      network,
      handle: comment.handle,
      text: comment.text,
      postId,
    });
  } catch {
    await options.store.reopenDrafting(tenantId, network, comment.id, now);
    throw new Error('comment drafting failed');
  }
  if (!(await options.store.storeDraft(tenantId, network, comment.id, draft, now))) return;
  await notifyAuthor(now, tenantId, { network, ...comment }, draft, authorId, options);
}

async function notifyPending(
  now: Date,
  tenantId: string,
  authorId: number,
  options: CommentCollectOptions,
): Promise<void> {
  const pending = await options.store.listPendingNotify(tenantId);
  for (const row of pending) {
    try {
      await notifyAuthor(
        now,
        tenantId,
        row,
        {
          translationUk: row.translationUk ?? '',
          replyDe: row.replyDe ?? '',
          notesUk: row.notesUk ?? '',
        },
        authorId,
        options,
      );
    } catch {
      console.error('comment card delivery failed');
    }
  }
}

async function notifyAuthor(
  now: Date,
  tenantId: string,
  comment: { network: CommentNetwork; id: string; handle: string; text: string },
  draft: CommentDraft,
  authorId: number,
  options: CommentCollectOptions,
): Promise<void> {
  const card = buildCommentCard(comment, draft, options.texts);
  if (!(await options.store.markNotified(tenantId, comment.network, comment.id, now))) return;
  try {
    await options.bot.api.sendMessage(String(authorId), card.text.slice(0, 4096), {
      reply_markup: card.keyboard,
    });
  } catch (error) {
    if (error instanceof GrammyError) {
      await options.store.reopenNotification(
        tenantId,
        comment.network,
        comment.id,
        now,
        new Date(),
      );
    }
    throw new Error('comment card delivery failed');
  }
}

export function buildCommentCard(
  comment: { network: CommentNetwork; id: string; handle: string; text: string },
  draft: CommentDraft,
  texts: BotTexts,
): { text: string; keyboard: { inline_keyboard: { text: string; callback_data: string }[][] } } {
  // Reserve space for the full 2200-unit edited reply; only context is abbreviated.
  const lines = [
    texts.commentCardHeader(networkLabels[comment.network], comment.handle.slice(0, 64)),
    '',
    texts.commentCardCommentLabel,
    comment.text.slice(0, 512),
    '',
    texts.commentCardTranslationLabel,
    draft.translationUk.slice(0, 512),
    '',
    texts.commentCardReplyLabel,
    draft.replyDe === '' ? texts.commentCardNoReply : draft.replyDe,
  ];
  if (draft.notesUk.trim() !== '') {
    lines.push('', texts.commentCardNotesLabel, draft.notesUk.slice(0, 256));
  }
  const tooLong = commentReplyTooLong(comment.network, draft.replyDe);
  if (tooLong) lines.push('', texts.commentReplyTooLong(comment.network));
  const data = (action: string) => {
    const value = `comment:${comment.network}:${comment.id}:${action}`;
    if (comment.id.includes(':') || new TextEncoder().encode(value).length > 64)
      throw new Error('comment callback exceeds supported format');
    return value;
  };
  return {
    text: lines.join('\n'),
    keyboard: {
      inline_keyboard: [
        [
          ...(!tooLong ? [{ text: texts.commentSendButton, callback_data: data('send') }] : []),
          { text: texts.commentEditButton, callback_data: data('edit') },
          { text: texts.commentSkipButton, callback_data: data('skip') },
        ],
      ],
    },
  };
}
