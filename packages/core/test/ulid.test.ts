import { describe, expect, it } from 'vitest';

import { deterministicUlid, newUlid } from '../src/ulid';

const ulidPattern = /^[0-9A-HJKMNP-TV-Z]{26}$/;

describe('newUlid', () => {
  it('mints 26-char Crockford Base32 ids that match the post id regex shape', () => {
    expect(newUlid()).toMatch(ulidPattern);
  });
});

describe('deterministicUlid', () => {
  it('is stable for the same seed and timestamp', async () => {
    const first = await deterministicUlid('tenant:announcement:2026-10-29', 1761739600000);
    const second = await deterministicUlid('tenant:announcement:2026-10-29', 1761739600000);
    expect(first).toBe(second);
    expect(first).toMatch(ulidPattern);
  });

  it('differs across seeds and across timestamps', async () => {
    const base = await deterministicUlid('a:announcement:2026-10-29', 1761739600000);
    const otherKind = await deterministicUlid('a:reminder:2026-10-29', 1761739600000);
    const otherDay = await deterministicUlid('a:announcement:2026-11-05', 1761739600000);
    const otherTime = await deterministicUlid('a:announcement:2026-10-29', 1762344400000);
    expect(new Set([base, otherKind, otherDay, otherTime]).size).toBe(4);
  });

  it('encodes the timestamp like a regular ULID', async () => {
    const now = new Date('2026-10-29T13:00:00.000Z');
    const id = await deterministicUlid('seed', now.getTime());
    expect(id.slice(0, 10)).toBe(newUlid(now).slice(0, 10));
  });
});
