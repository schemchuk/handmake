const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * ULID (https://github.com/ulid/spec): 10 chars of Crockford Base32 encoding
 * the epoch milliseconds, then 16 random chars. Uppercase, matching the post
 * schema's id regex (post.ts). Lives in core because both the publisher and
 * the bot mint ids — the bot's draft ids become post ids (idempotency key).
 */
export function newUlid(now: Date = new Date()): string {
  let time = now.getTime();
  let chars = '';
  for (let i = 0; i < 10; i++) {
    chars = CROCKFORD[time % 32]! + chars;
    time = Math.floor(time / 32);
  }
  const random = new Uint8Array(16);
  crypto.getRandomValues(random);
  for (let i = 0; i < 16; i++) {
    chars += CROCKFORD[random[i]! % 32]!;
  }
  return chars;
}
