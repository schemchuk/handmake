import { describe, expect, it } from 'vitest';

import { ChannelRegistry } from '../src/channel-registry';
import { idempotencyBase, idempotencyKey } from '../src/ports/channel';
import { FakeChannelAdapter } from '../src/testing/fakes';

describe('ChannelRegistry', () => {
  it('registers adapters and lists keys', () => {
    const registry = new ChannelRegistry();
    registry.register(new FakeChannelAdapter({ key: 'telegram' }));
    registry.register(new FakeChannelAdapter({ key: 'instagram' }));
    expect(registry.keys()).toEqual(['telegram', 'instagram']);
    expect(registry.has('telegram')).toBe(true);
    expect(registry.get('instagram').key).toBe('instagram');
  });

  it('rejects a duplicate key', () => {
    const registry = new ChannelRegistry();
    registry.register(new FakeChannelAdapter({ key: 'telegram' }));
    expect(() => registry.register(new FakeChannelAdapter({ key: 'telegram' }))).toThrowError(
      /duplicate channel key/,
    );
  });

  it('raises a clear error for an unknown key', () => {
    const registry = new ChannelRegistry();
    expect(() => registry.get('tiktok')).toThrowError(/unknown channel: "tiktok"/);
  });
});

describe('idempotency keys', () => {
  it('formats tenantId:postId:channel:opIndex', () => {
    expect(idempotencyKey('faden-und-stimmung', '01JBCA1B2C3D4E5F6G7H8J9K0M', 'telegram', 2)).toBe(
      'faden-und-stimmung:01JBCA1B2C3D4E5F6G7H8J9K0M:telegram:2',
    );
  });

  it('base is the key without the op index', () => {
    expect(idempotencyBase('t', 'p', 'telegram')).toBe('t:p:telegram');
  });
});
