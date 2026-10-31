import { readFileSync } from 'node:fs';
import { parseTenantConfig } from '@handmake/core';
import type { TenantConfig } from '@handmake/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAiCostLedger } from '../src/ai-costs';
import { createAiCostRuntime } from '../src/ai-cost-runtime';
import { makeD1 } from './helpers';

afterEach(() => vi.restoreAllMocks());

const constructed = vi.hoisted(() => vi.fn());
vi.mock('@handmake/ai', () => ({
  humanizeDePromptV1: 'test prompt',
  ClaudeTranslator: class {
    constructor(
      public options: {
        onUsage?: (
          usage: { input_tokens: number; output_tokens: number },
          responseId?: string,
        ) => Promise<void>;
      },
    ) {
      constructed(options);
    }
    async translate() {
      await this.options.onUsage?.(
        { input_tokens: 1_000_000, output_tokens: 100_000 },
        crypto.randomUUID(),
      );
      return { text: 'DE' };
    }
  },
}));
const fixture = parseTenantConfig(
  readFileSync(new URL('../../../config/tenants/faden-und-stimmung.yaml', import.meta.url), 'utf8'),
);
// Synthetic EUR prices, unrelated to the live service tariff.
const budget = {
  monthlyTargetEur: 20,
  toleranceEur: 5,
  translation: { model: 'fixture-model', inputEurPerMillion: 2, outputEurPerMillion: 10 },
};
let ledger: ReturnType<typeof createAiCostLedger>;
beforeEach(async () => {
  ledger = createAiCostLedger(await makeD1());
  constructed.mockClear();
});
function setup(send = vi.fn(async (_id: number, _text: string) => {})) {
  const configs = { load: vi.fn(async (): Promise<TenantConfig> => ({ ...fixture, ai: budget })) };
  const runtime = createAiCostRuntime(
    ledger,
    configs,
    new Map([
      [11, 'one'],
      [12, 'one'],
      [13, 'other'],
    ]),
    'fixture-key',
    send,
  );
  return { runtime, send, configs };
}
const now = new Date('2026-10-31T12:00:00Z');
async function book(amountEur: number, at = now) {
  await ledger.recordCost('one', {
    id: crypto.randomUUID(),
    at,
    amountEur,
    ref: 'show:a',
    service: 'image',
    unit: 'image',
  });
}

describe('AI cost runtime', () => {
  it('translates without bookkeeping when the tenant has no ai section', async () => {
    const { runtime, configs, send } = setup();
    const { ai: _ai, ...withoutAi } = fixture;
    configs.load.mockResolvedValueOnce(withoutAi);
    const record = vi.spyOn(ledger, 'recordCost');
    const translator = await runtime.translatorFor('legacy', 'post:abc');
    await expect(
      translator.translate({ text: 'UA', sourceLang: 'uk', targetLang: 'de' }),
    ).resolves.toEqual({ text: 'DE' });
    expect(constructed.mock.calls[0]![0]).not.toHaveProperty('onUsage');
    expect(record).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('keeps translating on a cold config fetch failure and logs the accounting fallback', async () => {
    const { runtime, configs } = setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    configs.load.mockRejectedValueOnce(new Error('GitHub unavailable'));
    const record = vi.spyOn(ledger, 'recordCost');
    const translator = await runtime.translatorFor('one', 'post:abc');
    await expect(
      translator.translate({ text: 'UA', sourceLang: 'uk', targetLang: 'de' }),
    ).resolves.toEqual({ text: 'DE' });
    expect(record).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      'Tenant config unavailable; using default translator without cost accounting',
    );
  });

  it('books token usage using tenant pricing, with a distinct record for each regeneration', async () => {
    const { runtime } = setup();
    for (let i = 0; i < 2; i++) {
      const translator = await runtime.translatorFor('one', 'post:abc');
      await translator.translate({ text: 'UA', sourceLang: 'uk', targetLang: 'de' });
    }
    const summary = await ledger.summary('one', new Date());
    expect(summary.total).toBe(6);
    expect(summary.services).toEqual({ 'translation:fixture-model': 6 });
    expect(summary.shows).toEqual({});
    expect(constructed).toHaveBeenCalledWith(expect.objectContaining({ model: 'fixture-model' }));
  });

  it('deduplicates the same API response but books a regeneration separately', async () => {
    const { runtime } = setup();
    await runtime.translatorFor('one', 'post:abc');
    const { onUsage } = constructed.mock.calls[0]![0];
    const usage = { input_tokens: 1_000_000, output_tokens: 100_000 };
    await onUsage(usage, 'msg_first');
    await onUsage(usage, 'msg_first');
    expect((await ledger.summary('one', new Date())).total).toBe(3);
    await onUsage(usage, 'msg_regenerated');
    expect((await ledger.summary('one', new Date())).total).toBe(6);
  });

  it('books the threshold-crossing call without awaiting notices, then warns via cron', async () => {
    const { runtime, send, configs } = setup(vi.fn(() => new Promise<void>(() => {})));
    await book(17, new Date());
    const translator = await runtime.translatorFor('one', 'post:abc');
    await expect(
      translator.translate({ text: 'UA', sourceLang: 'uk', targetLang: 'de' }),
    ).resolves.toEqual({ text: 'DE' });
    expect((await ledger.summary('one', new Date())).total).toBe(20);
    expect(send).not.toHaveBeenCalled();
    expect(configs.load).toHaveBeenCalledOnce();
    send.mockResolvedValue(undefined);
    await runtime.notices(new Date());
    expect(send.mock.calls.some(([id, text]) => id === 11 && text.includes('Досягнуто'))).toBe(
      true,
    );
    expect(send.mock.calls.some(([id, text]) => id === 12 && text.includes('Досягнуто'))).toBe(
      true,
    );
  });

  it('warns each operator of the tenant once at the target, retrying failed delivery', async () => {
    const { runtime, send } = setup();
    await book(19.99);
    await runtime.notices(now);
    send.mockClear();
    await book(0.01);
    send.mockRejectedValueOnce(new Error('offline'));
    await runtime.notices(now);
    await runtime.notices(now);
    await runtime.notices(now);
    expect(send.mock.calls.map(([id]) => id)).toEqual([11, 12, 11]);
    expect(send.mock.calls[0]![1]).toContain('Досягнуто');
  });

  it('catches up after a missed first day and summarizes once per tenant', async () => {
    const { runtime, send, configs } = setup();
    const summary = vi.spyOn(ledger, 'summary');
    await book(3);
    await runtime.notices(new Date('2026-11-03T12:00:00Z'));
    await runtime.notices(new Date('2026-11-04T12:00:00Z'));
    expect(configs.load).toHaveBeenCalledTimes(4);
    expect(summary).toHaveBeenCalledTimes(8);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[0]![1]).toContain('2026-10\nВитрачено: 3.0000 EUR');
    expect(send.mock.calls[2]![1]).toContain('Витрачено: 0.0000 EUR');
  });
});
