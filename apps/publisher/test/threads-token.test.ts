import { describe, expect, it } from 'vitest';
import { parseThreadsRefresh } from '../src/threads-token';

describe('Threads refresh response', () => {
  it('accepts a token with at least fifty days remaining', () => {
    expect(parseThreadsRefresh({ access_token: 'refreshed.token', expires_in: 50 * 86400 })).toBe(
      'refreshed.token',
    );
  });

  it.each([
    null,
    {},
    { expires_in: 60 * 86400 },
    { access_token: '', expires_in: 60 * 86400 },
    { access_token: 'private-token', expires_in: 50 * 86400 - 1 },
    { access_token: 'private-token', expires_in: '5184000' },
    { access_token: 'private-token', expires_in: Infinity },
    { access_token: 'private-token\n::warning::injected', expires_in: 60 * 86400 },
    { error: { message: 'private-token' } },
    { access_token: 'private-token', expires_in: 60 * 86400, error: {} },
  ])('rejects invalid responses without disclosing their contents (%#)', (data) => {
    expect(() => parseThreadsRefresh(data)).toThrow(
      /^Threads refresh returned an invalid token or expiry$/,
    );
  });
});
