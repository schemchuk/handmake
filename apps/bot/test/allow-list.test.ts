import { describe, expect, it } from 'vitest';

import { AllowListError, createTenantLookup } from '../src/allow-list';

describe('createTenantLookup', () => {
  it('resolves allow-listed Telegram user IDs to their tenant', () => {
    const lookup = createTenantLookup('{"123456789":"faden-und-stimmung"}');

    expect(lookup(123456789)).toBe('faden-und-stimmung');
    expect(lookup(987654321)).toBeUndefined();
  });

  it('supports several users, including across tenants', () => {
    const lookup = createTenantLookup(
      '{"1":"faden-und-stimmung","2":"faden-und-stimmung","3":"other-circle"}',
    );

    expect(lookup(1)).toBe('faden-und-stimmung');
    expect(lookup(3)).toBe('other-circle');
  });

  it('rejects invalid JSON without echoing the secret value', () => {
    let message = '';
    try {
      createTenantLookup('not-json{secret-value');
    } catch (error) {
      expect(error).toBeInstanceOf(AllowListError);
      message = (error as Error).message;
    }

    expect(message).toContain('TELEGRAM_ALLOWED_USER_IDS');
    expect(message).not.toContain('secret-value');
  });

  it('rejects non-object values', () => {
    expect(() => createTenantLookup('["faden-und-stimmung"]')).toThrow(AllowListError);
    expect(() => createTenantLookup('"faden-und-stimmung"')).toThrow(AllowListError);
    expect(() => createTenantLookup('null')).toThrow(AllowListError);
  });

  it('rejects entries with an invalid Telegram user ID, naming only the field', () => {
    let message = '';
    try {
      createTenantLookup('{"not-a-number":"faden-und-stimmung"}');
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('TELEGRAM_ALLOWED_USER_IDS');
    expect(message).not.toContain('not-a-number');
  });

  it('rejects entries with an invalid tenant ID, naming only the field', () => {
    let message = '';
    try {
      createTenantLookup('{"42":"Not A Tenant!"}');
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('TELEGRAM_ALLOWED_USER_IDS');
    expect(message).not.toContain('Not A Tenant!');
  });

  it('allows an empty allow-list (locked bot, no lookups match)', () => {
    const lookup = createTenantLookup('{}');

    expect(lookup(123456789)).toBeUndefined();
  });
});
