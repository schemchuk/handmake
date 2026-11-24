import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { pinterestSecretNames, youtubeSecretNames } from '@handmake/channels';
import {
  collectionSchema,
  videoOnlyChannelKeys,
  workOnlyChannelKeys,
  workPublicationSchema,
} from '@handmake/core';
import type { ContentStore, Post, TenantConfig } from '@handmake/core';

import { buildWorkFromPayload } from './build-work';
import type { DispatchPayload } from './payload';

const workChannelSecrets: Record<string, readonly string[]> = {
  youtube: youtubeSecretNames,
  pinterest: pinterestSecretNames,
};

export interface SkippedChannel {
  channel: string;
  reason: 'no video' | 'secrets missing' | 'not in the first run' | 'site excluded' | 'live only';
}

/** Validate before media fetches/writes; announcements are transient Post projections, not blog posts. */
export async function prepareWorkPublication(
  payload: DispatchPayload,
  tenant: TenantConfig,
  store: ContentStore,
  siteExcluded = false,
  env: NodeJS.ProcessEnv = {},
) {
  const details = workPublicationSchema.parse(payload.work);
  const checkLanguages = (versions: Record<string, unknown>) => {
    if (
      Object.keys(versions).length !== tenant.languages.length ||
      tenant.languages.some((lang) => !(lang in versions))
    ) {
      throw new Error('work/collection languages must match tenant languages');
    }
  };
  checkLanguages(details.versions);
  if (details.channels.some((channel) => !Object.hasOwn(tenant.channels, channel))) {
    throw new Error('work announcement channel is not enabled for tenant');
  }
  const work = buildWorkFromPayload({
    kind: 'work',
    tenantId: tenant.id,
    draftId: payload.draftId,
    date: details.date,
    workKind: details.kind,
    collection: details.collection,
    fileIds: payload.fileIds,
    versions: details.versions,
  });
  if (details.videoPeople)
    work.video = { fileName: 'video.mp4', provenance: 'human', people: details.videoPeople };
  const existingCollection = await store.readCollection(tenant.id, work.collection);
  const collection = details.newCollection
    ? collectionSchema.parse({
        ...details.newCollection,
        tenant: tenant.id,
        slug: work.collection,
        cover: { workId: work.id, fileName: work.photos[0]! },
      })
    : undefined;
  if (collection) checkLanguages(collection.versions);
  if (!existingCollection && !collection) throw new Error('collection is unavailable for tenant');
  if (existingCollection) {
    checkLanguages(existingCollection.versions);
    if (collection && !isDeepStrictEqual(collection, existingCollection)) {
      throw new Error('new collection conflicts with existing collection');
    }
  }
  const existing = await store.readWork(tenant.id, work.id);
  if (siteExcluded || existing?.siteExcluded || work.siteExcluded) work.siteExcluded = true;
  if (
    existing &&
    !isDeepStrictEqual(
      { ...existing, siteExcluded: work.siteExcluded },
      { ...work, siteExcluded: work.siteExcluded },
    )
  )
    throw new Error('work publish identity is immutable');
  if (await store.readPost(tenant.id, work.id))
    throw new Error('work id already belongs to a post');
  const ledger = await store.readLedger(tenant.id, work.id);
  // Omit unavailable work-only channels before creating the ledger.
  // On retry the ledger decides, so the set stays stable.
  const videoOnly = (channel: string) => videoOnlyChannelKeys.includes(channel);
  const skippedChannels: SkippedChannel[] = details.channels.flatMap(
    (channel): SkippedChannel[] => {
      if (!workOnlyChannelKeys.includes(channel)) return [];
      if (ledger)
        return ledger.channels[channel] ? [] : [{ channel, reason: 'not in the first run' }];
      if (videoOnly(channel) && !work.video) return [{ channel, reason: 'no video' }];
      if (channel === 'pinterest') {
        if (work.siteExcluded) return [{ channel, reason: 'site excluded' }];
        if (env['GITHUB_ACTIONS'] === 'true' && !env['SECRETS_WRITE_TOKEN']?.trim())
          return [{ channel, reason: 'secrets missing' }];
        if (env['PINTEREST_SANDBOX_ONLY'] === 'true' && !tenant.channels.pinterest?.sandbox)
          return [{ channel, reason: 'live only' }];
      }
      return (workChannelSecrets[channel] ?? []).some((name) => !env[name]?.trim())
        ? [{ channel, reason: 'secrets missing' }]
        : [];
    },
  );
  const channels = details.channels.filter(
    (channel) => !skippedChannels.some((skip) => skip.channel === channel),
  );
  if (ledger && !isDeepStrictEqual(Object.keys(ledger.channels).sort(), [...channels].sort())) {
    throw new Error('work announcement channels are immutable on retry');
  }
  const post: Post = {
    id: work.id,
    tenant: work.tenant,
    date: work.date,
    publishAt: 'now',
    type: 'free',
    channels,
    ...(work.siteExcluded ? { siteExcluded: true } : {}),
    photos: work.photos,
    texts: Object.fromEntries(
      tenant.languages.map((lang) => [lang, work.versions[lang]!.description]),
    ),
    versions: Object.fromEntries(
      Object.entries(work.versions).map(([lang, { description: _description, ...version }]) => [
        lang,
        version,
      ]),
    ),
  };
  return {
    work,
    post,
    collection: existingCollection ? undefined : collection,
    skippedChannels,
    paths: [
      path.join('content', 'works', work.id),
      ...(collection ? [path.join('content', 'collections', `${work.collection}.md`)] : []),
    ],
  };
}
