import { ClaudeTranslator } from '@handmake/ai';
import { createAiCostLedger } from '../src/ai-costs';
import { parseTenantConfig } from '@handmake/core';
import type { TenantConfig, Translator } from '@handmake/core';
import { Bot } from 'grammy';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as aiCostRuntime from '../src/ai-cost-runtime';
import { runAnnouncementCron } from '../src/announcement-cron';
import { createD1DraftStore } from '../src/draft-store';
import type { AppContext } from '../src/context';
import { createApp } from '../src/composition';
import type { Env } from '../src/env';
import { botTexts } from '../src/texts';
import type { TenantConfigSource } from '../src/tenant-config-source';
import { makeD1, mockTelegramApi, sentTexts } from './helpers';

const TENANT = 'faden-und-stimmung';
const AUTHOR = 111;

// Announcement Tuesday 18:00, reminder Thursday 10:00 (Berlin); the meeting
// is Thursday 14:00 (Berlin) — the same shape as the real tenant config.
const TENANT_YAML = `
id: ${TENANT}
name: Faden und Stimmung
languages: [uk, de]
channels:
  telegram:
    channelId: TELEGRAM_CHANNEL_ID
contentStore:
  type: git-repo
meetingSchedule:
  weekday: thursday
  time: '14:00'
  timezone: Europe/Berlin
workOfWeek:
  opens: { weekday: monday, time: '10:00' }
  closes: { weekday: wednesday, time: '20:00' }
announcements:
  schedule:
    announcement: { weekday: tuesday, time: '18:00' }
    reminder: { weekday: thursday, time: '10:00' }
  templates:
    announcement: 'Анонс: зустріч у {weekday}, {date} о {time}'
    reminder: 'Нагадування: сьогодні {date} о {time}'
featureFlags:
  wotwPoll: false
offerings: []
`;

const tenantConfig: TenantConfig = parseTenantConfig(TENANT_YAML);

const configSource: TenantConfigSource = { load: async () => tenantConfig };

const fakeTranslator = (text: string): Translator => ({
  translate: async ({ text: input }) => ({ text: `${text}${input}` }),
});

const failingTranslator: Translator = {
  translate: async () => {
    throw new Error('anthropic down');
  },
};

// Tuesday 2026-10-27 17:05Z = 18:05 Berlin: the announcement just fired.
const ANNOUNCEMENT_TICK = new Date('2026-10-27T17:05:00.000Z');
// Thursday 2026-10-29 09:05Z = 10:05 Berlin: the reminder just fired.
const REMINDER_TICK = new Date('2026-10-29T09:05:00.000Z');

interface CronFixture {
  db: D1Database;
  calls: ReturnType<typeof mockTelegramApi>;
  run: (now: Date, translator?: Translator) => Promise<void>;
  draftIds: () => Promise<string[]>;
}

async function makeCron(translator?: Translator): Promise<CronFixture> {
  const db = await makeD1();
  const drafts = createD1DraftStore(db);
  const bot = new Bot<AppContext>('test-token');
  const calls = mockTelegramApi(bot);
  const run = (now: Date, override?: Translator) =>
    runAnnouncementCron(now, {
      drafts,
      translator: override ?? translator ?? fakeTranslator('DE: '),
      bot,
      tenantConfigs: configSource,
      allowList: new Map([[AUTHOR, TENANT]]),
      texts: botTexts,
    });
  return {
    db,
    calls,
    run,
    draftIds: async () => {
      const all = await db
        .prepare('SELECT id FROM drafts WHERE tenant_id = ? ORDER BY id')
        .bind(TENANT)
        .all<{ id: string }>();
      return (all.results ?? []).map((row) => row.id);
    },
  };
}

describe('runAnnouncementCron', () => {
  afterEach(() => vi.restoreAllMocks());
  it('keeps the cron draft ready when pricing config fails after the schedule was loaded', async () => {
    const db = await makeD1();
    const drafts = createD1DraftStore(db);
    const configs = {
      load: vi
        .fn()
        .mockResolvedValueOnce(tenantConfig)
        .mockRejectedValue(new Error('GitHub unavailable')),
    };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(ClaudeTranslator.prototype, 'translate').mockResolvedValue({ text: 'DE' });
    const runtime = aiCostRuntime.createAiCostRuntime(
      createAiCostLedger(db),
      configs,
      new Map([[AUTHOR, TENANT]]),
      'fixture-key',
      vi.fn(),
    );
    const bot = new Bot<AppContext>('test-token');
    mockTelegramApi(bot);
    await runAnnouncementCron(ANNOUNCEMENT_TICK, {
      drafts,
      bot,
      tenantConfigs: configs,
      allowList: new Map([[AUTHOR, TENANT]]),
      texts: botTexts,
      translator: failingTranslator,
      translatorFor: runtime.translatorFor,
    });
    expect(await drafts.listByState(TENANT, 'ready')).toHaveLength(1);
    expect(await drafts.listByState(TENANT, 'failed')).toEqual([]);
  });

  let fx: CronFixture;
  beforeEach(async () => {
    fx = await makeCron();
  });

  it('creates one ready draft with both languages and sends the author the preview', async () => {
    await fx.run(ANNOUNCEMENT_TICK);

    const stored = await createD1DraftStore(fx.db).listByState(TENANT, 'ready');
    expect(stored).toHaveLength(1);
    // T25: the announcement draft carries its real kind and type through to
    // the dispatch payload.
    expect(stored[0]!.draft.kind).toBe('post');
    expect(stored[0]!.draft.type).toBe('announcement');
    expect(stored[0]!.draft.extras).toEqual({});
    expect(stored[0]!.draft.texts['uk']).toBe('Анонс: зустріч у четвер, 29 жовтня о 14:00');
    expect(stored[0]!.draft.texts['de']).toBe('DE: Анонс: зустріч у четвер, 29 жовтня о 14:00');
    expect(stored[0]!.draft.photoRefs).toEqual([]);

    const texts = sentTexts(fx.calls);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain('Перегляд допису');
    expect(texts[0]).toContain('Анонс: зустріч у четвер, 29 жовтня о 14:00');
    expect(texts[0]).toContain('DE: Анонс');
    // The usual preview keyboard — publishing still needs the author's 🚀.
    const markup = fx.calls[0]!.payload['reply_markup'] as {
      inline_keyboard: { callback_data: string }[][];
    };
    const callbackData = markup.inline_keyboard.flat().map((button) => button.callback_data);
    const [draftId] = await fx.draftIds();
    expect(callbackData).toContain(`draft:${draftId}:publish`);
  });

  it('is idempotent: overlapping ticks never create a second draft or preview', async () => {
    await fx.run(ANNOUNCEMENT_TICK);
    await fx.run(new Date('2026-10-27T17:20:00.000Z'));
    await fx.run(new Date('2026-10-27T17:35:00.000Z'));

    expect(await fx.draftIds()).toHaveLength(1);
    expect(sentTexts(fx.calls)).toHaveLength(1);
  });

  it('resolves a scoped paid translator once for a cron draft', async () => {
    const drafts = createD1DraftStore(fx.db);
    const bot = new Bot<AppContext>('test-token');
    mockTelegramApi(bot);
    const translate = vi.fn(async () => ({ text: 'DE' }));
    const translatorFor = vi.fn(async () => ({ translate }));
    const options = {
      drafts,
      bot,
      translator: failingTranslator,
      translatorFor,
      tenantConfigs: configSource,
      allowList: new Map([[AUTHOR, TENANT]]),
      texts: botTexts,
    };
    await runAnnouncementCron(ANNOUNCEMENT_TICK, options);
    await runAnnouncementCron(ANNOUNCEMENT_TICK, options);
    const [draftId] = await fx.draftIds();
    expect(translatorFor).toHaveBeenCalledExactlyOnceWith(TENANT, `post:${draftId}`);
    expect(translate).toHaveBeenCalledOnce();
    expect(await drafts.listByState(TENANT, 'ready')).toHaveLength(1);
  });

  it('creates a separate reminder draft for the same meeting on the reminder tick', async () => {
    await fx.run(ANNOUNCEMENT_TICK);
    await fx.run(REMINDER_TICK);

    const drafts = await createD1DraftStore(fx.db).listByState(TENANT, 'ready');
    expect(drafts).toHaveLength(2);
    const reminder = drafts.find((d) => d.draft.texts['uk']!.startsWith('Нагадування'))!;
    expect(reminder.draft.texts['uk']).toBe('Нагадування: сьогодні 29 жовтня о 14:00');
    expect(reminder.draft.type).toBe('reminder');
    // One preview per draft, not per tick.
    expect(sentTexts(fx.calls)).toHaveLength(2);
  });

  it('creates nothing on ticks where no moment fired', async () => {
    await fx.run(new Date('2026-10-27T12:00:00.000Z'));
    expect(await fx.draftIds()).toHaveLength(0);
    expect(sentTexts(fx.calls)).toHaveLength(0);
  });

  it('marks the draft failed and notifies the author when the translation fails', async () => {
    await fx.run(ANNOUNCEMENT_TICK, failingTranslator);

    expect(await createD1DraftStore(fx.db).listByState(TENANT, 'failed')).toHaveLength(1);
    const texts = sentTexts(fx.calls);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain('Не вийшло перекласти');
  });

  it('mints deterministic ULIDs: the same meeting yields the same draft id', async () => {
    await fx.run(ANNOUNCEMENT_TICK);
    const [first] = await fx.draftIds();

    // A fresh database, same seed: same id — that is what dedupes cron retries.
    const fx2 = await makeCron();
    await fx2.run(ANNOUNCEMENT_TICK);
    expect(await fx2.draftIds()).toEqual([first!]);
  });
});

describe('scheduled wiring', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Serves the tenant config for the Worker's config fetch. */
  function stubConfigFetch(): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(async () => new Response(TENANT_YAML, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  function envWith(db: D1Database): Env {
    return {
      DB: db,
      TELEGRAM_BOT_TOKEN: 'test-token',
      TELEGRAM_WEBHOOK_SECRET: 'webhook-secret',
      TELEGRAM_ALLOWED_USER_IDS: JSON.stringify({ [AUTHOR]: TENANT }),
      ANTHROPIC_API_KEY: 'test-key',
      GITHUB_DISPATCH_TOKEN: 'test-token',
      GITHUB_REPO: 'schemchuk/handmake',
      PUBLISH_LIVE: 'false',
      PUBLISH_CALLBACK_SECRET: 'callback-secret',
    };
  }

  it('runs the announcement check on the 15-minute cron but skips retention cleanup', async () => {
    const fetchMock = stubConfigFetch();
    const db = await makeD1();
    const app = createApp(envWith(db), botTexts);
    mockTelegramApi(app.bot);
    // 12:00Z on Tuesday: no announcement moment fired, so no translator call
    // happens — the wiring under test is the cron branch and the config fetch.
    const removed = await app.scheduled({
      cron: '*/15 * * * *',
      scheduledTime: new Date('2026-10-27T12:00:00.000Z').getTime(),
    } as ScheduledEvent);
    expect(removed).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`config/tenants/${TENANT}.yaml`),
    );
  });

  it('still evaluates announcements when cost notices reject', async () => {
    const fetchMock = stubConfigFetch();
    const app = createApp(envWith(await makeD1()), botTexts);
    mockTelegramApi(app.bot);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(aiCostRuntime, 'createAiCostRuntime').mockReturnValue({
      notices: vi.fn().mockRejectedValue(new Error('notices unavailable')),
      translatorFor: vi.fn(),
    });
    await expect(
      app.scheduled({
        cron: '*/15 * * * *',
        scheduledTime: new Date('2026-10-27T12:00:00Z').getTime(),
      } as ScheduledEvent),
    ).resolves.toBe(0);
    expect(log).toHaveBeenCalledWith(
      'AI cost notification failed',
      expect.objectContaining({ message: 'notices unavailable', tenantId: TENANT }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`config/tenants/${TENANT}.yaml`),
    );
  });

  it('catches malformed allow-list errors inside the scheduled handler', async () => {
    const fetchMock = stubConfigFetch();
    const env = envWith(await makeD1());
    env.TELEGRAM_ALLOWED_USER_IDS = 'malformed-sensitive-value';
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      createApp(env, botTexts).scheduled({
        cron: '*/15 * * * *',
        scheduledTime: new Date('2026-10-27T12:00:00Z').getTime(),
      } as ScheduledEvent),
    ).resolves.toBe(0);
    expect(log).toHaveBeenCalledWith(
      'announcement cron failed',
      expect.objectContaining({
        tenantId: 'unknown',
        operation: 'announcement cron failed',
        message: expect.any(String),
      }),
    );
    expect(log.mock.calls.flat().join(' ')).not.toContain(env.TELEGRAM_ALLOWED_USER_IDS);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps daily cleanup on the cleanup cron, without any config fetch', async () => {
    const fetchMock = stubConfigFetch();
    const db = await makeD1();
    // A stale draft that retention must delete.
    await db
      .prepare(
        `INSERT INTO drafts (tenant_id, id, chat_id, status, texts, photos, version, created_at, updated_at)
         VALUES (?, 'old-draft', '111', 'ready', '{}', '[]', 0, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`,
      )
      .bind(TENANT)
      .run();
    const app = createApp(envWith(db), botTexts);
    mockTelegramApi(app.bot);
    const removed = await app.scheduled({
      cron: '29 3 * * *',
      scheduledTime: new Date('2026-10-27T03:29:00.000Z').getTime(),
    } as ScheduledEvent);
    expect(removed).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
