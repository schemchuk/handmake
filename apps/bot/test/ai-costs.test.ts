import { beforeEach, describe, expect, it } from 'vitest';
import { assertCanStartShow, costMonth, createAiCostLedger, formatCosts } from '../src/ai-costs';
import type { AiCostLedger } from '../src/ai-costs';
import { makeD1 } from './helpers';

let ledger: AiCostLedger;
const now = new Date('2026-10-31T12:00:00Z');
const budget = { monthlyTargetEur: 20, toleranceEur: 5 };
beforeEach(async () => {
  ledger = createAiCostLedger(await makeD1());
});
async function book(
  id: string,
  amountEur: number,
  service = 'image',
  ref = 'show:a',
  at = now,
  tenant = 'one',
) {
  await ledger.recordCost(tenant, { id, at, amountEur, service, ref, unit: 'image' });
}

describe('AI cost ledger', () => {
  it('aggregates a fixture month by tenant, service and show, preserving small costs', async () => {
    await book('1', 12);
    await book('1', 12); // Retry of the same accounting write.
    await book('2', 3, 'video', 'show:a');
    await book('3', 2, 'image', 'show:b');
    await book('4', 0.000001, 'translation', 'post:c');
    await book('5', 100, 'video', 'show:a', now, 'other');
    await book('6', 100, 'video', 'show:a', new Date('2026-09-30T21:59:59Z'));
    await book('7', 100, 'video', 'show:a', new Date('2026-10-31T23:00:00Z'));
    const summary = await ledger.summary('one', now);
    expect(summary.total).toBeCloseTo(17.000001, 6);
    expect(summary.services).toEqual({ image: 14, video: 3, translation: 0.000001 });
    expect(summary.shows).toEqual({ 'show:a': 15, 'show:b': 2 });
    expect(formatCosts(summary, budget)).toContain('До ліміту: 8.0000 EUR');
  });

  it('blocks shows exactly at the cap and resets at the Berlin month boundary', async () => {
    await book('1', 20);
    await expect(assertCanStartShow(ledger, 'one', budget, now)).resolves.toBeUndefined();
    await book('2', 4.99);
    await expect(assertCanStartShow(ledger, 'one', budget, now)).resolves.toBeUndefined();
    await book('3', 0.01);
    await expect(assertCanStartShow(ledger, 'one', budget, now)).rejects.toThrow(
      'наступного місяця',
    );
    await expect(
      assertCanStartShow(ledger, 'one', budget, new Date('2026-10-31T23:00:00Z')),
    ).resolves.toBeUndefined();
  });

  it('does not let floating point summation bypass the cap', async () => {
    for (let i = 0; i < 35; i++) await book(String(i), 0.7);
    await book('remainder', 0.5);
    expect((await ledger.summary('one', now)).total).toBe(25);
    await expect(assertCanStartShow(ledger, 'one', budget, now)).rejects.toThrow();
  });

  it('claims each notice once per tenant, with retry after delivery failure', async () => {
    expect(await ledger.claimNotice('one', 'target:2026-10')).toBe(true);
    expect(await ledger.claimNotice('one', 'target:2026-10')).toBe(false);
    expect(await ledger.claimNotice('other', 'target:2026-10')).toBe(true);
    await ledger.releaseNotice('one', 'target:2026-10');
    expect(await ledger.claimNotice('one', 'target:2026-10')).toBe(true);
  });

  it.each([-1, NaN, Infinity])('rejects invalid cost %s', async (amount) => {
    await expect(book('bad', amount)).rejects.toThrow('finite non-negative');
  });
});

it.each([
  ['2026-03-31T22:00:00Z', '2026-03-31T22:00:00.000Z', '2026-04-30T22:00:00.000Z', '2026-04'],
  ['2026-10-31T22:59:59Z', '2026-09-30T22:00:00.000Z', '2026-10-31T23:00:00.000Z', '2026-10'],
  ['2026-12-31T23:00:00Z', '2026-12-31T23:00:00.000Z', '2027-01-31T23:00:00.000Z', '2027-01'],
])('uses Berlin calendar month at %s', (instant, start, end, key) => {
  expect(costMonth(new Date(instant))).toMatchObject({ start, end, key });
});

it('selects the previous month for the first-day summary, including year rollover', () => {
  expect(costMonth(new Date('2026-12-31T23:00:00Z'), -1)).toMatchObject({
    key: '2026-12',
    start: '2026-11-30T23:00:00.000Z',
    end: '2026-12-31T23:00:00.000Z',
    firstDay: true,
  });
});
