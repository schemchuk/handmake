import { readFileSync } from 'node:fs';

import { parseTenantConfig } from '@handmake/core';
import type { TenantConfig } from '@handmake/core';
import type { ParseClient, TextGenerationClient } from '@handmake/ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAiCostRuntime } from '../src/ai-cost-runtime';
import { createAiCostLedger } from '../src/ai-costs';
import { makeD1 } from './helpers';

// Exercise the real adapters and ledger; only their SDK transport is replaced.
const sdk = vi.hoisted(() => ({ create: vi.fn(), parse: vi.fn() }));
vi.mock('@handmake/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@handmake/ai')>();
  return {
    ...actual,
    ClaudeTextGenerator: class extends actual.ClaudeTextGenerator {
      constructor(options: import('@handmake/ai').ClaudeTextGeneratorOptions) {
        super({ ...options, client: { messages: { create: sdk.create } } });
      }
    },
    ClaudeTranslator: class extends actual.ClaudeTranslator {
      constructor(options: import('@handmake/ai').ClaudeTranslatorOptions) {
        super({ ...options, client: { messages: { parse: sdk.parse } } });
      }
    },
  };
});

type UaReply = Awaited<ReturnType<TextGenerationClient['messages']['create']>>;
type DeReply = Awaited<ReturnType<ParseClient['messages']['parse']>>;
const ua: UaReply = {
  id: 'msg_ua',
  model: 'fixture-priced-model',
  type: 'message',
  role: 'assistant',
  container: null,
  diagnostics: null,
  stop_details: null,
  stop_reason: 'end_turn',
  stop_sequence: null,
  content: [{ type: 'text', text: '{"text":"UA fixture","notes":""}', citations: null }],
  usage: {
    input_tokens: 1_000_000,
    output_tokens: 100_000,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation: null,
    server_tool_use: null,
    service_tier: 'standard',
    inference_geo: 'not_available',
    speed: 'standard',
    output_tokens_details: null,
  },
};
const de: DeReply = {
  id: 'msg_de',
  usage: { input_tokens: 500_000, output_tokens: 50_000 },
  stop_reason: 'end_turn',
  parsed_output: { text: 'DE fixture', notes: '' },
};
const fixture = parseTenantConfig(
  readFileSync(new URL('../../../config/tenants/faden-und-stimmung.yaml', import.meta.url), 'utf8'),
);
const tenantId = fixture.id;
const workId = '01JBCA1B2C3D4E5F6G7H8J9K0M';
const otherWorkId = '01JBCA1B2C3D4E5F6G7H8J9K0Z';
// Synthetic prices, never a live tariff assertion.
const ai = {
  monthlyTargetEur: 20,
  toleranceEur: 5,
  translation: { model: 'fixture-priced-model', inputEurPerMillion: 2, outputEurPerMillion: 10 },
};
const request = { note: 'Author fixture note', kind: 'closeup' as const, collection: 'fixture' };
let ledger: ReturnType<typeof createAiCostLedger>;
let db: D1Database;
let configs: { load: ReturnType<typeof vi.fn<(id: string) => Promise<TenantConfig>>> };
let runtime: ReturnType<typeof createAiCostRuntime>;
beforeEach(async () => {
  sdk.create.mockReset().mockResolvedValue(ua);
  sdk.parse.mockReset().mockResolvedValue(de);
  db = await makeD1();
  ledger = createAiCostLedger(db);
  configs = { load: vi.fn(async (id: string) => ({ ...fixture, id, ai })) };
  runtime = createAiCostRuntime(ledger, configs, new Map(), 'fixture-key', vi.fn());
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
async function generate(id = tenantId, work = workId) {
  return (await runtime.textGeneratorFor(id, work)).generate(request);
}
const summary = () => ledger.summary(tenantId, new Date());

describe('work text generation with T42', () => {
  it('uses the priced model for both calls and records per-tenant/work/service cost', async () => {
    const result = await generate();
    expect(result.versions.uk).toMatchObject({
      provenance: 'ai-assisted',
      model: ai.translation.model,
      prompt: 'describe-work-uk@1',
    });
    expect(result.versions.de).toMatchObject({
      provenance: 'ai-assisted',
      model: ai.translation.model,
      prompt: 'humanize-de@1',
    });
    expect(sdk.create.mock.calls[0]![0].model).toBe(ai.translation.model);
    expect(sdk.parse.mock.calls[0]![0].model).toBe(ai.translation.model);
    expect(await summary()).toMatchObject({
      total: 4.5,
      services: {
        'text-generation:fixture-priced-model': 3,
        'translation:fixture-priced-model': 1.5,
      },
    });
    const rows = await db.prepare('SELECT tenant_id, ref FROM ai_costs').all();
    expect(rows.results).toEqual([
      { tenant_id: tenantId, ref: `work:${workId}` },
      { tenant_id: tenantId, ref: `work:${workId}` },
    ]);
    expect((await ledger.summary('other', new Date())).total).toBe(0);
  });

  it('deduplicates repeated response IDs but accounts for paid regeneration separately', async () => {
    await generate();
    await generate();
    expect((await summary()).total).toBe(4.5);
    sdk.create.mockResolvedValueOnce({ ...ua, id: 'msg_ua_regenerated' });
    sdk.parse.mockResolvedValueOnce({ ...de, id: 'msg_de_regenerated' });
    await generate();
    expect((await summary()).total).toBe(9);
  });

  it('scopes response IDs by tenant and retains the work reference for separate works', async () => {
    await generate();
    await generate('other');
    expect((await ledger.summary('other', new Date())).total).toBe(4.5);
    sdk.create.mockResolvedValueOnce({ ...ua, id: 'msg_other_work_ua' });
    sdk.parse.mockResolvedValueOnce({ ...de, id: 'msg_other_work_de' });
    await generate(tenantId, otherWorkId);
    const rows = await db
      .prepare(
        'SELECT ref, SUM(amount_eur) AS total FROM ai_costs WHERE tenant_id = ? GROUP BY ref ORDER BY ref',
      )
      .bind(tenantId)
      .all();
    expect(rows.results).toEqual([
      { ref: `work:${workId}`, total: 4.5 },
      { ref: `work:${otherWorkId}`, total: 4.5 },
    ]);
  });

  it('retains UA cost and explicitly reports unknown DE usage when SDK parsing throws', async () => {
    sdk.parse.mockRejectedValueOnce(new SyntaxError('SDK parse failure'));
    await expect(generate()).rejects.toThrow(/paid usage may be unavailable/);
    expect((await summary()).total).toBe(3);
  });

  it.each(['refusal', 'max_tokens'])(
    'accounts for a paid DE %s before rejecting the result',
    async (stop_reason) => {
      sdk.parse.mockResolvedValueOnce({ ...de, stop_reason, parsed_output: null });
      await expect(generate()).rejects.toThrow();
      expect((await summary()).total).toBe(4.5);
    },
  );

  it('accounts for UA malformed output before failing and never calls DE', async () => {
    sdk.create.mockResolvedValueOnce({
      ...ua,
      content: [{ type: 'text', text: 'broken JSON', citations: null }],
    });
    await expect(generate()).rejects.toThrow();
    expect(sdk.parse).not.toHaveBeenCalled();
    expect((await summary()).total).toBe(3);
  });

  it('does not return content or call DE when the UA ledger write fails', async () => {
    vi.spyOn(ledger, 'recordCost').mockRejectedValueOnce(new Error('D1 unavailable'));
    await expect(generate()).rejects.toThrow('D1 unavailable');
    expect(sdk.parse).not.toHaveBeenCalled();
  });

  it('does not return success when DE accounting fails, preserving the booked UA call', async () => {
    const record = ledger.recordCost.bind(ledger);
    vi.spyOn(ledger, 'recordCost')
      .mockImplementationOnce(record)
      .mockRejectedValueOnce(new Error('D1 unavailable'));
    await expect(generate()).rejects.toThrow(/accounting failed/);
    expect((await summary()).total).toBe(3);
  });

  it('rejects DE with missing usage or response identity instead of recording a free call', async () => {
    sdk.parse.mockResolvedValueOnce({ ...de, usage: undefined });
    await expect(generate()).rejects.toThrow(/accounting failed/);
    expect((await summary()).total).toBe(3);
    sdk.parse.mockResolvedValueOnce({ ...de, id: undefined });
    await expect(generate()).rejects.toThrow(/accounting failed/);
    expect((await summary()).total).toBe(3);
  });

  it('refuses to start without pricing, on config errors, or with another tenant config', async () => {
    const { ai: _ai, ...withoutPricing } = fixture;
    configs.load.mockResolvedValueOnce(withoutPricing);
    await expect(generate()).rejects.toThrow(/requires configured text pricing/);
    configs.load.mockRejectedValueOnce(new Error('config unavailable'));
    await expect(generate()).rejects.toThrow('config unavailable');
    configs.load.mockResolvedValueOnce({ ...fixture, id: 'other', ai });
    await expect(generate()).rejects.toThrow(/tenant config mismatch/);
    expect(sdk.create).not.toHaveBeenCalled();
    expect(sdk.parse).not.toHaveBeenCalled();
  });

  it('rejects invalid correlation IDs before any paid call', async () => {
    await expect(generate(tenantId, '../invalid')).rejects.toThrow();
    expect(configs.load).not.toHaveBeenCalled();
    expect(sdk.create).not.toHaveBeenCalled();
  });
});
