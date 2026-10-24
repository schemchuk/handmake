import type { Post, TenantConfig } from '@handmake/core';

import type { DispatchPayload } from './payload';
import { newUlid } from './ulid';

export interface BuildPostDeps {
  now?: Date;
  newId?: () => string;
}

/** Turn a dispatch payload into a post ready for the content store. */
export function buildPostFromPayload(
  payload: DispatchPayload,
  tenant: TenantConfig,
  deps: BuildPostDeps = {},
): Post {
  const now = deps.now ?? new Date();
  return {
    id: deps.newId?.() ?? newUlid(now),
    date: now.toISOString(),
    publishAt: 'now',
    type: 'free',
    tenant: tenant.id,
    channels: Object.keys(tenant.channels),
    photos: payload.fileIds.map((_, i) => `photo-${i + 1}.jpg`),
    versions: Object.fromEntries(
      Object.keys(payload.texts).map((lang) => [lang, { provenance: payload.provenance }]),
    ),
    texts: payload.texts,
  };
}
