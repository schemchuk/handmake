import { z } from 'zod';

import type { Post } from './post';
import type { PublishLedger } from './ports/store';

const remoteIdSchema = z.union([z.number(), z.string()]);

/**
 * Publish ledger: the idempotency record of what has been delivered where
 * (architecture section 3). Types live in `ports/store.ts` (T04b); this
 * module holds the pure transition functions and JSON (de)serialization.
 * Every function returns a new ledger — ledgers are immutable.
 */

export const ledgerEntrySchema = z.object({
  status: z.enum(['pending', 'done', 'failed']),
  remoteIds: z.array(remoteIdSchema),
  error: z.string().optional(),
  updatedAt: z.string(),
});
export type LedgerEntryParsed = z.infer<typeof ledgerEntrySchema>;

export const publishLedgerSchema = z.object({
  tenantId: z.string().min(1),
  postId: z.string().min(1),
  channels: z.record(z.string(), ledgerEntrySchema),
});
export type PublishLedgerParsed = z.infer<typeof publishLedgerSchema>;

export class LedgerParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerParseError';
  }
}

/** Create a fresh ledger with every channel of the post pending. */
export function initLedger(
  tenantId: string,
  postId: string,
  channels: string[],
  now: Date,
): PublishLedger {
  return {
    tenantId,
    postId,
    channels: Object.fromEntries(
      channels.map((channel) => [
        channel,
        { status: 'pending' as const, remoteIds: [], updatedAt: now.toISOString() },
      ]),
    ),
  };
}

/**
 * Channels of the post that still need delivery: no ledger entry, or an
 * entry that is not `done`. A failed channel is retried on re-run (F11);
 * a done channel is never returned again.
 */
export function pendingChannels(ledger: PublishLedger, post: Pick<Post, 'channels'>): string[] {
  return post.channels.filter((channel) => ledger.channels[channel]?.status !== 'done');
}

/** Mark a channel delivered. Returns a new ledger. */
export function markDone(
  ledger: PublishLedger,
  channel: string,
  remoteIds: (number | string)[],
  now: Date,
): PublishLedger {
  return updateEntry(ledger, channel, {
    status: 'done',
    remoteIds,
    updatedAt: now.toISOString(),
  });
}

/**
 * Mark a channel failed; keeps the error as the last one and preserves any
 * remote ids recorded before the failure (partial delivery). Returns a new
 * ledger.
 */
export function markFailed(
  ledger: PublishLedger,
  channel: string,
  error: string,
  now: Date,
): PublishLedger {
  const previous = ledger.channels[channel];
  return updateEntry(ledger, channel, {
    status: 'failed',
    remoteIds: previous?.remoteIds ?? [],
    error,
    updatedAt: now.toISOString(),
  });
}

function updateEntry(
  ledger: PublishLedger,
  channel: string,
  entry: PublishLedger['channels'][string],
): PublishLedger {
  return {
    ...ledger,
    channels: { ...ledger.channels, [channel]: entry },
  };
}

export function serializeLedger(ledger: PublishLedger): string {
  return JSON.stringify(ledger, null, 2);
}

export function parseLedger(json: string): PublishLedger {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    throw new LedgerParseError(`ledger is not valid JSON: ${(error as Error).message}`);
  }
  const result = publishLedgerSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.join('.') || '(root)';
    throw new LedgerParseError(`invalid ledger at ${path}: ${issue?.message ?? 'unknown error'}`);
  }
  return result.data;
}
