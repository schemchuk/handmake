import { expect, it } from 'vitest';
import { contestLeaders, validateContestTally } from '../src/contest-tally';

it.each([
  [
    [0, 0],
    ['a', 'b'],
  ],
  [
    [3, 3],
    ['a', 'b'],
  ],
  [[1, 4], ['b']],
])('selects leaders for %j', (counts, expected) => {
  const tally = validateContestTally(
    {
      optionVotes: counts as number[],
      totalVotes: (counts as number[]).reduce((a, b) => a + b, 0),
    },
    2,
  );
  expect(contestLeaders(tally, ['a', 'b'])).toEqual(expected);
});
it('keeps unreadable results available for author selection', () => {
  expect(contestLeaders({ status: 'unreadable' }, ['b', 'a'])).toEqual(['b', 'a']);
});
it.each([[1], [-1, 2], [0.5, 0.5], [NaN, 0], [Infinity, 0], [Number.MAX_SAFE_INTEGER + 1, 0]])(
  'rejects invalid counts %j',
  (...counts) => {
    expect(() => validateContestTally({ optionVotes: counts, totalVotes: 1 }, 2)).toThrow();
  },
);
it('rejects inconsistent totals', () => {
  expect(() => validateContestTally({ optionVotes: [1, 2], totalVotes: 2 }, 2)).toThrow();
});
