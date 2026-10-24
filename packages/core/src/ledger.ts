import { z } from 'zod';

import type { Post } from './post';
import type { PublishLedger } from './ports/store';

const remoteIdSchema = z.union([z.number(), z.string()]);

/**
 * Publish ledger: the idempotency record of what has been delivered where
 * (architecture section 3). Types live in `ports/store.ts` (T04b); this
 * module holds the pure transition functions and JSON (de)serialization.
 * Every function returns a new ledger — ledgers are immutable.
 *
 * The ledger is granular per send operation (the idempotency key is
 * `tenantId:postId:channel:opIndex`): a channel renders several operations
 * (UA album, DE reply, …) and a failure mid-batch must not lose the remote
 * ids already delivered, or a re-run would duplicate them.
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

export class LedgerTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerTransitionError';
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

/**
 * Index of the next operation to deliver on a channel — where a re-run
 * resumes. Equals the number of already recorded remote ids.
 */
export function nextOpIndex(ledger: PublishLedger, channel: string): number {
  return ledger.channels[channel]?.remoteIds.length ?? 0;
}

/**
 * Record one delivered operation: appends its remote id at `remoteIds[opIndex]`.
 * The op index must equal the number of already recorded ids (no gaps), so
 * remoteIds is always the exact delivery prefix. Status returns to
 * `pending` (delivery in progress) and any previous failure is cleared.
 */
export function markOpDelivered(
  ledger: PublishLedger,
  channel: string,
  opIndex: number,
  remoteId: number | string,
  now: Date,
): PublishLedger {
  const previous = ledger.channels[channel] ?? {
    status: 'pending' as const,
    remoteIds: [],
    updatedAt: now.toISOString(),
  };
  if (previous.status === 'done') {
    throw new LedgerTransitionError(
      `channel "${channel}" is already done; refusing to record another delivery`,
    );
  }
  if (opIndex !== previous.remoteIds.length) {
    throw new LedgerTransitionError(
      `channel "${channel}": cannot record op ${opIndex}; next op is ${previous.remoteIds.length}`,
    );
  }
  return updateEntry(ledger, channel, {
    status: 'pending',
    remoteIds: [...previous.remoteIds, remoteId],
    updatedAt: now.toISOString(),
  });
}

/**
 * Mark a channel fully delivered. The caller records every operation with
 * `markOpDelivered` first; the recorded remote ids stay available for
 * resolving `replyToOp` references on future renders.
 */
export function markDone(ledger: PublishLedger, channel: string, now: Date): PublishLedger {
  const previous = ledger.channels[channel];
  if (!previous) {
    throw new LedgerTransitionError(`channel "${channel}" has no ledger entry`);
  }
  return updateEntry(ledger, channel, {
    status: 'done',
    remoteIds: previous.remoteIds,
    updatedAt: now.toISOString(),
  });
}

/**
 * Mark a channel failed; keeps the error as the last one and preserves the
 * remote ids of operations delivered before the failure, so a re-run resumes
 * at `nextOpIndex` instead of duplicating them. Returns a new ledger.
 */
export function markFailed(
  ledger: PublishLedger,
  channel: string,
  error: string,
  now: Date,
): PublishLedger {
  const previous = ledger.channels[channel] ?? {
    status: 'pending' as const,
    remoteIds: [],
    updatedAt: now.toISOString(),
  };
  return updateEntry(ledger, channel, {
    status: 'failed',
    remoteIds: previous.remoteIds,
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
