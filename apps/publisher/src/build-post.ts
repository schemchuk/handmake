import { isUlid, newUlid } from '@handmake/core';
import type { Post, TenantConfig } from '@handmake/core';

import type { DispatchPayload } from './payload';

export interface BuildPostDeps {
  now?: Date;
  newId?: () => string;
}

/**
 * Turn a dispatch payload into a post ready for the content store. A draftId
 * that is already a ULID is reused as the post id, so re-running the publish
 * with the same payload finds the same post (and its ledger) again.
 */
export function buildPostFromPayload(
  payload: DispatchPayload,
  tenant: TenantConfig,
  deps: BuildPostDeps = {},
): Post {
  const now = deps.now ?? new Date();
  return {
    id: isUlid(payload.draftId) ? payload.draftId : (deps.newId?.() ?? newUlid(now)),
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
