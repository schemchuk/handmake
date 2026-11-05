import { readFileSync } from 'node:fs';

import { parseTenantConfig, readWorkDraftData } from '@handmake/core';
import type { Collection, GeneratedWorkText, TextGenerationRequest } from '@handmake/core';
import { FakePublishRunner, FakeTranslator } from '@handmake/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
const config = parseTenantConfig(
  readFileSync(new URL('../../../config/tenants/faden-und-stimmung.yaml', import.meta.url), 'utf8'),
);
const collection: Collection = {
  tenant,
  slug: 'fixture',
  order: 0,
  versions: {
    uk: { title: 'UA collection', description: 'UA fixture', provenance: 'human' },
    de: { title: 'DE collection', description: 'DE fixture', provenance: 'human' },
  },
  cover: { workId: '01JBCA1B2C3D4E5F6G7H8J9K0M', fileName: 'a.jpg' },
};
let drafts: ReturnType<typeof createD1DraftStore>;
let bot: ReturnType<typeof createBot>;
let calls: ReturnType<typeof mockTelegramApi>;
let tasks: Promise<void>[];
let id: string;
let publish: FakePublishRunner;
let translator: FakeTranslator;
const list = vi.fn<() => Promise<Collection[]>>();
const load = vi.fn(async (_id: string) => config);
const uk = vi.fn<(_request: TextGenerationRequest) => Promise<GeneratedWorkText>>();
const de = vi.fn<(text: string) => Promise<GeneratedWorkText>>();
const factory = vi.fn();
const logError = vi.fn();
beforeEach(async () => {
  logError.mockReset();
  drafts = createD1DraftStore(await makeD1());
  tasks = [];
  publish = new FakePublishRunner();
  translator = new FakeTranslator();
  list.mockReset().mockResolvedValue([structuredClone(collection)]);
  load.mockReset().mockResolvedValue(config);
  uk.mockReset().mockResolvedValue({
    version: {
      description: 'UA generated',
      provenance: 'ai-assisted',
      model: 'model-ua',
      prompt: 'ua@1',
    },
    notes: '',
  });
  de.mockReset().mockImplementation(async (text) => ({
    version: {
      description: `DE:${text}`,
      provenance: 'ai-assisted',
      model: 'model-de',
      prompt: 'de@1',
    },
    notes: '',
  }));
  factory
    .mockReset()
    .mockResolvedValue({ generateUkrainian: uk, translateUkrainian: de, generate: vi.fn() });
  bot = createBot({
    token: 'TEST_TOKEN',
    drafts,
    texts: botTexts,
    translator,
    publishRunner: publish,
    resolveTenant: (user) => (user === 11 ? tenant : user === 12 ? 'other' : undefined),
    background: (task) => {
      tasks.push(task());
    },
    work: {
      logError,
      collections: { listCollections: list },
      configs: { load },
      textGeneratorFor: factory,
    },
  });
  calls = mockTelegramApi(bot);
  await bot.init();
});
const send = (text: string, user = 11) => bot.handleUpdate(textUpdate(user, text));
const press = (data: string, user = 11) => bot.handleUpdate(callbackQueryUpdate(user, user, data));
const get = async () => (await drafts.get(tenant, id))!;
const flush = async () => {
  while (tasks.length) await tasks.shift();
};
function buttons(): { text: string; callback_data: string }[] {
  const payload = [...calls]
    .reverse()
    .find((c) => c.method === 'sendMessage' && c.payload['reply_markup']);
  const markup = payload?.payload['reply_markup'] as {
    inline_keyboard: { text: string; callback_data: string }[][];
  };
  return markup?.inline_keyboard.flat() ?? [];
}
async function start(kind = 'worn') {
  await send('/work');
  id = (await drafts.getChatSession(tenant, '11'))!.draftId!;
  await press(`work:${id}:kind:${kind}`);
}
async function selectExisting() {
  await start();
  await press(buttons().find((b) => b.callback_data.includes(':pick:'))!.callback_data);
}
async function contentAndGenerate() {
  await bot.handleUpdate(photoUpdate(11, ['photo-1']));
  await send('Author note');
  await send('/done');
  await flush();
}

describe('/work author flow', () => {
  it('creates a localized collection from plain text, previews, cancels consent and explicitly dispatches the approved work', async () => {
    await start('interior');
    await press(buttons().find((b) => b.text === botTexts.workCreateButton)!.callback_data);
    await send('UA title\nUA description\nDE title\nDE description');
    expect((await get()).draft.texts).toEqual({});
    await contentAndGenerate();
    expect(publish.jobs).toEqual([]);
    await press(`work:${id}:announce:yes`);
    await press(`draft:${id}:publish`);
    await press(`draft:${id}:publish:cancel`);
    expect(publish.jobs).toEqual([]);
    await press(`draft:${id}:publish`);
    await press(`draft:${id}:publish:confirm`);
    await flush();
    const job = publish.jobs[0]!;
    expect(job.kind).toBe('work');
    expect(job.work).toMatchObject({
      kind: 'interior',
      channels: ['telegram'],
      collection: `collection-${id.toLowerCase()}`,
      newCollection: {
        versions: {
          uk: { title: 'UA title', description: 'UA description', provenance: 'human' },
          de: { title: 'DE title', description: 'DE description', provenance: 'human' },
        },
      },
      versions: {
        uk: { provenance: 'ai-generated', model: 'model-ua' },
        de: { provenance: 'ai-generated', model: 'model-de' },
      },
    });
    expect(translator.requests).toEqual([]);
    await press(`draft:${id}:publish:confirm`);
    await flush();
    expect(publish.jobs).toHaveLength(1);
  });

  it('selects an existing collection and keeps site-only publication as the initial choice', async () => {
    await selectExisting();
    await contentAndGenerate();
    expect(readWorkDraftData((await get()).draft).config).toEqual({
      kind: 'worn',
      collection: 'fixture',
      channels: [],
    });
    expect(buttons().some((b) => b.text === botTexts.workAnnounceOff)).toBe(true);
    await press(`draft:${id}:publish`);
    await press(`draft:${id}:publish:confirm`);
    await flush();
    expect(publish.jobs[0]!.work?.channels).toEqual([]);
  });

  it('rejects strangers and foreign-tenant callbacks without reading collections or changing the draft', async () => {
    await send('/work', 99);
    expect(list).not.toHaveBeenCalled();
    expect(await drafts.getChatSession(tenant, '99')).toBeUndefined();
    await start();
    const before = await get();
    list.mockClear();
    await press(`work:${id}:kind:interior`, 12);
    await press(`draft:${id}:publish:confirm`, 12);
    await flush();
    expect(await get()).toEqual(before);
    expect(list).not.toHaveBeenCalled();
    expect(publish.jobs).toEqual([]);
  });

  it('switches post/work collecting sessions without mixing notes, photos or collection input', async () => {
    await send('/new');
    const postId = (await drafts.getChatSession(tenant, '11'))!.draftId!;
    await send('Post note');
    await selectExisting();
    await send('Work note');
    await send('/new');
    await send('Post continuation');
    expect((await drafts.get(tenant, postId))?.draft.texts['uk']).toContain('Post continuation');
    expect((await drafts.get(tenant, postId))?.draft.texts['uk']).not.toContain('Work note');
    await send('/work');
    await send('Work continuation');
    expect((await get()).draft.texts['uk']).toContain('Work continuation');
    expect((await get()).draft.texts['uk']).not.toContain('Post note');
  });

  it('retries only DE after failure and regenerates DE from an edited UA with approval provenance', async () => {
    await selectExisting();
    de.mockRejectedValueOnce(new Error('DE unavailable'));
    await contentAndGenerate();
    expect((await get()).draft.state).toBe('failed');
    await send('Not an implicit German replacement');
    expect((await get()).draft.texts['de']).toBeUndefined();
    await send('/done');
    await flush();
    expect(uk).toHaveBeenCalledOnce();
    expect(de).toHaveBeenCalledTimes(2);
    await press(`draft:${id}:edit:uk`);
    await send('Edited UA');
    await press(`draft:${id}:regen-de`);
    await flush();
    expect(uk).toHaveBeenCalledOnce();
    expect(de).toHaveBeenLastCalledWith('Edited UA');
    await press(`draft:${id}:publish:confirm`);
    await flush();
    expect(publish.jobs[0]!.work?.versions['uk']?.provenance).toBe('ai-assisted');
    expect(publish.jobs[0]!.work?.versions['de']?.provenance).toBe('ai-assisted');
  });

  it('offers discard/start-over for uncertain UA and never repeats the paid UA call', async () => {
    await selectExisting();
    uk.mockRejectedValueOnce(new Error('unknown accounting'));
    await contentAndGenerate();
    expect(sentTexts(calls)).toContain(botTexts.workUncertainText);
    await send('/done');
    await flush();
    expect(uk).toHaveBeenCalledOnce();
    expect(de).not.toHaveBeenCalled();
    const discarded = id;
    await press(`draft:${id}:discard`);
    await send('/work');
    expect(await drafts.get(tenant, discarded)).toBeUndefined();
    expect((await drafts.getChatSession(tenant, '11'))!.draftId).not.toBe(discarded);
  });

  it('does not collect malformed new-collection input as a work note', async () => {
    await start();
    await press(buttons().find((b) => b.text === botTexts.workCreateButton)!.callback_data);
    await send('Only one field');
    expect((await get()).draft.texts).toEqual({});
    expect(factory).not.toHaveBeenCalled();
  });

  it('keeps selection pinned to a slug across photo updates and a reordered source, with bounded callback bytes', async () => {
    const long = { ...collection, slug: 'a'.repeat(100) };
    list.mockResolvedValueOnce([long]);
    await start();
    const choice = buttons().find((b) => b.callback_data.includes(':pick:'))!;
    expect(new TextEncoder().encode(choice.callback_data).length).toBeLessThanOrEqual(64);
    await bot.handleUpdate(photoUpdate(11, ['photo-1']));
    list.mockResolvedValueOnce([collection, long]);
    await press(choice.callback_data);
    expect(readWorkDraftData((await get()).draft).config.collection).toBe(long.slug);
  });

  it('rejects a stale menu and invalid template without changing the configured work', async () => {
    await start();
    const choice = buttons().find((b) => b.callback_data.includes(':pick:'))!;
    await press(`work:${id}:kind:closeup`);
    const before = await get();
    await press(choice.callback_data);
    expect(await get()).toEqual(before);
    await press(`work:${id}:kind:unknown`);
    expect(await get()).toEqual(before);
  });

  it('surfaces source/configuration errors before any paid generation', async () => {
    list.mockRejectedValueOnce(new Error('offline'));
    await start();
    expect(sentTexts(calls)).toContain(botTexts.workSetupErrorText);
    await send('/done');
    expect(factory).not.toHaveBeenCalled();
    await press(`work:${id}:kind:worn`);
    const choice = buttons().find((b) => b.callback_data.includes(':pick:'))!;
    load.mockResolvedValueOnce({ ...config, id: 'other' });
    await press(choice.callback_data);
    expect(sentTexts(calls)).toContain(botTexts.workSetupErrorText);
    expect(factory).not.toHaveBeenCalled();
  });

  it('routes callback and text setup failures through the redacting composition logger', async () => {
    await start();
    const error = new Error('fixture failure');
    load.mockRejectedValueOnce(error);
    await press(buttons().find((b) => b.callback_data.includes(':pick:'))!.callback_data);
    expect(logError).toHaveBeenLastCalledWith('work setup failed', error, tenant);
    await press(buttons().find((b) => b.text === botTexts.workCreateButton)!.callback_data);
    load.mockRejectedValueOnce(error);
    await send('UA title\nUA text\nDE title\nDE text');
    expect(logError).toHaveBeenCalledTimes(2);
    expect(logError).toHaveBeenLastCalledWith('work setup failed', error, tenant);
  });

  it('rejects existing collections with incomplete tenant-language metadata', async () => {
    await start();
    const choice = buttons().find((b) => b.callback_data.includes(':pick:'))!;
    list.mockResolvedValueOnce([{ ...collection, versions: { uk: collection.versions['uk']! } }]);
    await press(choice.callback_data);
    expect((await get()).draft.extras['work']).toBeUndefined();
    expect(factory).not.toHaveBeenCalled();
  });

  it('blocks generation until template, collection, note and photos are present', async () => {
    await send('/work');
    id = (await drafts.getChatSession(tenant, '11'))!.draftId!;
    await send('/done');
    expect(factory).not.toHaveBeenCalled();
    await press(`work:${id}:kind:worn`);
    await press(buttons().find((b) => b.callback_data.includes(':pick:'))!.callback_data);
    await send('/done');
    expect(sentTexts(calls)).toContain(botTexts.workNeedsPhotosText);
  });
});

it('does not block a long site-only description on channel rendering limits', async () => {
  await selectExisting();
  uk.mockResolvedValueOnce({
    version: {
      description: 'a'.repeat(5000),
      provenance: 'ai-assisted',
      model: 'fixture',
      prompt: 'fixture@1',
    },
    notes: '',
  });
  await contentAndGenerate();
  expect(buttons().some((b) => b.text === botTexts.publishButton)).toBe(true);
  expect(sentTexts(calls).at(-1)).not.toContain(botTexts.previewCaptionSplitNote);
});

it('routes a new-collection reply to the work explicitly selected by an old setup button', async () => {
  await start();
  const create = buttons().find((b) => b.text === botTexts.workCreateButton)!;
  await send('/new');
  const postId = (await drafts.getChatSession(tenant, '11'))!.draftId!;
  await send('Post note');
  await press(create.callback_data);
  await send(`UA name
UA description
DE name
DE description`);
  expect((await drafts.get(tenant, postId))?.draft.texts['uk']).toBe('Post note');
  expect(readWorkDraftData((await get()).draft).config.newCollection?.versions['uk']?.title).toBe(
    'UA name',
  );
});

it('does not display foreign collections even if a supplied reader violates tenant isolation', async () => {
  list.mockResolvedValueOnce([
    {
      ...collection,
      tenant: 'other',
      slug: 'foreign',
      versions: { uk: { title: 'Foreign fixture', description: 'Fixture', provenance: 'human' } },
    },
    collection,
  ]);
  await start();
  expect(buttons().some((b) => b.text === 'Foreign fixture')).toBe(false);
});

it('does not generate from old configuration while a replacement template/collection is pending', async () => {
  await selectExisting();
  await bot.handleUpdate(photoUpdate(11, ['photo-1']));
  await send('Author note');
  await press(`work:${id}:kind:interior`);
  await send('/done');
  await flush();
  expect(factory).not.toHaveBeenCalled();
  const choose = buttons().find((button) => button.callback_data.includes(':pick:'))!;
  await press(choose.callback_data);
  await press(`work:${id}:kind:interior`);
  await press(buttons().find((button) => button.text === botTexts.workCreateButton)!.callback_data);
  await send('/done');
  await flush();
  expect(factory).not.toHaveBeenCalled();
});
