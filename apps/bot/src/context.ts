import type { Context } from 'grammy';

/**
 * Context after the allow-list gate: `tenantId` and the D1 binding are
 * attached only for allow-listed users, so handlers below the gate can rely
 * on both being present (and nothing below the gate ever runs for anyone
 * else — acceptance A6).
 */
export interface AppContext extends Context {
  tenantId: string;
  db: D1Database;
}
