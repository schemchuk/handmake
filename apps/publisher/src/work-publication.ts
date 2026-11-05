import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { collectionSchema, workPublicationSchema } from '@handmake/core';
import type { ContentStore, Post, TenantConfig } from '@handmake/core';

import { buildWorkFromPayload } from './build-work';
import type { DispatchPayload } from './payload';

/** Validate before media fetches/writes; announcements are transient Post projections, not blog posts. */
export async function prepareWorkPublication(
  payload: DispatchPayload,
  tenant: TenantConfig,
  store: ContentStore,
  siteExcluded = false,
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
  if (
    ledger &&
    !isDeepStrictEqual(Object.keys(ledger.channels).sort(), [...details.channels].sort())
  ) {
    throw new Error('work announcement channels are immutable on retry');
  }
  const post: Post = {
    id: work.id,
    tenant: work.tenant,
    date: work.date,
    publishAt: 'now',
    type: 'free',
    channels: details.channels,
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
    paths: [
      path.join('content', 'works', work.id),
      ...(collection ? [path.join('content', 'collections', `${work.collection}.md`)] : []),
    ],
  };
}
