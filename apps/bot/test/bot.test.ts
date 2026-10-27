import type { Bot } from 'grammy';
import { beforeEach, describe, expect, it } from 'vitest';

import { createBot } from '../src/bot';
import type { AppContext } from '../src/context';
import { createD1DraftStore } from '../src/draft-store';
import type { D1DraftStore } from '../src/draft-store';
import { botTexts } from '../src/texts';
import {
  documentUpdate,
  makeD1,
  mockTelegramApi,
  photoUpdate,
  sentTexts,
  textUpdate,
  voiceUpdate,
} from './helpers';

const allowed = { userId: 11, tenantId: 'faden-und-stimmung' };

let db: D1Database;
let drafts: D1DraftStore;
let bot: Bot<AppContext>;
let calls: ReturnType<typeof mockTelegramApi>;

beforeEach(async () => {
  db = await makeD1();
  drafts = createD1DraftStore(db);
  bot = createBot({
    token: 'TEST_TOKEN',
    drafts,
    resolveTenant: (userId) => (userId === allowed.userId ? allowed.tenantId : undefined),
    texts: botTexts,
  });
  calls = mockTelegramApi(bot);
  await bot.init();
});

describe('allow-list middleware (A6)', () => {
  it('/start from an allow-listed user gets the start reply', async () => {
    await bot.handleUpdate(textUpdate(allowed.userId, '/start'));

    expect(sentTexts(calls)).toEqual([botTexts.startText]);
  });

  it('a non-allow-listed user gets the refusal and nothing is stored', async () => {
    await bot.handleUpdate(textUpdate(999, '/start'));

    expect(sentTexts(calls)).toEqual([botTexts.refusalText]);
    expect(await drafts.listByState(allowed.tenantId, 'collecting')).toEqual([]);
  });

  it('uses the tenant and drafts below the gate only for allow-listed users', async () => {
    await bot.handleUpdate(textUpdate(allowed.userId, 'hello'));
    await bot.handleUpdate(textUpdate(999, 'hello'));

    // The saved draft proves the handler below the gate saw the resolved
    // tenant and the draft repository; the stranger got only the refusal
    // and nothing was stored for anyone.
    const stored = await drafts.listByState(allowed.tenantId, 'collecting');
    expect(stored).toHaveLength(1);
    expect(stored[0]?.texts['ua']).toBe('hello');
    expect(sentTexts(calls)).toEqual([botTexts.textSavedText(0), botTexts.refusalText]);
  });

  it('an update without a sender is refused without crashing', async () => {
    await bot.handleUpdate(textUpdate(undefined, '/start'));

    expect(sentTexts(calls)).toEqual([botTexts.refusalText]);
  });
});

describe('/new and /discard', () => {
  it('/new creates a collecting draft in D1', async () => {
    await bot.handleUpdate(textUpdate(allowed.userId, '/new'));

    expect(sentTexts(calls)).toEqual([botTexts.draftCreatedText(0)]);
    const open = await drafts.listByState(allowed.tenantId, 'collecting');
    expect(open).toHaveLength(1);
  });

  it('/new with an open draft refuses politely', async () => {
    await bot.handleUpdate(textUpdate(allowed.userId, '/new'));
    await bot.handleUpdate(textUpdate(allowed.userId, '/new'));

    expect(sentTexts(calls)[1]).toBe(botTexts.draftExistsText(0));
    expect(await drafts.listByState(allowed.tenantId, 'collecting')).toHaveLength(1);
  });

  it('/discard deletes the open draft; a second /discard has nothing to delete', async () => {
    await bot.handleUpdate(textUpdate(allowed.userId, '/new'));
    await bot.handleUpdate(textUpdate(allowed.userId, '/discard'));
    await bot.handleUpdate(textUpdate(allowed.userId, '/discard'));

    expect(sentTexts(calls)[1]).toBe(botTexts.discardDoneText);
    expect(sentTexts(calls)[2]).toBe(botTexts.discardNothingText);
    expect(await drafts.listByState(allowed.tenantId, 'collecting')).toEqual([]);
  });
});

describe('collecting content', () => {
  it('a text message auto-creates the draft and appends the UA text', async () => {
    await bot.handleUpdate(textUpdate(allowed.userId, 'Привіт!'));
    await bot.handleUpdate(textUpdate(allowed.userId, 'Другий абзац'));

    expect(sentTexts(calls)).toEqual([botTexts.textSavedText(0), botTexts.textSavedText(0)]);
    const open = await drafts.findCollectingForChat(allowed.tenantId, String(allowed.userId));
    expect(open?.texts['ua']).toBe('Привіт!\n\nДругий абзац');
  });

  it('a photo stores the largest size as a file_id', async () => {
    await bot.handleUpdate(photoUpdate(allowed.userId, ['small', 'large']));

    expect(sentTexts(calls)).toEqual([botTexts.photoSavedText(1)]);
    const open = await drafts.findCollectingForChat(allowed.tenantId, String(allowed.userId));
    expect(open?.photoRefs).toEqual(['large']);
  });

  it('a photo caption is collected as text too', async () => {
    await bot.handleUpdate(photoUpdate(allowed.userId, ['p1'], 'Підпис до фото'));

    const open = await drafts.findCollectingForChat(allowed.tenantId, String(allowed.userId));
    expect(open?.photoRefs).toEqual(['p1']);
    expect(open?.texts['ua']).toBe('Підпис до фото');
  });

  it('a JPEG document is collected like a photo', async () => {
    await bot.handleUpdate(documentUpdate(allowed.userId, 'doc-jpeg', 'image/jpeg', 'work.jpeg'));

    expect(sentTexts(calls)).toEqual([botTexts.photoSavedText(1)]);
    const open = await drafts.findCollectingForChat(allowed.tenantId, String(allowed.userId));
    expect(open?.photoRefs).toEqual(['doc-jpeg']);
  });

  it('an 11th photo is politely refused and stays out of the draft', async () => {
    for (let i = 0; i < 10; i++) {
      await bot.handleUpdate(photoUpdate(allowed.userId, [`p${i}`]));
    }
    await bot.handleUpdate(photoUpdate(allowed.userId, ['p10']));

    expect(sentTexts(calls).at(-1)).toBe(botTexts.photoLimitText(10));
    const open = await drafts.findCollectingForChat(allowed.tenantId, String(allowed.userId));
    expect(open?.photoRefs).toHaveLength(10);
  });
});

describe('refusals', () => {
  it('a HEIC document gets a clear refusal and is not stored', async () => {
    await bot.handleUpdate(documentUpdate(allowed.userId, 'heic-1', 'image/heic', 'IMG_0001.HEIC'));

    expect(sentTexts(calls)).toEqual([botTexts.unsupportedFileText('IMG_0001.HEIC')]);
    expect(await drafts.listByState(allowed.tenantId, 'collecting')).toEqual([]);
  });

  it('an unknown command gets a short help line', async () => {
    await bot.handleUpdate(textUpdate(allowed.userId, '/frobnicate'));

    expect(sentTexts(calls)).toEqual([botTexts.unknownCommandText]);
  });

  it('a voice message is refused: only text and photos for now', async () => {
    await bot.handleUpdate(voiceUpdate(allowed.userId, 'voice-1'));

    expect(sentTexts(calls)).toEqual([botTexts.unsupportedMessageText]);
    expect(await drafts.listByState(allowed.tenantId, 'collecting')).toEqual([]);
  });
});
