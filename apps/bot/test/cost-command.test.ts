import { readFileSync } from 'node:fs';
import { parseTenantConfig } from '@handmake/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBot } from '../src/bot';
import { createAiCostLedger } from '../src/ai-costs';
import { createD1DraftStore } from '../src/draft-store';
import { botTexts } from '../src/texts';
import { makeD1, mockTelegramApi, sentTexts, textUpdate } from './helpers';

afterEach(() => vi.restoreAllMocks());

it('allows /cost only after the allow-list gate and scopes totals to that tenant', async () => {
  const db = await makeD1();
  const ledger = createAiCostLedger(db);
  const config = parseTenantConfig(
    readFileSync(
      new URL('../../../config/tenants/faden-und-stimmung.yaml', import.meta.url),
      'utf8',
    ),
  );
  config.ai = {
    monthlyTargetEur: 20,
    toleranceEur: 5,
    translation: { model: 'fixture', inputEurPerMillion: 1, outputEurPerMillion: 2 },
  };
  const load = vi.fn(async () => config);
  const bot = createBot({
    token: 'TEST_TOKEN',
    drafts: createD1DraftStore(db),
    resolveTenant: (id) => (id === 11 ? 'one' : undefined),
    texts: botTexts,
    translator: { translate: vi.fn() },
    publishRunner: { run: vi.fn() },
    background: vi.fn(),
    costs: { ledger, tenantConfigs: { load } },
  });
  const calls = mockTelegramApi(bot);
  await bot.init();
  await ledger.recordCost('other', {
    id: '1',
    at: new Date(),
    service: 'image',
    unit: 'image',
    amountEur: 99,
    ref: 'show:a',
  });
  await bot.handleUpdate(textUpdate(999, '/cost'));
  expect(load).not.toHaveBeenCalled();
  expect(sentTexts(calls)).toEqual([botTexts.refusalText]);
  await bot.handleUpdate(textUpdate(11, '/cost'));
  expect(load).toHaveBeenCalledExactlyOnceWith('one');
  expect(sentTexts(calls).at(-1)).toContain('Витрачено: 0.0000 EUR');
});

it.each(['config', 'ledger'])('replies clearly when the %s backend fails', async (failure) => {
  const db = await makeD1();
  const ledger = createAiCostLedger(db);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const config = parseTenantConfig(
    readFileSync(
      new URL('../../../config/tenants/faden-und-stimmung.yaml', import.meta.url),
      'utf8',
    ),
  );
  const error = new Error('sensitive backend details');
  const load = vi.fn(async () => config);
  if (failure === 'config') load.mockRejectedValueOnce(error);
  else vi.spyOn(ledger, 'summary').mockRejectedValueOnce(error);
  const bot = createBot({
    token: 'TEST_TOKEN',
    drafts: createD1DraftStore(db),
    resolveTenant: () => 'one',
    texts: botTexts,
    translator: { translate: vi.fn() },
    publishRunner: { run: vi.fn() },
    background: vi.fn(),
    costs: { ledger, tenantConfigs: { load } },
  });
  const calls = mockTelegramApi(bot);
  await bot.init();
  await expect(bot.handleUpdate(textUpdate(11, '/cost'))).resolves.toBeUndefined();
  expect(sentTexts(calls)).toEqual(['Не вдалося отримати витрати на ШІ. Спробуй /cost пізніше.']);
  expect(log).toHaveBeenCalledExactlyOnceWith('AI cost report failed');
});

describe('translation cost scope', () => {
  it('passes the tenant and draft reference to the paid translator factory', async () => {
    const drafts = createD1DraftStore(await makeD1());
    const tasks: Promise<void>[] = [];
    const fallback = vi.fn();
    const translate = vi.fn(async () => ({ text: 'DE' }));
    const translatorFor = vi.fn(async () => ({ translate }));
    const bot = createBot({
      token: 'TEST_TOKEN',
      drafts,
      resolveTenant: () => 'one',
      texts: botTexts,
      translator: { translate: fallback },
      translatorFor,
      publishRunner: { run: vi.fn() },
      background: (task) => {
        tasks.push(task());
      },
    });
    mockTelegramApi(bot);
    await bot.init();
    const update = textUpdate(11, 'UA');
    delete update.message!.entities;
    await bot.handleUpdate(update);
    const draft = await drafts.findCollectingForChat('one', '11', 'post');
    await bot.handleUpdate(textUpdate(11, '/done'));
    await Promise.all(tasks);
    expect(translatorFor).toHaveBeenCalledExactlyOnceWith('one', `post:${draft!.draft.draftId}`);
    expect(translate).toHaveBeenCalledOnce();
    expect(fallback).not.toHaveBeenCalled();
  });
});
