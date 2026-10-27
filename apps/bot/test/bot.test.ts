import type { Bot } from 'grammy';
import type { TranslationRequest, TranslationResult, Translator } from '@handmake/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { createBot } from '../src/bot';
import type { AppContext } from '../src/context';
import { createD1DraftStore } from '../src/draft-store';
import type { D1DraftStore } from '../src/draft-store';
import { botTexts } from '../src/texts';
import type { SentCall } from './helpers';
import {
  callbackQueryUpdate,
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
let translateCalls: TranslationRequest[];
/** Swap to make the fake translator fail (AI outage). */
let translateImpl: (request: TranslationRequest) => Promise<TranslationResult>;
let translator: Translator;
/** Background tasks the bot scheduled (production: waitUntil). */
let backgroundTasks: Promise<void>[];

/** Awaits everything the bot deferred past the webhook response. */
async function flushBackground(): Promise<void> {
  while (backgroundTasks.length > 0) {
    await backgroundTasks.shift();
  }
}

function lastSendMessage(calls: SentCall[]): Record<string, unknown> | undefined {
  return calls.filter((call) => call.method === 'sendMessage').at(-1)?.payload;
}

beforeEach(async () => {
  db = await makeD1();
  drafts = createD1DraftStore(db);
  translateCalls = [];
  backgroundTasks = [];
  translateImpl = async (request) => ({ text: `DE:${request.text}` });
  translator = {
    translate: async (request) => {
      translateCalls.push(request);
      return translateImpl(request);
    },
  };
  bot = createBot({
    token: 'TEST_TOKEN',
    drafts,
    resolveTenant: (userId) => (userId === allowed.userId ? allowed.tenantId : undefined),
    texts: botTexts,
    translator,
    background: (task) => {
      backgroundTasks.push(task());
    },
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
    expect(stored[0]?.draft.texts['uk']).toBe('hello');
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
    expect(open?.draft.texts['uk']).toBe('Привіт!\n\nДругий абзац');
  });

  it('a photo stores the largest size as a file_id', async () => {
    await bot.handleUpdate(photoUpdate(allowed.userId, ['small', 'large']));

    expect(sentTexts(calls)).toEqual([botTexts.photoSavedText(1)]);
    const open = await drafts.findCollectingForChat(allowed.tenantId, String(allowed.userId));
    expect(open?.draft.photoRefs).toEqual(['large']);
  });

  it('a photo caption is collected as text too', async () => {
    await bot.handleUpdate(photoUpdate(allowed.userId, ['p1'], 'Підпис до фото'));

    const open = await drafts.findCollectingForChat(allowed.tenantId, String(allowed.userId));
    expect(open?.draft.photoRefs).toEqual(['p1']);
    expect(open?.draft.texts['uk']).toBe('Підпис до фото');
  });

  it('a JPEG document is collected like a photo', async () => {
    await bot.handleUpdate(documentUpdate(allowed.userId, 'doc-jpeg', 'image/jpeg', 'work.jpeg'));

    expect(sentTexts(calls)).toEqual([botTexts.photoSavedText(1)]);
    const open = await drafts.findCollectingForChat(allowed.tenantId, String(allowed.userId));
    expect(open?.draft.photoRefs).toEqual(['doc-jpeg']);
  });

  it('an 11th photo is politely refused and stays out of the draft', async () => {
    for (let i = 0; i < 10; i++) {
      await bot.handleUpdate(photoUpdate(allowed.userId, [`p${i}`]));
    }
    await bot.handleUpdate(photoUpdate(allowed.userId, ['p10']));

    expect(sentTexts(calls).at(-1)).toBe(botTexts.photoLimitText(10));
    const open = await drafts.findCollectingForChat(allowed.tenantId, String(allowed.userId));
    expect(open?.draft.photoRefs).toHaveLength(10);
  });

  it('an album of photos arriving in parallel lands in one draft, none lost', async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        bot.handleUpdate(photoUpdate(allowed.userId, [`album-${i}`])),
      ),
    );

    expect(await drafts.listByState(allowed.tenantId, 'collecting')).toHaveLength(1);
    const open = await drafts.findCollectingForChat(allowed.tenantId, String(allowed.userId));
    expect(open?.draft.photoRefs).toHaveLength(10);
    expect(new Set(open?.draft.photoRefs).size).toBe(10);
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

describe('/done: translate and preview', () => {
  it('translates the collecting draft and sends a preview with buttons', async () => {
    await bot.handleUpdate(textUpdate(allowed.userId, 'Привіт!'));
    await bot.handleUpdate(textUpdate(allowed.userId, '/done'));
    await flushBackground();

    const sent = sentTexts(calls);
    expect(sent[0]).toBe(botTexts.textSavedText(0));
    expect(sent[1]).toBe(botTexts.translatingText);
    expect(sent[2]).toContain(botTexts.previewHeader(0));
    expect(sent[2]).toContain('Привіт!');
    expect(sent[2]).toContain('DE:Привіт!');

    const keyboard = (
      lastSendMessage(calls)?.['reply_markup'] as {
        inline_keyboard: { callback_data: string }[][];
      }
    ).inline_keyboard.flat();
    expect(keyboard.map((b) => b.callback_data)).toContain('draft:publish');

    expect(translateCalls).toHaveLength(1);
    expect(translateCalls[0]).toMatchObject({
      sourceLang: 'uk',
      targetLang: 'de',
      text: 'Привіт!',
    });

    const ready = await drafts.listByState(allowed.tenantId, 'ready');
    expect(ready).toHaveLength(1);
    expect(ready[0]?.draft.texts['de']).toBe('DE:Привіт!');
  });

  it('without a draft asks to start one', async () => {
    await bot.handleUpdate(textUpdate(allowed.userId, '/done'));

    expect(sentTexts(calls)).toEqual([botTexts.draftNoneText]);
    expect(translateCalls).toHaveLength(0);
  });

  it('with photos but no Ukrainian text asks for the text first', async () => {
    await bot.handleUpdate(photoUpdate(allowed.userId, ['p1']));
    await bot.handleUpdate(textUpdate(allowed.userId, '/done'));

    expect(sentTexts(calls).at(-1)).toBe(botTexts.doneNeedsText);
    expect(translateCalls).toHaveLength(0);
    expect(await drafts.listByState(allowed.tenantId, 'collecting')).toHaveLength(1);
  });

  it('a failed translation offers the authors own German text, which flips the draft to ready', async () => {
    translateImpl = async () => {
      throw new Error('AI unavailable');
    };
    await bot.handleUpdate(textUpdate(allowed.userId, 'Привіт!'));
    await bot.handleUpdate(textUpdate(allowed.userId, '/done'));
    await flushBackground();

    expect(sentTexts(calls).at(-1)).toBe(botTexts.translationFailedText);
    expect(await drafts.listByState(allowed.tenantId, 'failed')).toHaveLength(1);

    await bot.handleUpdate(textUpdate(allowed.userId, 'Mein handgemachter Text'));

    expect(sentTexts(calls).at(-1)).toContain('Mein handgemachter Text');
    const ready = await drafts.listByState(allowed.tenantId, 'ready');
    expect(ready).toHaveLength(1);
    expect(ready[0]?.draft.texts['de']).toBe('Mein handgemachter Text');
    expect(translateCalls).toHaveLength(1);
  });

  it('a text beyond the Telegram limit blocks the preview: no Publish button', async () => {
    await bot.handleUpdate(textUpdate(allowed.userId, 'x'.repeat(4100)));
    await bot.handleUpdate(textUpdate(allowed.userId, '/done'));
    await flushBackground();

    const sent = sentTexts(calls).at(-1)!;
    expect(sent).toContain('❌');
    const keyboard = (
      lastSendMessage(calls)?.['reply_markup'] as {
        inline_keyboard: { callback_data: string; text: string }[][];
      }
    ).inline_keyboard.flat();
    expect(keyboard.map((b) => b.callback_data)).not.toContain('draft:publish');
    expect(keyboard.map((b) => b.text)).toContain(botTexts.discardButton);
  });
});

describe('preview buttons', () => {
  async function makeReadyDraft(): Promise<void> {
    await bot.handleUpdate(textUpdate(allowed.userId, 'Привіт!'));
    await bot.handleUpdate(textUpdate(allowed.userId, '/done'));
    await flushBackground();
  }

  it('Edit DE arms the edit; the next text message replaces the German version', async () => {
    await makeReadyDraft();
    await bot.handleUpdate(callbackQueryUpdate(allowed.userId, allowed.userId, 'draft:edit:de'));

    expect(sentTexts(calls).at(-1)).toBe(botTexts.editPromptText('de', 'DE:Привіт!'));
    const stored = await drafts.latestForChat(allowed.tenantId, String(allowed.userId));
    expect(stored?.pendingEdit).toBe('de');

    await bot.handleUpdate(textUpdate(allowed.userId, 'Neuer Text'));

    expect(sentTexts(calls).at(-1)).toContain('Neuer Text');
    const updated = await drafts.latestForChat(allowed.tenantId, String(allowed.userId));
    expect(updated?.draft.texts['de']).toBe('Neuer Text');
    expect(updated?.pendingEdit).toBeNull();
  });

  it('Regenerate DE re-translates and shows a fresh preview', async () => {
    await makeReadyDraft();
    await bot.handleUpdate(callbackQueryUpdate(allowed.userId, allowed.userId, 'draft:regen-de'));
    await flushBackground();

    expect(sentTexts(calls).at(-2)).toBe(botTexts.translatingText);
    expect(sentTexts(calls).at(-1)).toContain(botTexts.previewHeader(0));
    expect(translateCalls).toHaveLength(2);
    const ready = await drafts.listByState(allowed.tenantId, 'ready');
    expect(ready[0]?.draft.texts['de']).toBe('DE:Привіт!');
  });

  it('Publish is not wired yet and says so', async () => {
    await makeReadyDraft();
    await bot.handleUpdate(callbackQueryUpdate(allowed.userId, allowed.userId, 'draft:publish'));

    expect(sentTexts(calls).at(-1)).toBe(botTexts.publishNotAvailableText);
    expect(await drafts.listByState(allowed.tenantId, 'ready')).toHaveLength(1);
  });

  it('Discard deletes the draft', async () => {
    await makeReadyDraft();
    await bot.handleUpdate(callbackQueryUpdate(allowed.userId, allowed.userId, 'draft:discard'));

    expect(sentTexts(calls).at(-1)).toBe(botTexts.discardDoneText);
    expect(await drafts.latestForChat(allowed.tenantId, String(allowed.userId))).toBeUndefined();
  });

  it('a button press without any draft gets a gentle pointer', async () => {
    await bot.handleUpdate(callbackQueryUpdate(allowed.userId, allowed.userId, 'draft:publish'));

    expect(sentTexts(calls)).toEqual([botTexts.draftNoneText]);
  });
});

describe('translation runs past the webhook response (B1)', () => {
  it('a slow translator never blocks the handler; the preview arrives when done', async () => {
    let resolveTranslate!: (result: TranslationResult) => void;
    translateImpl = () =>
      new Promise<TranslationResult>((resolve) => {
        resolveTranslate = resolve;
      });

    await bot.handleUpdate(textUpdate(allowed.userId, 'Привіт!'));
    // If the AI call ran inside the handler, handleUpdate would still be
    // pending here and nothing below could execute.
    await bot.handleUpdate(textUpdate(allowed.userId, '/done'));

    expect(sentTexts(calls).at(-1)).toBe(botTexts.translatingText);
    expect(await drafts.listByState(allowed.tenantId, 'translating')).toHaveLength(1);

    resolveTranslate({ text: 'Langsam aber sicher' });
    await flushBackground();

    expect(sentTexts(calls).at(-1)).toContain('Langsam aber sicher');
    expect(await drafts.listByState(allowed.tenantId, 'ready')).toHaveLength(1);
  });

  it('a second /done while translating is refused without a second AI call', async () => {
    let resolveTranslate!: (result: TranslationResult) => void;
    translateImpl = () =>
      new Promise<TranslationResult>((resolve) => {
        resolveTranslate = resolve;
      });

    await bot.handleUpdate(textUpdate(allowed.userId, 'Привіт!'));
    await bot.handleUpdate(textUpdate(allowed.userId, '/done'));
    await bot.handleUpdate(textUpdate(allowed.userId, '/done'));

    expect(sentTexts(calls).at(-1)).toBe(botTexts.translateInProgressText);
    expect(translateCalls).toHaveLength(1);

    resolveTranslate({ text: 'Fertig' });
    await flushBackground();
    expect(await drafts.listByState(allowed.tenantId, 'ready')).toHaveLength(1);
  });

  it('a stale translating draft is reclaimed by the next /done', async () => {
    let rejectFirst!: (error: Error) => void;
    translateImpl = () =>
      new Promise<TranslationResult>((_resolve, reject) => {
        rejectFirst = reject;
      });

    await bot.handleUpdate(textUpdate(allowed.userId, 'Привіт!'));
    await bot.handleUpdate(textUpdate(allowed.userId, '/done'));
    rejectFirst(new Error('runtime cancelled the background task'));
    await flushBackground();
    expect(await drafts.listByState(allowed.tenantId, 'failed')).toHaveLength(1);

    // A 'translating' row that aged past the stale window is reclaimable;
    // simulate by moving the failed draft back to translating with an old
    // timestamp (same state the stale claim guards on).
    const stuck = await drafts.latestForChat(allowed.tenantId, String(allowed.userId));
    await db
      .prepare("UPDATE drafts SET status = 'translating', updated_at = '2026-10-27T10:00:00.000Z'")
      .run();

    translateImpl = async (request) => ({ text: `DE:${request.text}` });
    await bot.handleUpdate(textUpdate(allowed.userId, '/done'));
    await flushBackground();

    expect(translateCalls).toHaveLength(2);
    const ready = await drafts.listByState(allowed.tenantId, 'ready');
    expect(ready).toHaveLength(1);
    expect(ready[0]?.draft.draftId).toBe(stuck?.draft.draftId);
  });
});

describe('content under a ready draft (m2)', () => {
  it('a photo re-shows the preview with a hint instead of forking a new draft', async () => {
    await bot.handleUpdate(textUpdate(allowed.userId, 'Привіт!'));
    await bot.handleUpdate(textUpdate(allowed.userId, '/done'));
    await flushBackground();
    await bot.handleUpdate(photoUpdate(allowed.userId, ['late-photo']));

    expect(sentTexts(calls).at(-2)).toBe(botTexts.photoUnderReadyText);
    expect(sentTexts(calls).at(-1)).toContain(botTexts.previewHeader(0));
    // Still exactly one draft, and it has no new photo.
    const ready = await drafts.listByState(allowed.tenantId, 'ready');
    expect(ready).toHaveLength(1);
    expect(ready[0]?.draft.photoRefs).toEqual([]);
    expect(await drafts.listByState(allowed.tenantId, 'collecting')).toEqual([]);
  });
});
