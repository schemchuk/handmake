import type { Bot } from 'grammy';
import { createDraft, isUlid, newUlid, transitionDraft } from '@handmake/core';
import type { PublishJob, TranslationRequest, TranslationResult, Translator } from '@handmake/core';
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
/** Publish jobs the fake runner received; swap publishImpl to fail a dispatch. */
let publishJobs: PublishJob[];
let publishImpl: (job: PublishJob) => Promise<void>;

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
  publishJobs = [];
  publishImpl = async (job) => {
    publishJobs.push(job);
  };
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
    publishRunner: {
      run: async (job) => publishImpl(job),
    },
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
    const open = await drafts.findCollectingForChat(
      allowed.tenantId,
      String(allowed.userId),
      'post',
    );
    expect(open?.draft.texts['uk']).toBe('Привіт!\n\nДругий абзац');
  });

  it('a photo stores the largest size as a file_id', async () => {
    await bot.handleUpdate(photoUpdate(allowed.userId, ['small', 'large']));

    expect(sentTexts(calls)).toEqual([botTexts.photoSavedText(1)]);
    const open = await drafts.findCollectingForChat(
      allowed.tenantId,
      String(allowed.userId),
      'post',
    );
    expect(open?.draft.photoRefs).toEqual(['large']);
  });

  it('a photo caption is collected as text too', async () => {
    await bot.handleUpdate(photoUpdate(allowed.userId, ['p1'], 'Підпис до фото'));

    const open = await drafts.findCollectingForChat(
      allowed.tenantId,
      String(allowed.userId),
      'post',
    );
    expect(open?.draft.photoRefs).toEqual(['p1']);
    expect(open?.draft.texts['uk']).toBe('Підпис до фото');
  });

  it('a JPEG document is collected like a photo', async () => {
    await bot.handleUpdate(documentUpdate(allowed.userId, 'doc-jpeg', 'image/jpeg', 'work.jpeg'));

    expect(sentTexts(calls)).toEqual([botTexts.photoSavedText(1)]);
    const open = await drafts.findCollectingForChat(
      allowed.tenantId,
      String(allowed.userId),
      'post',
    );
    expect(open?.draft.photoRefs).toEqual(['doc-jpeg']);
  });

  it('an 11th photo is politely refused and stays out of the draft', async () => {
    for (let i = 0; i < 10; i++) {
      await bot.handleUpdate(photoUpdate(allowed.userId, [`p${i}`]));
    }
    await bot.handleUpdate(photoUpdate(allowed.userId, ['p10']));

    expect(sentTexts(calls).at(-1)).toBe(botTexts.photoLimitText(10));
    const open = await drafts.findCollectingForChat(
      allowed.tenantId,
      String(allowed.userId),
      'post',
    );
    expect(open?.draft.photoRefs).toHaveLength(10);
  });

  it('an album of photos arriving in parallel lands in one draft, none lost', async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        bot.handleUpdate(photoUpdate(allowed.userId, [`album-${i}`])),
      ),
    );

    expect(await drafts.listByState(allowed.tenantId, 'collecting')).toHaveLength(1);
    const open = await drafts.findCollectingForChat(
      allowed.tenantId,
      String(allowed.userId),
      'post',
    );
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

    const ready = await drafts.listByState(allowed.tenantId, 'ready');
    expect(ready).toHaveLength(1);
    const keyboard = (
      lastSendMessage(calls)?.['reply_markup'] as {
        inline_keyboard: { callback_data: string }[][];
      }
    ).inline_keyboard.flat();
    // T25: every button names the draft it belongs to.
    expect(keyboard.map((b) => b.callback_data)).toContain(
      `draft:${ready[0]!.draft.draftId}:publish`,
    );

    expect(translateCalls).toHaveLength(1);
    expect(translateCalls[0]).toMatchObject({
      sourceLang: 'uk',
      targetLang: 'de',
      text: 'Привіт!',
    });

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
    expect(keyboard.map((b) => b.callback_data).some((data) => data.endsWith(':publish'))).toBe(
      false,
    );
    expect(keyboard.map((b) => b.text)).toContain(botTexts.discardButton);
  });
});

describe('preview buttons', () => {
  /** Runs the author flow to a ready draft; returns its id. */
  async function makeReadyDraft(): Promise<string> {
    await bot.handleUpdate(textUpdate(allowed.userId, 'Привіт!'));
    await bot.handleUpdate(textUpdate(allowed.userId, '/done'));
    await flushBackground();
    const ready = await drafts.listByState(allowed.tenantId, 'ready');
    return ready[0]!.draft.draftId;
  }

  it('Edit DE arms the edit; the next text message replaces the German version', async () => {
    const draftId = await makeReadyDraft();
    await bot.handleUpdate(
      callbackQueryUpdate(allowed.userId, allowed.userId, `draft:${draftId}:edit:de`),
    );

    expect(sentTexts(calls).at(-1)).toBe(botTexts.editPromptText('de', 'DE:Привіт!'));
    const stored = await drafts.get(allowed.tenantId, draftId);
    expect(stored?.pendingEdit).toBe('de');

    await bot.handleUpdate(textUpdate(allowed.userId, 'Neuer Text'));

    expect(sentTexts(calls).at(-1)).toContain('Neuer Text');
    const updated = await drafts.get(allowed.tenantId, draftId);
    expect(updated?.draft.texts['de']).toBe('Neuer Text');
    expect(updated?.pendingEdit).toBeNull();
  });

  it('Regenerate DE re-translates and shows a fresh preview', async () => {
    const draftId = await makeReadyDraft();
    await bot.handleUpdate(
      callbackQueryUpdate(allowed.userId, allowed.userId, `draft:${draftId}:regen-de`),
    );
    await flushBackground();

    expect(sentTexts(calls).at(-2)).toBe(botTexts.translatingText);
    expect(sentTexts(calls).at(-1)).toContain(botTexts.previewHeader(0));
    expect(translateCalls).toHaveLength(2);
    const ready = await drafts.listByState(allowed.tenantId, 'ready');
    expect(ready[0]?.draft.texts['de']).toBe('DE:Привіт!');
  });

  it('Publish asks the face-consent question first (F10)', async () => {
    const draftId = await makeReadyDraft();
    await bot.handleUpdate(
      callbackQueryUpdate(allowed.userId, allowed.userId, `draft:${draftId}:publish`),
    );

    expect(sentTexts(calls).at(-1)).toBe(botTexts.publishConsentText);
    const keyboard = (
      lastSendMessage(calls)?.['reply_markup'] as {
        inline_keyboard: { callback_data: string }[][];
      }
    ).inline_keyboard.flat();
    expect(keyboard.map((b) => b.callback_data)).toEqual([
      `draft:${draftId}:publish:confirm`,
      `draft:${draftId}:publish:cancel`,
    ]);
    // Question only: nothing claimed, nothing dispatched.
    expect(await drafts.listByState(allowed.tenantId, 'ready')).toHaveLength(1);
    expect(publishJobs).toHaveLength(0);
  });

  it('cancel returns to the preview without touching the draft', async () => {
    const draftId = await makeReadyDraft();
    await bot.handleUpdate(
      callbackQueryUpdate(allowed.userId, allowed.userId, `draft:${draftId}:publish`),
    );
    await bot.handleUpdate(
      callbackQueryUpdate(allowed.userId, allowed.userId, `draft:${draftId}:publish:cancel`),
    );

    expect(sentTexts(calls).at(-1)).toContain(botTexts.previewHeader(0));
    expect(await drafts.listByState(allowed.tenantId, 'ready')).toHaveLength(1);
    expect(publishJobs).toHaveLength(0);
  });

  it('Discard deletes the draft', async () => {
    const draftId = await makeReadyDraft();
    await bot.handleUpdate(
      callbackQueryUpdate(allowed.userId, allowed.userId, `draft:${draftId}:discard`),
    );

    expect(sentTexts(calls).at(-1)).toBe(botTexts.discardDoneText);
    expect(await drafts.get(allowed.tenantId, draftId)).toBeUndefined();
  });

  it('a legacy button press (no draft id) without any session gets a gentle pointer', async () => {
    await bot.handleUpdate(callbackQueryUpdate(allowed.userId, allowed.userId, 'draft:publish'));

    expect(sentTexts(calls)).toEqual([botTexts.draftNoneText]);
  });
});

describe('publishing (T16)', () => {
  async function makeReadyDraft(): Promise<string> {
    await bot.handleUpdate(textUpdate(allowed.userId, 'Привіт!'));
    await bot.handleUpdate(photoUpdate(allowed.userId, ['p1', 'p2']));
    await bot.handleUpdate(textUpdate(allowed.userId, '/done'));
    await flushBackground();
    const ready = await drafts.listByState(allowed.tenantId, 'ready');
    return ready[0]!.draft.draftId;
  }

  it('dispatches the draft as claimed, including an edit that landed after the read', async () => {
    const draftId = await makeReadyDraft();
    const claim = drafts.claimPublishing.bind(drafts);
    drafts.claimPublishing = async (...args) => {
      await db
        .prepare(`UPDATE drafts SET texts = json_set(texts, '$.de', ?) WHERE id = ?`)
        .bind('Frisch bearbeitet', draftId)
        .run();
      return claim(...args);
    };
    await bot.handleUpdate(
      callbackQueryUpdate(allowed.userId, allowed.userId, `draft:${draftId}:publish:confirm`),
    );
    await flushBackground();

    expect(publishJobs[0]?.texts['de']).toBe('Frisch bearbeitet');
  });

  it('confirm claims ready → publishing, answers publishing… and dispatches', async () => {
    const draftId = await makeReadyDraft();
    await bot.handleUpdate(
      callbackQueryUpdate(allowed.userId, allowed.userId, `draft:${draftId}:publish:confirm`),
    );
    await flushBackground();

    expect(sentTexts(calls).at(-1)).toBe(botTexts.publishingText);
    expect(publishJobs).toHaveLength(1);
    expect(publishJobs[0]).toMatchObject({
      tenantId: allowed.tenantId,
      kind: 'post',
      type: 'free',
      texts: { uk: 'Привіт!', de: 'DE:Привіт!' },
      fileIds: ['p2'],
      provenance: 'ai-assisted',
    });
    // The draft id is the publish idempotency key: it must be a ULID.
    expect(isUlid(publishJobs[0]!.postId)).toBe(true);
    expect(await drafts.listByState(allowed.tenantId, 'publishing')).toHaveLength(1);
  });

  it('a double confirm dispatches exactly once (A4)', async () => {
    const draftId = await makeReadyDraft();
    await bot.handleUpdate(
      callbackQueryUpdate(allowed.userId, allowed.userId, `draft:${draftId}:publish:confirm`),
    );
    await bot.handleUpdate(
      callbackQueryUpdate(allowed.userId, allowed.userId, `draft:${draftId}:publish:confirm`),
    );
    await flushBackground();

    expect(sentTexts(calls).at(-1)).toBe(botTexts.draftBusyText);
    expect(publishJobs).toHaveLength(1);
    expect(await drafts.listByState(allowed.tenantId, 'publishing')).toHaveLength(1);
  });

  it('a confirm on a non-ready draft is refused without a dispatch', async () => {
    await bot.handleUpdate(textUpdate(allowed.userId, 'Просто текст'));
    await bot.handleUpdate(
      callbackQueryUpdate(allowed.userId, allowed.userId, 'draft:publish:confirm'),
    );

    expect(sentTexts(calls).at(-1)).toBe(botTexts.publishNotReadyText);
    expect(publishJobs).toHaveLength(0);
  });

  it('a failed dispatch reverts to ready and asks the author to retry', async () => {
    publishImpl = async () => {
      throw new Error('GitHub down');
    };
    const draftId = await makeReadyDraft();
    await bot.handleUpdate(
      callbackQueryUpdate(allowed.userId, allowed.userId, `draft:${draftId}:publish:confirm`),
    );
    await flushBackground();

    expect(sentTexts(calls).at(-1)).toBe(botTexts.publishFailedText);
    const ready = await drafts.listByState(allowed.tenantId, 'ready');
    expect(ready).toHaveLength(1);
    // The author can retry from the same draft.
    publishImpl = async (job) => {
      publishJobs.push(job);
    };
    await bot.handleUpdate(
      callbackQueryUpdate(allowed.userId, allowed.userId, `draft:${draftId}:publish:confirm`),
    );
    await flushBackground();
    expect(publishJobs).toHaveLength(1);
    expect(await drafts.listByState(allowed.tenantId, 'publishing')).toHaveLength(1);
  });
});

describe('published drafts (T18)', () => {
  async function makePublishedDraft(): Promise<void> {
    // Direct store setup: the callback (T18) is what moves a draft here in
    // production; this test only needs the end state. The session points at
    // the published draft, like a chat left after a successful publish.
    const draft = {
      ...createDraft(allowed.tenantId, 'published-1', new Date()),
      state: 'published' as const,
    };
    await drafts.create(draft, String(allowed.userId));
    await drafts.setChatSession(
      allowed.tenantId,
      String(allowed.userId),
      { kind: 'post', draftId: 'published-1' },
      new Date(),
    );
  }

  it('every legacy button on an old preview answers "already published" and changes nothing', async () => {
    await makePublishedDraft();
    const buttons = [
      'draft:edit:uk',
      'draft:edit:de',
      'draft:regen-de',
      'draft:publish',
      'draft:discard',
    ];

    for (const data of buttons) {
      await bot.handleUpdate(callbackQueryUpdate(allowed.userId, allowed.userId, data));
    }

    expect(sentTexts(calls)).toEqual(buttons.map(() => botTexts.draftFinishedText));
    expect(await drafts.listByState(allowed.tenantId, 'published')).toHaveLength(1);
    expect(publishJobs).toHaveLength(0);
  });

  it('publish confirm on a published draft answers "already published"', async () => {
    await makePublishedDraft();
    await bot.handleUpdate(
      callbackQueryUpdate(allowed.userId, allowed.userId, 'draft:publish:confirm'),
    );

    expect(sentTexts(calls).at(-1)).toBe(botTexts.draftFinishedText);
    expect(publishJobs).toHaveLength(0);
  });

  it('/discard on a published draft refuses and keeps it', async () => {
    await makePublishedDraft();
    await bot.handleUpdate(textUpdate(allowed.userId, '/discard'));

    expect(sentTexts(calls).at(-1)).toBe(botTexts.draftFinishedText);
    expect(await drafts.listByState(allowed.tenantId, 'published')).toHaveLength(1);
  });

  it('a text message starts a new collecting draft; the published one stays', async () => {
    await makePublishedDraft();
    await bot.handleUpdate(textUpdate(allowed.userId, 'Новий допис'));

    expect(sentTexts(calls).at(-1)).toBe(botTexts.textSavedText(0));
    expect(await drafts.listByState(allowed.tenantId, 'published')).toHaveLength(1);
    const open = await drafts.findCollectingForChat(
      allowed.tenantId,
      String(allowed.userId),
      'post',
    );
    expect(open?.draft.texts['uk']).toBe('Новий допис');
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
    const stuck = (await drafts.listByState(allowed.tenantId, 'failed'))[0];
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

describe('cron drafts never hijack the author flow (T25, review N2)', () => {
  /** A ready cron draft (announcement or reminder), created outside any
   * chat session — exactly what the announcement cron leaves behind. */
  async function makeCronDraft(type: 'announcement' | 'reminder'): Promise<string> {
    const now = new Date('2026-10-27T18:00:00.000Z');
    let cron = createDraft(allowed.tenantId, newUlid(now), now, { type });
    cron = transitionDraft(cron, { type: 'addText', text: 'Автоматичний допис' }, now);
    cron = transitionDraft(cron, { type: 'beginTranslation' }, now);
    cron = transitionDraft(cron, { type: 'translationSucceeded', german: 'DE: автоматика' }, now);
    await drafts.create(cron, String(allowed.userId));
    return cron.draftId;
  }

  it('her texts and /done keep working on her own draft next to a ready cron draft', async () => {
    const cronId = await makeCronDraft('announcement');

    await bot.handleUpdate(textUpdate(allowed.userId, 'Мій допис'));
    await bot.handleUpdate(textUpdate(allowed.userId, '/done'));
    await flushBackground();

    // Her text started her own collecting draft; /done translated THAT one.
    expect(translateCalls).toHaveLength(1);
    expect(translateCalls[0]?.text).toBe('Мій допис');
    // The cron draft sat there untouched.
    const cron = await drafts.get(allowed.tenantId, cronId);
    expect(cron?.draft.state).toBe('ready');
    expect(cron?.draft.texts).toEqual({ uk: 'Автоматичний допис', de: 'DE: автоматика' });
    const ready = await drafts.listByState(allowed.tenantId, 'ready');
    expect(ready).toHaveLength(2);
  });

  it('the cron preview buttons dispatch the cron draft with its real type', async () => {
    const cronId = await makeCronDraft('announcement');
    await bot.handleUpdate(textUpdate(allowed.userId, 'Мій допис'));

    await bot.handleUpdate(
      callbackQueryUpdate(allowed.userId, allowed.userId, `draft:${cronId}:publish`),
    );
    expect(sentTexts(calls).at(-1)).toBe(botTexts.publishConsentText);

    await bot.handleUpdate(
      callbackQueryUpdate(allowed.userId, allowed.userId, `draft:${cronId}:publish:confirm`),
    );
    await flushBackground();

    expect(publishJobs).toHaveLength(1);
    expect(publishJobs[0]).toMatchObject({
      postId: cronId,
      kind: 'post',
      type: 'announcement',
      texts: { uk: 'Автоматичний допис', de: 'DE: автоматика' },
    });
    // Her collecting draft was never touched.
    const own = await drafts.findCollectingForChat(
      allowed.tenantId,
      String(allowed.userId),
      'post',
    );
    expect(own?.draft.texts['uk']).toBe('Мій допис');
  });

  it('a legacy button on an old preview falls back to the session draft, not the cron draft', async () => {
    await bot.handleUpdate(textUpdate(allowed.userId, 'Мій допис'));
    await bot.handleUpdate(textUpdate(allowed.userId, '/done'));
    await flushBackground();
    const cronId = await makeCronDraft('announcement');
    const ownId = (await drafts.listByState(allowed.tenantId, 'ready'))
      .map((stored) => stored.draft.draftId)
      .find((id) => id !== cronId)!;

    // A press of a pre-T25 button (no id) acts on the session's draft.
    await bot.handleUpdate(callbackQueryUpdate(allowed.userId, allowed.userId, 'draft:publish'));
    const keyboard = (
      lastSendMessage(calls)?.['reply_markup'] as {
        inline_keyboard: { callback_data: string }[][];
      }
    ).inline_keyboard.flat();
    expect(keyboard.map((b) => b.callback_data)).toEqual([
      `draft:${ownId}:publish:confirm`,
      `draft:${ownId}:publish:cancel`,
    ]);
  });
});

describe('wotw-poll dispatch (T25)', () => {
  /** A ready wotw-poll draft with the given extras, created outside any session. */
  async function makePollDraft(extras: Record<string, unknown>): Promise<string> {
    const now = new Date('2026-10-27T19:00:00.000Z');
    let poll = createDraft(allowed.tenantId, newUlid(now), now, { type: 'wotw-poll', extras });
    poll = transitionDraft(poll, { type: 'addText', text: 'Голосуємо!' }, now);
    poll = transitionDraft(poll, { type: 'addPhoto', fileId: 'w1' }, now);
    poll = transitionDraft(poll, { type: 'addPhoto', fileId: 'w2' }, now);
    poll = transitionDraft(poll, { type: 'beginTranslation' }, now);
    poll = transitionDraft(poll, { type: 'translationSucceeded', german: 'DE: Umfrage' }, now);
    await drafts.create(poll, String(allowed.userId));
    return poll.draftId;
  }

  it('dispatches with the poll spec from the draft extras', async () => {
    const pollSpec = { question: 'Яка робота тижня?', options: ['1. Ваза', '2. Шаль'] };
    const pollId = await makePollDraft({ poll: pollSpec });

    await bot.handleUpdate(
      callbackQueryUpdate(allowed.userId, allowed.userId, `draft:${pollId}:publish:confirm`),
    );
    await flushBackground();

    expect(publishJobs).toHaveLength(1);
    expect(publishJobs[0]).toMatchObject({
      postId: pollId,
      kind: 'post',
      type: 'wotw-poll',
      fileIds: ['w1', 'w2'],
    });
    expect(publishJobs[0]?.poll).toEqual(pollSpec);
  });

  it('a wotw-poll without a poll in extras is refused and the draft stays ready', async () => {
    const pollId = await makePollDraft({});

    await bot.handleUpdate(
      callbackQueryUpdate(allowed.userId, allowed.userId, `draft:${pollId}:publish:confirm`),
    );
    await flushBackground();

    expect(sentTexts(calls).at(-1)).toBe(botTexts.publishInvalidText);
    expect(publishJobs).toHaveLength(0);
    expect((await drafts.get(allowed.tenantId, pollId))?.draft.state).toBe('ready');
  });

  it('a wotw-poll with a malformed poll in extras is refused too', async () => {
    const pollId = await makePollDraft({ poll: { question: '' } });

    await bot.handleUpdate(
      callbackQueryUpdate(allowed.userId, allowed.userId, `draft:${pollId}:publish:confirm`),
    );
    await flushBackground();

    expect(sentTexts(calls).at(-1)).toBe(botTexts.publishInvalidText);
    expect(publishJobs).toHaveLength(0);
    expect((await drafts.get(allowed.tenantId, pollId))?.draft.state).toBe('ready');
  });

  it('a stray poll in extras of a non-poll draft never reaches the job', async () => {
    const now = new Date('2026-10-27T19:30:00.000Z');
    let free = createDraft(allowed.tenantId, newUlid(now), now, {
      extras: { poll: { question: 'q', options: ['a', 'b'] } },
    });
    free = transitionDraft(free, { type: 'addText', text: 'Звичайний допис' }, now);
    free = transitionDraft(free, { type: 'beginTranslation' }, now);
    free = transitionDraft(free, { type: 'translationSucceeded', german: 'Normaler Post' }, now);
    await drafts.create(free, String(allowed.userId));

    await bot.handleUpdate(
      callbackQueryUpdate(allowed.userId, allowed.userId, `draft:${free.draftId}:publish:confirm`),
    );
    await flushBackground();

    expect(publishJobs).toHaveLength(1);
    expect(publishJobs[0]?.type).toBe('free');
    expect(publishJobs[0]?.poll).toBeUndefined();
  });
});
