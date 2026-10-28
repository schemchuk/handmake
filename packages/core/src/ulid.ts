const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encodeTime(time: number): string {
  let chars = '';
  for (let i = 0; i < 10; i++) {
    chars = CROCKFORD[time % 32]! + chars;
    time = Math.floor(time / 32);
  }
  return chars;
}

/**
 * A ULID derived deterministically from `seed` instead of randomness: the
 * same seed and timestamp always mint the same id. Cron-created drafts use it
 * so a retried or overlapping cron run hits the same draft id and the store's
 * insert-or-ignore dedupes it — one draft per (seed) forever, while the id
 * stays a valid ULID (and therefore a valid post id downstream). The first 10
 * chars encode `timestampMs` exactly like `newUlid`; the 16 randomness chars
 * come from SHA-256(seed).
 */
export async function deterministicUlid(seed: string, timestampMs: number): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encodeSeed(seed)));
  let random = 0n;
  for (let i = 0; i < 10; i++) {
    random = (random << 8n) | BigInt(digest[i]!);
  }
  let chars = '';
  for (let i = 0; i < 16; i++) {
    chars = CROCKFORD[Number(random % 32n)]! + chars;
    random /= 32n;
  }
  return encodeTime(timestampMs) + chars;
}

function encodeSeed(seed: string): Uint8Array {
  return new TextEncoder().encode(seed);
}

/**
 * ULID (https://github.com/ulid/spec): 10 chars of Crockford Base32 encoding
 * the epoch milliseconds, then 16 random chars. Uppercase, matching the post
 * schema's id regex (post.ts). Lives in core because both the publisher and
 * the bot mint ids — the bot's draft ids become post ids (idempotency key).
 */
export function newUlid(now: Date = new Date()): string {
  const time = encodeTime(now.getTime());
  const random = new Uint8Array(16);
  crypto.getRandomValues(random);
  let chars = '';
  for (let i = 0; i < 16; i++) {
    chars += CROCKFORD[random[i]! % 32]!;
  }
  return time + chars;
}
