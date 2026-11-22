import { readFileSync } from 'node:fs';

import { createDraft, newUlid, parseTenantConfig } from '@handmake/core';
import type { Draft, PublishJob, TenantConfig } from '@handmake/core';
import type { Bot } from 'grammy';
import { beforeEach, describe, expect, it } from 'vitest';

import { createBot } from '../src/bot';
import type { AppContext } from '../src/context';
import { createD1DraftStore } from '../src/draft-store';
import type { D1DraftStore } from '../src/draft-store';
import { formatSlot } from '../src/release-queue';
import { botTexts } from '../src/texts';
import { callbackQueryUpdate, makeD1, mockTelegramApi, sentTexts, textUpdate } from './helpers';

/** F42 queue in the bot (T76b), exercised with posts: the test tenant queues
 * `post` so no work generation fixtures are needed. */
const user = 11;
const tenant = 'faden-und-stimmung';
const tz = 'Europe/Berlin';

let drafts: D1DraftStore;
let bot: Bot<AppContext>;
let calls: ReturnType<typeof mockTelegramApi>;
let jobs: PublishJob[];
let background: Promise<void>[];
let config: TenantConfig;

const base = parseTenantConfig(
  readFileSync(new URL('../../../config/tenants/faden-und-stimmung.yaml', import.meta.url), 'utf8'),
);

beforeEach(async () => {
  drafts = createD1DraftStore(await makeD1());
  jobs = [];
  background = [];
  config = { ...base, releaseQueue: { ...base.releaseQueue!, kinds: ['post'] } };
  bot = createBot({
    token: 'TEST_TOKEN',
    tenantConfigs: { load: async () => config },
    drafts,
    resolveTenant: (id) => (id === user ? tenant : undefined),
    texts: botTexts,
    translator: { translate: async (request) => ({ text: `DE:${request.text}` }) },
    publishRunner: { run: async (job) => void jobs.push(job) },
    background: (task) => void background.push(task()),
  });
  calls = mockTelegramApi(bot);
  await bot.init();
});

async function flush(): Promise<void> {
  while (background.length) await background.shift();
}

async function readyPost(text = 'Новий шарф'): Promise<string> {
  const id = newUlid(new Date());
  const draft: Draft = {
    ...createDraft(tenant, id, new Date()),
    state: 'ready',
    texts: { uk: text, de: `DE ${text}` },
    photoRefs: ['photo-1'],
  };
  await drafts.create(draft, String(user));
  return id;
}

const press = (data: string) => bot.handleUpdate(callbackQueryUpdate(user, user, data));

function keyboardOf(index = -1): string[] {
  const payload = calls.filter((call) => call.method === 'sendMessage').at(index)?.payload;
  const markup = payload?.['reply_markup'] as
    { inline_keyboard: { callback_data: string }[][] } | undefined;
  return markup?.inline_keyboard.flat().map((button) => button.callback_data) ?? [];
}

describe('publishing a queued kind', () => {
  it('offers «в чергу», «зараз» and cancel after the consent question', async () => {
    const id = await readyPost();
    await press(`draft:${id}:publish`);
    expect(keyboardOf()).toEqual([
      `draft:${id}:publish:queue`,
      `draft:${id}:publish:confirm`,
      `draft:${id}:publish:cancel`,
    ]);
  });

  it('«в чергу» takes the next free slot and dispatches nothing', async () => {
    const first = await readyPost();
    const second = await readyPost('Подушка');
    await press(`draft:${first}:publish:queue`);
    await press(`draft:${second}:publish:queue`);
    expect(jobs).toEqual([]);
    const [a, b] = await drafts.listScheduled(tenant);
    expect([a?.draft.draftId, b?.draft.draftId]).toEqual([first, second]);
    expect(Date.parse(b!.publishAt!) - Date.parse(a!.publishAt!)).toBeGreaterThan(20 * 3600_000);
    expect(sentTexts(calls).slice(-1)[0]).toBe(
      botTexts.queuedText(formatSlot(new Date(b!.publishAt!), tz)),
    );
  });

  it('«зараз» still dispatches at once', async () => {
    const id = await readyPost();
    await press(`draft:${id}:publish:confirm`);
    await flush();
    expect(jobs.map((job) => job.postId)).toEqual([id]);
  });

  it('🚀 on a queued draft points to /queue', async () => {
    const id = await readyPost();
    await press(`draft:${id}:publish:queue`);
    await press(`draft:${id}:publish`);
    await press(`draft:${id}:publish:confirm`);
    expect(sentTexts(calls).slice(-2)).toEqual([
      botTexts.queuedAlreadyText,
      botTexts.queuedAlreadyText,
    ]);
    expect(jobs).toEqual([]);
  });

  it('a tenant without the queue keeps the single publish button', async () => {
    config = { ...base, releaseQueue: undefined } as TenantConfig;
    const id = await readyPost();
    await press(`draft:${id}:publish`);
    expect(keyboardOf()).toEqual([`draft:${id}:publish:confirm`, `draft:${id}:publish:cancel`]);
  });
});

describe('/queue', () => {
  it('says the queue is empty', async () => {
    await bot.handleUpdate(textUpdate(user, '/queue'));
    expect(sentTexts(calls)).toEqual([botTexts.queueEmptyListText]);
  });

  it('lists queued works with «зараз» and «у чернетку»', async () => {
    const id = await readyPost('Шарф\nдругий рядок');
    await press(`draft:${id}:publish:queue`);
    calls.length = 0;
    await bot.handleUpdate(textUpdate(user, '/queue'));
    const [stored] = await drafts.listScheduled(tenant);
    expect(sentTexts(calls)).toEqual([
      botTexts.queueListText,
      botTexts.queueItemText(formatSlot(new Date(stored!.publishAt!), tz), 'Шарф'),
    ]);
    expect(keyboardOf()).toEqual([
      `queue:${id}:now:${stored!.version}`,
      `queue:${id}:back:${stored!.version}`,
    ]);
  });

  it('«зараз» dispatches the work and frees its slot', async () => {
    const id = await readyPost();
    await press(`draft:${id}:publish:queue`);
    const [stored] = await drafts.listScheduled(tenant);
    await press(`queue:${id}:now:${stored!.version}`);
    await flush();
    expect(jobs.map((job) => job.postId)).toEqual([id]);
    const fresh = await drafts.get(tenant, id);
    expect(fresh?.draft.state).toBe('publishing');
    expect(fresh?.publishAt).toBeUndefined();
    expect(await drafts.takenSlots(tenant)).toEqual([]);
  });

  it('«у чернетку» frees the slot; a stale button changes nothing', async () => {
    const id = await readyPost();
    await press(`draft:${id}:publish:queue`);
    const [stored] = await drafts.listScheduled(tenant);
    await press(`queue:${id}:back:${stored!.version}`);
    expect((await drafts.get(tenant, id))?.draft.state).toBe('ready');
    expect(sentTexts(calls).at(-1)).toBe(botTexts.queueBackDoneText);

    await press(`draft:${id}:publish:queue`);
    await press(`queue:${id}:now:${stored!.version}`);
    expect(sentTexts(calls).at(-1)).toBe(botTexts.queueStaleText);
    expect(jobs).toEqual([]);
    expect((await drafts.get(tenant, id))?.draft.state).toBe('scheduled');
  });
});
