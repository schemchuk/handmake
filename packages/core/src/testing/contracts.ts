import { describe, expect, it } from 'vitest';

import { idempotencyBase } from '../ports/channel';
import type { ChannelAdapter, SendOperation } from '../ports/channel';
import type { Translator } from '../ports/services';
import type { ContentStore } from '../ports/store';

/**
 * Contract suites every real adapter must pass. A real adapter's test file
 * calls e.g. describeChannelAdapterContract('telegram', () => makeAdapter())
 * alongside its own HTTP-fixture tests; the fake in `fakes.ts` demonstrates
 * usage and keeps the contract honest.
 */

const sampleOps: SendOperation[] = [
  { kind: 'mediaGroup', photoIndexes: [0, 1], caption: 'caption', captionLang: 'uk' },
  { kind: 'message', text: 'text', lang: 'de', replyTo: 'msg-1' },
];

export function describeChannelAdapterContract(
  name: string,
  makeAdapter: () => ChannelAdapter,
): void {
  describe(`ChannelAdapter contract: ${name}`, () => {
    it('declares positive capabilities', () => {
      const caps = makeAdapter().capabilities;
      expect(caps.maxPhotos).toBeGreaterThan(0);
      expect(caps.captionLimit).toBeGreaterThan(0);
      expect(caps.messageLimit).toBeGreaterThan(caps.captionLimit);
      expect(typeof caps.polls).toBe('boolean');
    });

    it('deliver returns one remote id per operation', async () => {
      const adapter = makeAdapter();
      const remoteIds = await adapter.deliver(sampleOps, {
        secrets: { resolve: async () => 'unused' },
        idempotencyBase: idempotencyBase('tenant', 'post', adapter.key),
      });
      expect(remoteIds).toHaveLength(sampleOps.length);
    });

    it('honours capabilities.polls: false by exposing no poll methods', () => {
      const adapter = makeAdapter();
      if (!adapter.capabilities.polls) {
        expect(adapter.openPoll).toBeUndefined();
        expect(adapter.closePoll).toBeUndefined();
      }
    });
  });
}

export function describeContentStoreContract(name: string, makeStore: () => ContentStore): void {
  describe(`ContentStore contract: ${name}`, () => {
    it('round-trips a post and reads back an absent ledger as undefined', async () => {
      const store = makeStore();
      const post = {
        id: '01JBCA1B2C3D4E5F6G7H8J9K0M',
        tenant: 'tenant',
        date: '2026-10-23T14:12:00+02:00',
        publishAt: 'now' as const,
        type: 'free' as const,
        photos: ['01.jpg'],
        channels: ['telegram'],
        versions: { uk: { provenance: 'human' as const } },
        texts: { uk: 'text' },
      };
      await store.savePost(post, [{ fileName: '01.jpg', data: new Uint8Array([1]) }]);
      expect(await store.readPost('tenant', post.id)).toEqual(post);
      expect(await store.readLedger('tenant', post.id)).toBeUndefined();
    });

    it('persists ledgers keyed by tenant and post', async () => {
      const store = makeStore();
      const ledger = {
        tenantId: 'tenant',
        postId: 'post',
        channels: { telegram: { status: 'done' as const, remoteIds: [1], updatedAt: 't' } },
      };
      await store.writeLedger(ledger);
      expect(await store.readLedger('tenant', 'post')).toEqual(ledger);
      expect(await store.readLedger('other-tenant', 'post')).toBeUndefined();
    });
  });
}

export function describeTranslatorContract(name: string, makeTranslator: () => Translator): void {
  describe(`Translator contract: ${name}`, () => {
    it('translates into the requested target language', async () => {
      const translator = makeTranslator();
      const result = await translator.translate({
        text: 'Привіт!',
        sourceLang: 'uk',
        targetLang: 'de',
      });
      expect(result.text.length).toBeGreaterThan(0);
      expect(result.text).not.toBe('Привіт!');
    });

    it('signals failure with a thrown error, not a wrong result', async () => {
      const translator = makeTranslator();
      await expect(
        translator.translate({ text: '', sourceLang: 'uk', targetLang: 'de' }),
      ).rejects.toThrow();
    });
  });
}
