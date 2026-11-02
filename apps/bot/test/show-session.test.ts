import { readFileSync } from 'node:fs';
import { parseTenantConfig } from '@handmake/core';
import type { Work } from '@handmake/core';
import { FakePublishRunner, FakeTranslator } from '@handmake/core/testing';
import { beforeEach, expect, it, vi } from 'vitest';
import { createBot } from '../src/bot';
import { createD1DraftStore } from '../src/draft-store';
import { botTexts } from '../src/texts';
import {
  callbackQueryUpdate,
  makeD1,
  mockTelegramApi,
  photoUpdate,
  sentTexts,
  textUpdate,
} from './helpers';

const tenant = 'faden-und-stimmung';
const work: Work = {
  id: '01JBCA1B2C3D4E5F6G7H8J9K0M',
  tenant,
  date: '2026-11-01T12:00:00Z',
  collection: 'fixture',
  kind: 'worn',
  photos: ['original.jpg'],
  versions: { uk: { description: 'Author original', provenance: 'human' } },
};
const baseConfig = parseTenantConfig(
  readFileSync(new URL('../../../config/tenants/faden-und-stimmung.yaml', import.meta.url), 'utf8'),
);
let config: typeof baseConfig;
let drafts: ReturnType<typeof createD1DraftStore>;
let bot: ReturnType<typeof createBot>;
let calls: ReturnType<typeof mockTelegramApi>;
let runner: FakePublishRunner;
let translator: FakeTranslator;
let tasks: Promise<void>[];
const listWorks = vi.fn(async (_tenant: string) => [work]);
const readWork = vi.fn(async (_tenant: string, _id: string): Promise<Work | undefined> => work);
const load = vi.fn(async (_tenant: string) => config);
const generated = {
  version: {
    description: 'Generated description',
    provenance: 'ai-assisted' as const,
    model: 'fixture',
    prompt: 'fixture@1',
  },
  notes: '',
};
const generator = {
  generateUkrainian: vi.fn(async () => generated),
  translateUkrainian: vi.fn(async () => generated),
  generate: vi.fn(),
};
function build(enabled = true) {
  bot = createBot({
    token: 'TEST_TOKEN',
    drafts,
    texts: botTexts,
    translator,
    publishRunner: runner,
    resolveTenant: (id) => (id === 11 || id === 13 ? tenant : id === 12 ? 'other' : undefined),
    background: (task) => {
      tasks.push(task());
    },
    show: enabled ? { works: { listWorks, readWork }, configs: { load } } : undefined,
    work: {
      configs: { load },
      collections: {
        listCollections: async () => [
          {
            tenant,
            slug: 'fixture',
            order: 0,
            cover: { workId: work.id, fileName: 'original.jpg' },
            versions: Object.fromEntries(
              config.languages.map((lang) => [
                lang,
                { title: 'Fixture', description: 'Fixture', provenance: 'human' as const },
              ]),
            ),
          },
        ],
      },
      textGeneratorFor: async () => generator,
    },
  });
  calls = mockTelegramApi(bot);
  return bot.init();
}
beforeEach(async () => {
  vi.clearAllMocks();
  drafts = createD1DraftStore(await makeD1());
  config = structuredClone(baseConfig);
  config.shows = {
    models: [],
    image: { model: 'fixture-image', eurPerImage: 0.1 },
    video: { model: 'fixture-video', eurPerSecond: 0.1 },
  };
  load.mockImplementation(async () => config);
  listWorks.mockResolvedValue([structuredClone(work)]);
  readWork.mockResolvedValue(structuredClone(work));
  runner = new FakePublishRunner();
  translator = new FakeTranslator();
  tasks = [];
  await build();
});
const send = (text: string, user = 11) => bot.handleUpdate(textUpdate(user, text));
const press = (data: string, user = 11) => bot.handleUpdate(callbackQueryUpdate(user, user, data));
const session = () => drafts.getChatSession(tenant, '11');
const get = (id: string) => drafts.get(tenant, id);
function button(action: string) {
  const call = [...calls].reverse().find((c) => c.payload['reply_markup']);
  const markup = call!.payload['reply_markup'] as {
    inline_keyboard: { callback_data: string }[][];
  };
  return markup.inline_keyboard.flat().find((b) => b.callback_data.includes(`:${action}:`))!
    .callback_data;
}
async function flush() {
  while (tasks.length) await tasks.shift();
}

it('denies strangers before accessing content or persistence', async () => {
  await send('/show', 99);
  expect(listWorks).not.toHaveBeenCalled();
  expect(load).not.toHaveBeenCalled();
  expect(await drafts.getChatSession(tenant, '99')).toBeUndefined();
  expect(sentTexts(calls)).toContain(botTexts.refusalText);
});

it('reports absent, disabled, mismatched and unavailable configuration without creating a show', async () => {
  await build(false);
  await send('/show');
  await build();
  config.shows = undefined;
  await send('/show');
  config = { ...config, id: 'other' };
  await send('/show');
  load.mockRejectedValueOnce(new Error('unavailable'));
  await send('/show');
  expect(await session()).toBeUndefined();
  expect(listWorks).not.toHaveBeenCalled();
  expect(sentTexts(calls).every((text) => text === botTexts.showUnavailableText)).toBe(true);
});

it('persists selection across bot instances, revalidates the chosen id and preserves author text', async () => {
  await send('/show');
  const id = (await session())!.draftId!;
  const choice = button('pick');
  expect(new TextEncoder().encode(choice).length).toBeLessThanOrEqual(64);
  await build();
  await press(choice);
  expect(readWork).toHaveBeenLastCalledWith(tenant, work.id);
  expect((await get(id))!.draft.extras['showSelection']).toMatchObject({ workId: work.id });
  const before = await get(id);
  await send('/show');
  await send('Do not collect');
  await bot.handleUpdate(photoUpdate(11, ['photo']));
  await send('/done');
  await send('/done@test_bot');
  expect(await get(id)).toEqual(before);
  expect(work.versions['uk']!.description).toBe('Author original');
  expect(runner.jobs).toEqual([]);
  expect(translator.requests).toEqual([]);
  expect(tasks).toEqual([]);
});

it.each(['missing', 'foreign', 'wrong-id'])('rejects a %s work at selection time', async (kind) => {
  await send('/show');
  const choice = button('pick');
  const id = (await session())!.draftId!;
  const before = await get(id);
  readWork.mockResolvedValueOnce(
    kind === 'missing'
      ? undefined
      : {
          ...work,
          ...(kind === 'foreign' ? { tenant: 'other' } : { id: '01JBCA1B2C3D4E5F6G7H8J9K0Z' }),
        },
  );
  await press(choice);
  expect(await get(id)).toEqual(before);
  expect(sentTexts(calls)).toContain(botTexts.showMissingWorkText);
});

it('filters foreign works and rejects cross-tenant and stale callbacks', async () => {
  listWorks.mockResolvedValueOnce([
    { ...work, tenant: 'other', versions: { uk: { description: 'Foreign', provenance: 'human' } } },
    work,
  ]);
  await send('/show');
  const id = (await session())!.draftId!;
  const old = button('pick');
  expect(JSON.stringify(calls)).not.toContain('Foreign');
  const before = await get(id);
  readWork.mockClear();
  await press(old, 12);
  await press(old, 13);
  expect(await get(id)).toEqual(before);
  expect(readWork).not.toHaveBeenCalled();
  await send('/show');
  const current = button('pick');
  const updated = await get(id);
  await press(old);
  expect(await get(id)).toEqual(updated);
  await press(current);
  expect((await get(id))!.draft.extras['showSelection']).toMatchObject({ workId: work.id });
});

it('keeps post, work and show input separate, including armed post edits', async () => {
  await send('/new');
  const postId = (await session())!.draftId!;
  await send('Post');
  await send('/work');
  const workId = (await session())!.draftId!;
  await send('Work');
  await drafts.setPendingEdit(tenant, postId, 'uk', new Date());
  await send('/show');
  const showId = (await session())!.draftId!;
  await send('Show text');
  await bot.handleUpdate(photoUpdate(11, ['show-photo']));
  await send('/done');
  expect((await get(postId))!.draft.texts).toEqual({ uk: 'Post' });
  expect((await get(workId))!.draft.texts).toEqual({ uk: 'Work' });
  expect((await get(showId))!.draft.photoRefs).toEqual([]);
  await send('/new');
  await send('Edited post');
  expect((await get(postId))!.draft.texts).toEqual({ uk: 'Edited post' });
  await send('/work');
  await send('Work continued');
  expect((await get(workId))!.draft.texts['uk']).toContain('Work continued');
  await send('/show');
  expect((await session())!.draftId).toBe(showId);
});

it('hands off to work authoring, requires explicit approval and resumes only after publication', async () => {
  await send('/show');
  const showId = (await session())!.draftId!;
  await press(button('new'));
  const workId = (await session())!.draftId!;
  expect((await session())!.kind).toBe('work');
  expect((await get(showId))!.draft.extras['showSelection']).toMatchObject({
    awaitingWorkId: workId,
  });
  await send('/show');
  expect(sentTexts(calls).at(-1)).toBe(botTexts.showAwaitingWorkText);
  await send('/work');
  await press(`work:${workId}:kind:worn`);
  await press(button('pick'));
  await bot.handleUpdate(photoUpdate(11, ['original']));
  await send('Author note');
  await send('/done');
  await flush();
  expect((await get(workId))!.draft.state).toBe('ready');
  expect(runner.jobs).toEqual([]);
  readWork.mockResolvedValue({ ...work, id: workId });
  await send('/show');
  expect(sentTexts(calls).at(-1)).toBe(botTexts.showAwaitingWorkText);
  await send('/work');
  expect((await session())!.draftId).toBe(workId);
  expect((await get(workId))!.draft.state).toBe('ready');
  await press(`draft:${workId}:publish`);
  await press(`draft:${workId}:publish:confirm`);
  await flush();
  expect(runner.jobs).toHaveLength(1);
  expect(runner.jobs[0]!.kind).toBe('work');
  await send('/show');
  expect(sentTexts(calls).at(-1)).toBe(botTexts.showAwaitingWorkText);
  // The authenticated publication callback uses this guarded transition after the pipeline succeeds.
  await drafts.markPublished(tenant, workId, new Date());
  readWork.mockResolvedValueOnce(undefined);
  await send('/show');
  expect(sentTexts(calls).at(-1)).toBe(botTexts.showMissingWorkText);
  await build();
  await send('/show');
  expect((await session())!.draftId).toBe(showId);
  expect((await get(showId))!.draft.extras['showSelection']).toMatchObject({ workId });
  expect((await get(showId))!.draft.extras['show']).toBeUndefined();
  expect(sentTexts(calls).at(-1)).toBe(botTexts.showLinkedText);
});

it('discards only the active show and allows a fresh selection', async () => {
  await send('/new');
  const postId = (await session())!.draftId!;
  await send('/show');
  const id = (await session())!.draftId!;
  await send('/discard');
  expect(await get(id)).toBeUndefined();
  expect(await get(postId)).toBeDefined();
  await send('/show');
  expect((await session())!.draftId).not.toBe(id);
});
