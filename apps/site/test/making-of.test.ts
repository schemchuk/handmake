import { describe, expect, it } from 'vitest';
import { ledgerStats } from '../src/lib/making-of';
import type { PublishLedger } from '@handmake/core';

const ledger = (
  tenantId: string,
  statuses: Record<string, 'done' | 'pending' | 'failed'>,
): PublishLedger => ({
  tenantId,
  postId: 'fixture',
  channels: Object.fromEntries(
    Object.entries(statuses).map(([key, status]) => [
      key,
      { status, remoteIds: [1, 2], updatedAt: '2026-11-14T00:00:00Z' },
    ]),
  ),
});
describe('ledger statistics', () => {
  it('handles an empty history', () => {
    expect(ledgerStats([], 'fixture')).toEqual({ published: 0, deliveries: 0, networks: 0 });
  });
  it('counts completed entries once, sees pending networks and isolates tenants', () => {
    expect(
      ledgerStats(
        [
          ledger('fixture', { telegram: 'done', instagram: 'done' }),
          ledger('fixture', { telegram: 'failed', threads: 'pending' }),
          ledger('fixture', { telegram: 'done' }),
          ledger('other', { facebook: 'done' }),
        ],
        'fixture',
      ),
    ).toEqual({ published: 2, deliveries: 3, networks: 3 });
  });
});
