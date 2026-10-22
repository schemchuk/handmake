import { describe, expect, it } from 'vitest';

import {
  initLedger,
  LedgerParseError,
  markDone,
  markFailed,
  parseLedger,
  pendingChannels,
  serializeLedger,
} from '../src/ledger';

const t0 = new Date('2026-10-23T12:00:00Z');
const t1 = new Date('2026-10-23T12:01:00Z');
const t2 = new Date('2026-10-23T12:02:00Z');

const post = { channels: ['telegram', 'instagram'] };

describe('initLedger', () => {
  it('creates a pending entry for every channel', () => {
    const ledger = initLedger('tenant', 'post-1', post.channels, t0);
    expect(ledger).toEqual({
      tenantId: 'tenant',
      postId: 'post-1',
      channels: {
        telegram: { status: 'pending', remoteIds: [], updatedAt: t0.toISOString() },
        instagram: { status: 'pending', remoteIds: [], updatedAt: t0.toISOString() },
      },
    });
  });
});

describe('pendingChannels', () => {
  it('returns all channels of a fresh ledger', () => {
    const ledger = initLedger('tenant', 'post-1', post.channels, t0);
    expect(pendingChannels(ledger, post)).toEqual(['telegram', 'instagram']);
  });

  it('never returns a done channel', () => {
    const ledger = markDone(initLedger('tenant', 'post-1', post.channels, t0), 'telegram', [7], t1);
    expect(pendingChannels(ledger, post)).toEqual(['instagram']);
  });

  it('returns a failed channel again for retry (F11)', () => {
    const failed = markFailed(initLedger('t', 'p', post.channels, t0), 'instagram', 'boom', t1);
    expect(pendingChannels(failed, post)).toEqual(['telegram', 'instagram']);
  });

  it('ignores ledger entries for channels the post no longer lists', () => {
    const ledger = markFailed(
      initLedger('t', 'p', ['telegram', 'old-channel'], t0),
      'old-channel',
      'x',
      t1,
    );
    expect(pendingChannels(ledger, post)).toEqual(['telegram', 'instagram']);
  });
});

describe('markDone / markFailed transitions', () => {
  it('markDone records remote ids and timestamp, immutably', () => {
    const ledger = initLedger('t', 'p', post.channels, t0);
    const done = markDone(ledger, 'telegram', [11, 12], t1);
    expect(done.channels.telegram).toEqual({
      status: 'done',
      remoteIds: [11, 12],
      updatedAt: t1.toISOString(),
    });
    expect(ledger.channels.telegram!.status).toBe('pending'); // original untouched
  });

  it('markFailed keeps the last error', () => {
    let ledger = initLedger('t', 'p', post.channels, t0);
    ledger = markFailed(ledger, 'telegram', 'first failure', t1);
    ledger = markFailed(ledger, 'telegram', 'second failure', t2);
    expect(ledger.channels.telegram).toEqual({
      status: 'failed',
      remoteIds: [],
      error: 'second failure',
      updatedAt: t2.toISOString(),
    });
  });

  it('markFailed preserves remote ids from a partial delivery', () => {
    let ledger = initLedger('t', 'p', post.channels, t0);
    ledger = {
      ...ledger,
      channels: { ...ledger.channels, telegram: { ...ledger.channels.telegram!, remoteIds: [5] } },
    };
    ledger = markFailed(ledger, 'telegram', 'caption op failed', t1);
    expect(ledger.channels.telegram!.remoteIds).toEqual([5]);
  });

  it('supports the re-run flow: partial failure, then finish', () => {
    // First run: telegram done, instagram fails after delivery started.
    let ledger = initLedger('t', 'p', post.channels, t0);
    ledger = markDone(ledger, 'telegram', [21], t1);
    ledger = markFailed(ledger, 'instagram', 'HTTP 500', t1);

    // Re-run sends only instagram.
    expect(pendingChannels(ledger, post)).toEqual(['instagram']);
    ledger = markDone(ledger, 'instagram', [99], t2);
    expect(pendingChannels(ledger, post)).toEqual([]);
    expect(ledger.channels.telegram!.remoteIds).toEqual([21]); // untouched
  });
});

describe('JSON (de)serialization', () => {
  it('round-trips a ledger', () => {
    let ledger = initLedger('t', 'p', post.channels, t0);
    ledger = markDone(ledger, 'telegram', [1, 'two'], t1);
    ledger = markFailed(ledger, 'instagram', 'nope', t1);
    expect(parseLedger(serializeLedger(ledger))).toEqual(ledger);
  });

  it('rejects invalid JSON', () => {
    expect(() => parseLedger('not json')).toThrowError(LedgerParseError);
    expect(() => parseLedger('not json')).toThrowError(/not valid JSON/);
  });

  it('rejects a ledger missing channels', () => {
    expect(() => parseLedger('{"tenantId":"t","postId":"p"}')).toThrowError(/channels/);
  });

  it('rejects an unknown status', () => {
    const bad = JSON.stringify({
      tenantId: 't',
      postId: 'p',
      channels: { telegram: { status: 'unknown', remoteIds: [], updatedAt: 'x' } },
    });
    expect(() => parseLedger(bad)).toThrowError(/status/);
  });
});
