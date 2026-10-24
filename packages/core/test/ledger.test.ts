import { describe, expect, it } from 'vitest';

import {
  initLedger,
  LedgerParseError,
  LedgerTransitionError,
  markDone,
  markFailed,
  markOpDelivered,
  nextOpIndex,
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
    let ledger = initLedger('tenant', 'post-1', post.channels, t0);
    ledger = markOpDelivered(ledger, 'telegram', 0, 7, t1);
    ledger = markDone(ledger, 'telegram', t1);
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

describe('operation-granular delivery', () => {
  it('records each delivered op in order', () => {
    let ledger = initLedger('t', 'p', post.channels, t0);
    ledger = markOpDelivered(ledger, 'telegram', 0, 100, t1);
    ledger = markOpDelivered(ledger, 'telegram', 1, 101, t2);
    expect(ledger.channels.telegram).toEqual({
      status: 'pending',
      remoteIds: [100, 101],
      updatedAt: t2.toISOString(),
    });
  });

  it('rejects a gap in the op sequence', () => {
    const ledger = initLedger('t', 'p', post.channels, t0);
    expect(() => markOpDelivered(ledger, 'telegram', 1, 101, t1)).toThrowError(
      LedgerTransitionError,
    );
    expect(() => markOpDelivered(ledger, 'telegram', 1, 101, t1)).toThrowError(/next op is 0/);
  });

  it('markDone preserves recorded ids and requires an entry', () => {
    let ledger = initLedger('t', 'p', post.channels, t0);
    ledger = markOpDelivered(ledger, 'telegram', 0, 100, t1);
    ledger = markDone(ledger, 'telegram', t2);
    expect(ledger.channels.telegram).toEqual({
      status: 'done',
      remoteIds: [100],
      updatedAt: t2.toISOString(),
    });
    expect(() => markDone(ledger, 'unknown-channel', t2)).toThrowError(/no ledger entry/);
  });
});

describe('failure and re-run flow', () => {
  it('records op 0, fails on op 1, resumes without duplicating op 0', () => {
    // First run: album (op 0) delivered, DE reply (op 1) fails.
    let ledger = initLedger('t', 'p', post.channels, t0);
    ledger = markOpDelivered(ledger, 'telegram', 0, 100, t1);
    ledger = markFailed(ledger, 'telegram', 'HTTP 500 on op 1', t1);

    // The remote id of op 0 survives the failure…
    expect(ledger.channels.telegram!.remoteIds).toEqual([100]);
    expect(ledger.channels.telegram!.error).toBe('HTTP 500 on op 1');
    // …and a re-run resumes at op 1, with op 0's id available for replyToOp.
    expect(nextOpIndex(ledger, 'telegram')).toBe(1);
    const albumMessageId = ledger.channels.telegram!.remoteIds[0];
    expect(albumMessageId).toBe(100);

    // Re-run delivers only op 1 and finishes the channel.
    expect(pendingChannels(ledger, post)).toEqual(['telegram', 'instagram']);
    ledger = markOpDelivered(ledger, 'telegram', 1, 101, t2);
    expect(nextOpIndex(ledger, 'telegram')).toBe(2);
    ledger = markDone(ledger, 'telegram', t2);
    expect(pendingChannels(ledger, post)).toEqual(['instagram']);
    expect(ledger.channels.telegram).toEqual({
      status: 'done',
      remoteIds: [100, 101],
      updatedAt: t2.toISOString(),
    });
  });

  it('markFailed keeps the last error and clears it on progress', () => {
    let ledger = initLedger('t', 'p', post.channels, t0);
    ledger = markFailed(ledger, 'telegram', 'first failure', t1);
    ledger = markFailed(ledger, 'telegram', 'second failure', t2);
    expect(ledger.channels.telegram!.error).toBe('second failure');
    ledger = markOpDelivered(ledger, 'telegram', 0, 100, t2);
    expect(ledger.channels.telegram!.error).toBeUndefined();
    expect(ledger.channels.telegram!.status).toBe('pending');
  });

  it('returns 0 as nextOpIndex for an untouched channel', () => {
    const ledger = initLedger('t', 'p', post.channels, t0);
    expect(nextOpIndex(ledger, 'telegram')).toBe(0);
    expect(nextOpIndex(ledger, 'never-seen')).toBe(0);
  });

  it('refuses to record a delivery on a done channel', () => {
    const done = markDone(initLedger('t', 'p', post.channels, t0), 'telegram', t1);
    expect(() => markOpDelivered(done, 'telegram', 0, 100, t2)).toThrowError(LedgerTransitionError);
    expect(() => markOpDelivered(done, 'telegram', 0, 100, t2)).toThrowError(/already done/);
  });

  it('never mutates the input ledger', () => {
    const ledger = initLedger('t', 'p', post.channels, t0);
    const snapshot = structuredClone(ledger);
    let next = markOpDelivered(ledger, 'telegram', 0, 100, t1);
    next = markFailed(next, 'telegram', 'boom', t2);
    next = markDone(next, 'telegram', t2);
    expect(next).not.toEqual(ledger);
    expect(ledger).toEqual(snapshot);
  });
});

describe('JSON (de)serialization', () => {
  it('round-trips a ledger', () => {
    let ledger = initLedger('t', 'p', post.channels, t0);
    ledger = markOpDelivered(ledger, 'telegram', 0, 1, t1);
    ledger = markOpDelivered(ledger, 'telegram', 1, 'two', t1);
    ledger = markDone(ledger, 'telegram', t1);
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
