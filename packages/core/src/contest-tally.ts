import type { PollResult } from './ports/channel';

/** Anonymous counts only; unreadable is deliberately distinct from zero votes. */
export type SourceTally =
  | { status: 'counted'; counts: number[]; total: number }
  | { status: 'unreadable' }
  | { status: 'skipped' };
export type ContestTally = (
  { status: 'counted'; counts: number[]; total: number } | { status: 'unreadable' }
) & { sources?: Record<string, SourceTally> };

export function validateContestTally(result: PollResult, candidates: number): ContestTally {
  if (
    candidates < 2 ||
    candidates > 10 ||
    result.optionVotes.length !== candidates ||
    !Number.isSafeInteger(result.totalVotes) ||
    result.totalVotes < 0 ||
    result.optionVotes.some((n) => !Number.isSafeInteger(n) || n < 0) ||
    result.optionVotes.reduce((sum, n) => sum + n, 0) !== result.totalVotes
  )
    throw new Error('Invalid contest tally');
  return { status: 'counted', counts: [...result.optionVotes], total: result.totalVotes };
}

/** A singleton is an automatic winner; all other cases require author selection. */
export function contestLeaders(tally: ContestTally, entries: readonly string[]): string[] {
  if (tally.status === 'unreadable') return [...entries];
  validateContestTally({ optionVotes: tally.counts, totalVotes: tally.total }, entries.length);
  const maximum = Math.max(...tally.counts);
  return entries.filter((_, i) => tally.counts[i] === maximum);
}
