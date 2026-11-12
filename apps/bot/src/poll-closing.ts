import { validateContestTally } from '@handmake/core';
import type { ChannelAdapter, ContestTally, DeliverContext } from '@handmake/core';
import { createPollClosingStore, findClosingPoll } from './poll-closing-store';
import { collectContestVotes, type ContestVoteSource } from './contest-votes';

/** Snapshot and close a published ballot once; interrupted claims recover unreadable. */
export async function closeContestPoll(
  db: D1Database,
  tenant: string,
  week: string,
  adapter: ChannelAdapter,
  context: DeliverContext,
  now: number,
  sources: readonly ContestVoteSource[] = [],
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
  // One deadline covers stopPoll and all sequential comment reads, below the
  // five-minute lease. Late readers have no persistence path.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  const deadline = new Promise<ContestTally>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ status: 'unreadable' });
    }, 120_000);
  });
  const collect = async (): Promise<ContestTally> => {
    let tally: ContestTally;
    try {
      tally = validateContestTally(
        await adapter.closePoll!(poll.pollId, context),
        poll.entryRefs.length,
      );
    } catch {
      // A transport failure may mean the stop succeeded. Never fabricate zero votes.
      return { status: 'unreadable' };
    }
    if (tally.status === 'unreadable' || !sources.length) return tally;
    controller.signal.throwIfAborted();
    return collectContestVotes(db, poll, tally, sources, controller.signal);
  };
  try {
    const tally = await Promise.race([collect(), deadline]);
    // Persistence errors must escape: a later invocation recovers the durable claim.
    await store.finish(tenant, week, claim, tally);
  } finally {
    clearTimeout(timer);
  }
}
