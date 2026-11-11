import { expect, it } from 'vitest';
import { contestWeek } from '../src/contest';

it.each([
  ['2026-11-08T22:59:59Z', '2026-11-02'],
  ['2026-11-08T23:00:00Z', '2026-11-09'],
  ['2026-07-05T21:59:59Z', '2026-06-29'],
  ['2026-07-05T22:00:00Z', '2026-07-06'],
  ['2026-03-29T00:59:59Z', '2026-03-23'],
  ['2026-03-29T01:00:00Z', '2026-03-23'],
  ['2026-10-25T00:59:59Z', '2026-10-19'],
  ['2026-10-25T01:00:00Z', '2026-10-19'],
  ['2027-01-01T12:00:00Z', '2026-12-28'],
  ['2027-01-03T23:00:00Z', '2027-01-04'],
])('buckets %s into Berlin Monday %s', (instant, week) => {
  expect(contestWeek(new Date(instant))).toBe(week);
});
it('rejects invalid instants', () => {
  expect(() => contestWeek(new Date('invalid'))).toThrow('Invalid contest date');
});
