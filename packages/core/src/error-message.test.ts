import { expect, it } from 'vitest';
import { safeErrorMessage } from './error-message';

it('keeps diagnostic text while removing configured secrets and token patterns', () => {
  const error = new Error('failed: private-key sk-test-token 123456789:telegram_token');
  expect(safeErrorMessage(error, ['private-key'])).toBe('failed: [REDACTED] [REDACTED] [REDACTED]');
  expect(safeErrorMessage({ headers: { authorization: 'private-key' } })).toBe('Unknown error');
});
