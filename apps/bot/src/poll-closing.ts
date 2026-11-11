import { validateContestTally } from '@handmake/core';
import type { ChannelAdapter, ContestTally, DeliverContext } from '@handmake/core';
import { createPollClosingStore, findClosingPoll } from './poll-closing-store';

/** T31d will wire scheduling and author selection. This module has no cron caller yet. */
export async function closeContestPoll(
  db: D1Database,
  tenant: string,
  week: string,
  adapter: ChannelAdapter,
  context: DeliverContext,
  now: number,
): Promise<void> {
  if (!adapter.capabilities.polls || !adapter.closePoll) return;
  const store = createPollClosingStore(db);
  if (await store.get(tenant, week)) {
    await store.recover(tenant, week, now);
    return;
  }
  const poll = await findClosingPoll(db, tenant, week, adapter.key);
  if (!poll) return;
  const claim = await store.claim(poll, now);
  if (!claim) return;
  let tally: ContestTally;
  try {
    tally = validateContestTally(
      await adapter.closePoll(poll.pollId, context),
      poll.entryRefs.length,
    );
  } catch {
    // A transport failure may mean the stop succeeded. Never fabricate zero votes.
    tally = { status: 'unreadable' };
  }
  // Persistence errors must escape: a later invocation recovers the durable claim.
  await store.finish(tenant, week, claim, tally);
}
