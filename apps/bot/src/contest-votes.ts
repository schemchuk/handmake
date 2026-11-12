import { validateContestTally } from '@handmake/core';
import type {
  ChannelAdapter,
  ChannelComment,
  ChannelCommentsContext,
  ContestTally,
  SourceTally,
} from '@handmake/core';
import type { ClosingPoll } from './poll-closing-store';

export interface ContestVoteSource {
  adapter: ChannelAdapter;
  context: ChannelCommentsContext;
}

/** Pure transient reduction; only anonymous counts leave this function. */
export function countCommentVotes(
  comments: ChannelComment[],
  candidates: number,
  network: string,
): ContestTally {
  const seen = new Map<string, ChannelComment>();
  for (const comment of comments) {
    const previous = seen.get(comment.id);
    if (
      !comment.id ||
      (previous &&
        (previous.text !== comment.text ||
          previous.handle !== comment.handle ||
          previous.accountId !== comment.accountId ||
          previous.createdAt !== comment.createdAt))
    )
      return { status: 'unreadable' };
    seen.set(comment.id, comment);
  }
  const time = (comment: ChannelComment): number => {
    const parsed = Date.parse(comment.createdAt);
    return Number.isNaN(parsed) ? Infinity : parsed;
  };
  const ordered = [...seen.values()].sort((a, b) => {
    if (time(a) !== time(b)) return time(a) < time(b) ? -1 : 1;
    return a.id < b.id ? -1 : a.id === b.id ? 0 : 1;
  });
  const accounts = new Set<string>();
  const counts = Array<number>(candidates).fill(0);
  for (const comment of ordered) {
    const text = comment.text.trim();
    if (!/^(?:[1-9]|10)$/.test(text) || Number(text) > candidates) continue;
    const account =
      network === 'facebook' ? comment.accountId : comment.handle.trim().toLowerCase();
    if (!account) return { status: 'unreadable' };
    if (accounts.has(account)) continue;
    accounts.add(account);
    counts[Number(text) - 1]! += 1;
  }
  return validateContestTally(
    { optionVotes: counts, totalVotes: counts.reduce((sum, n) => sum + n, 0) },
    candidates,
  );
}

/** Reads only the ballot's actual deliveries, never the persisted comment inbox. */
export async function collectContestVotes(
  db: D1Database,
  poll: ClosingPoll,
  telegram: ContestTally,
  sources: readonly ContestVoteSource[],
  signal?: AbortSignal,
): Promise<ContestTally> {
  if (telegram.status === 'unreadable') return telegram;
  const tallies: Record<string, SourceTally> = { [poll.channel]: telegram };
  for (const { adapter, context } of sources) {
    signal?.throwIfAborted();
    const key = adapter.key;
    if (!['instagram', 'facebook', 'threads'].includes(key) || key in tallies)
      throw new Error('Invalid contest vote source configuration');
    const delivery = await db
      .prepare(
        `SELECT status, message_ids FROM channel_deliveries
         WHERE tenant_id = ? AND post_id = ? AND channel = ?`,
      )
      .bind(poll.tenantId, poll.postId, key)
      .first<{ status: string; message_ids: string }>();
    if (!delivery || delivery.status !== 'done') {
      tallies[key] = { status: 'skipped' };
      continue;
    }
    signal?.throwIfAborted();
    try {
      const id = (JSON.parse(delivery.message_ids) as { main?: unknown }).main;
      if (
        !adapter.comments ||
        !(
          (typeof id === 'string' && id.length > 0) ||
          (typeof id === 'number' && Number.isSafeInteger(id) && id > 0)
        )
      )
        throw new Error('Unreadable contest source');
      tallies[key] = countCommentVotes(
        await adapter.comments.listComments(id, undefined, {
          ...context,
          excludeOwnerComments: true,
        }),
        poll.entryRefs.length,
        key,
      );
    } catch {
      // Discard all partial data and diagnostics, including reader identifiers.
      tallies[key] = { status: 'unreadable' };
    }
  }
  if (Object.values(tallies).some((tally) => tally.status === 'unreadable'))
    return { status: 'unreadable', sources: tallies };
  const counts = Array<number>(poll.entryRefs.length).fill(0);
  for (const tally of Object.values(tallies))
    if (tally.status === 'counted') tally.counts.forEach((n, i) => (counts[i]! += n));
  return {
    ...validateContestTally(
      { optionVotes: counts, totalVotes: counts.reduce((sum, n) => sum + n, 0) },
      counts.length,
    ),
    sources: tallies,
  };
}
