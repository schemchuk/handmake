import type { Post } from '../post';
import type { SecretResolver } from './services';

/**
 * A channel adapter turns a post into channel-specific send operations
 * (pure `render`) and delivers them (effectful `deliver`). Core code must
 * never branch on a specific network — capabilities drive rendering.
 */

export interface ChannelCapabilities {
  maxPhotos: number;
  captionLimit: number;
  messageLimit: number;
  polls: boolean;
  /** Max options of one poll; only meaningful when `polls` is true. */
  pollMaxOptions: number;
  /** Max chars of a poll question; only meaningful when `polls` is true. */
  pollQuestionLimit: number;
  /** Max chars of one poll option; only meaningful when `polls` is true. */
  pollOptionLimit: number;
}

/** Identifier of a message (or poll) at the network, e.g. a Telegram message id. */
export type RemoteId = number | string;

/**
 * One send operation. `photoIndexes` reference `post.photos`; `replyToOp`
 * references an earlier operation (by index) of the same render batch, so
 * `render` stays pure — adapters resolve it to a network id at delivery.
 */
export type SendOperation =
  | {
      kind: 'mediaGroup';
      photoIndexes: number[];
      caption?: string;
      captionLang?: string;
      replyToOp?: number;
    }
  | { kind: 'message'; text: string; lang: string; replyToOp?: number }
  | {
      kind: 'poll';
      question: string;
      options: string[];
      replyToOp?: number;
    };

export interface PollResult {
  /** Votes per option, in the order the options were given. */
  optionVotes: number[];
  totalVotes: number;
}

export interface DeliverContext {
  /** Resolves secret names from tenant config to values. */
  secrets: SecretResolver;
  /** Equals `idempotencyKey(...)` without the op index; adapters suffix it. */
  idempotencyBase: string;
  /**
   * The tenant's per-channel settings object (e.g. `{ channelId: 'TELEGRAM_CHANNEL_ID' }`).
   * The adapter interprets and validates it; core stays network-agnostic.
   */
  settings: unknown;
  /**
   * The post's processed photo bytes, aligned by index with
   * `SendOperation.photoIndexes`. The publisher assembles them via its
   * MediaSource; the adapter never downloads anything itself.
   */
  photos: Uint8Array[];
}

/**
 * Per-op delivery reporting. The caller (publisher) passes the resume point
 * from the ledger and a callback the adapter awaits after each op, so the
 * ledger is persisted between ops and the at-least-once window shrinks to
 * a single op.
 */
export interface DeliverProgress {
  /** Index of the first op to send (ledger nextOpIndex). Ops before it were delivered. */
  startAt: number;
  /** Already-delivered remote ids, the exact prefix; used to resolve replyToOp on resume. */
  knownIds: RemoteId[];
  /** Called (and awaited) after each op is accepted by the network, before the next op is sent. */
  onDelivered(opIndex: number, remoteId: RemoteId): void | Promise<void>;
}

export interface ChannelAdapter {
  readonly key: string;
  readonly capabilities: ChannelCapabilities;
  render(post: Post, settings: unknown): SendOperation[];
  /**
   * Delivers ops in order and returns the complete remote id array
   * (known prefix + newly delivered), aligned by op index. Implementations
   * with no native idempotency (e.g. Telegram) treat the ledger-driven
   * resume via `progress` as their idempotency mechanism.
   */
  deliver(
    ops: SendOperation[],
    ctx: DeliverContext,
    progress?: DeliverProgress,
  ): Promise<RemoteId[]>;
  closePoll?(pollId: RemoteId, ctx: DeliverContext): Promise<PollResult>;
}

/**
 * Idempotency key for one delivered operation. Re-running a publish must
 * never post the same item twice; the ledger records these keys.
 */
export function idempotencyKey(
  tenantId: string,
  postId: string,
  channel: string,
  opIndex: number,
): string {
  return `${tenantId}:${postId}:${channel}:${opIndex}`;
}

/** Key shared by all operations of one post on one channel. */
export function idempotencyBase(tenantId: string, postId: string, channel: string): string {
  return `${tenantId}:${postId}:${channel}`;
}
