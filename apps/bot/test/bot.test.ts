import { describe, expect, it } from 'vitest';

import { createBot } from '../src/bot';
import type { BotTexts } from '../src/bot';
import { fakeDb, mockTelegramApi, sentTexts, textUpdate } from './helpers';

const texts: BotTexts = {
  startText: 'start reply',
  refusalText: 'refusal reply',
};

const allowed = { userId: 11, tenantId: 'faden-und-stimmung' };

function makeBot(db: D1Database, allowedIds: Record<string, string>) {
  const bot = createBot({
    token: 'TEST_TOKEN',
    db,
    resolveTenant: (userId) => allowedIds[String(userId)],
    ...texts,
  });
  const calls = mockTelegramApi(bot);
  return { bot, calls };
}

describe('allow-list middleware', () => {
  it('/start from an allow-listed user gets the start reply (A6 happy path)', async () => {
    const db = fakeDb();
    const { bot, calls } = makeBot(db, { [allowed.userId]: allowed.tenantId });
    await bot.init();

    await bot.handleUpdate(textUpdate(allowed.userId, '/start'));

    expect(sentTexts(calls)).toEqual([texts.startText]);
  });

  it('a non-allow-listed user gets the refusal and nothing is stored (A6)', async () => {
    const db = fakeDb();
    const { bot, calls } = makeBot(db, { [allowed.userId]: allowed.tenantId });
    await bot.init();

    await bot.handleUpdate(textUpdate(999, '/start'));

    expect(sentTexts(calls)).toEqual([texts.refusalText]);
    // The refusal path must not touch D1: no tenant was resolved.
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it('attaches tenant and DB only for allow-listed users', async () => {
    const db = fakeDb();
    const { bot, calls } = makeBot(db, { [allowed.userId]: allowed.tenantId });
    await bot.init();

    const seen: { tenantId?: string; db?: unknown }[] = [];
    bot.on('message', (ctx) => {
      seen.push({ tenantId: ctx.tenantId, db: ctx.db });
    });

    await bot.handleUpdate(textUpdate(allowed.userId, 'hello'));
    await bot.handleUpdate(textUpdate(999, 'hello'));

    expect(seen).toEqual([{ tenantId: allowed.tenantId, db }]);
    expect(sentTexts(calls)).toEqual([texts.refusalText]);
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it('an update without a sender is refused without crashing', async () => {
    const db = fakeDb();
    const { bot, calls } = makeBot(db, { [allowed.userId]: allowed.tenantId });
    await bot.init();

    await bot.handleUpdate(textUpdate(undefined, '/start'));

    expect(sentTexts(calls)).toEqual([texts.refusalText]);
  });
});
