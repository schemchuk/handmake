import { describe, expect, it } from 'vitest';

import { idempotencyBase } from '../src/ports/channel';
import {
  describeChannelAdapterContract,
  describeContentStoreContract,
  describeTranslatorContract,
  FakeChannelAdapter,
  FakeClock,
  FakeContentStore,
  FakeMediaSource,
  FakeNotifier,
  FakePublishRunner,
  FakeSecretResolver,
  FakeTranslator,
  FakeWinnerPicker,
} from '../src/testing';

describeChannelAdapterContract('fake', () => new FakeChannelAdapter());
describeContentStoreContract('fake', () => new FakeContentStore());
describeTranslatorContract('fake', () => new FakeTranslator());

describe('fakes', () => {
  it('FakeChannelAdapter records deliveries with idempotency keys', async () => {
    const adapter = new FakeChannelAdapter({ key: 'telegram' });
    const ops = [
      { kind: 'mediaGroup' as const, photoIndexes: [0] },
      { kind: 'message' as const, text: 'hi', lang: 'de' },
    ];
    const remoteIds = await adapter.deliver(
      ops,
      {
        secrets: new FakeSecretResolver(),
        idempotencyBase: idempotencyBase('t', 'p', 'telegram'),
        settings: { channelId: 'TEST_CHANNEL' },
        photos: [],
      },
      { startAt: 0, knownIds: [], onDelivered: () => {} },
    );
    expect(remoteIds).toHaveLength(2);
    expect(adapter.deliveries[0]!.idempotencyKeys).toEqual(['t:p:telegram:0', 't:p:telegram:1']);
  });

  it('FakeSecretResolver throws on unknown names without leaking values', async () => {
    const resolver = new FakeSecretResolver({ MY_SECRET: 'value' });
    expect(await resolver.resolve('MY_SECRET')).toBe('value');
    await expect(resolver.resolve('OTHER')).rejects.toThrowError(/unknown secret/);
  });

  it('FakeClock is frozen until advanced', () => {
    const clock = new FakeClock('2026-10-23T12:00:00Z');
    const first = clock.now();
    clock.advance(60_000);
    expect(clock.now().getTime() - first.getTime()).toBe(60_000);
    expect(first.getTime()).toBe(new Date('2026-10-23T12:00:00Z').getTime());
  });

  it('FakePublishRunner and FakeNotifier record their calls', async () => {
    const runner = new FakePublishRunner();
    await runner.run({
      tenantId: 't',
      postId: 'p',
      texts: { uk: 'Hi' },
      fileIds: ['file-1'],
      provenance: 'human',
    });
    expect(runner.jobs).toEqual([
      {
        tenantId: 't',
        postId: 'p',
        texts: { uk: 'Hi' },
        fileIds: ['file-1'],
        provenance: 'human',
      },
    ]);

    const notifier = new FakeNotifier();
    await notifier.notify('operator', 'something failed');
    expect(notifier.messages).toEqual([{ target: 'operator', message: 'something failed' }]);
  });

  it('FakeMediaSource and FakeWinnerPicker behave deterministically', async () => {
    const media = new FakeMediaSource();
    media.photos.set('ref-1', new Uint8Array([42]));
    expect(await media.fetchPhoto('ref-1')).toEqual(new Uint8Array([42]));
    await expect(media.fetchPhoto('missing')).rejects.toThrowError(/unknown photo ref/);

    const picker = new FakeWinnerPicker();
    const pick = await picker.pick([
      { id: 'a', photoRef: 'ref-1' },
      { id: 'b', photoRef: 'ref-2' },
    ]);
    expect(pick.winnerId).toBe('a');
  });
});
