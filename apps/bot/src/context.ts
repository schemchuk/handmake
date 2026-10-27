import type { Context } from 'grammy';

import type { D1DraftStore } from './draft-store';

/**
 * Context after the allow-list gate: `tenantId` and the draft repository are
 * attached only for allow-listed users, so handlers below the gate can rely
 * on both being present (and nothing below the gate ever runs for anyone
 * else — acceptance A6).
 */
export interface AppContext extends Context {
  tenantId: string;
  drafts: D1DraftStore;
}
