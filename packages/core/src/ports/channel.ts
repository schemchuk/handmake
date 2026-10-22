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
}

/** Identifier of a message (or poll) at the network, e.g. a Telegram message id. */
export type RemoteId = number | string;

/**
 * One send operation. `photoIndexes` reference `post.photos`; `replyTo`
 * references a RemoteId returned by an earlier operation of the same render.
 */
export type SendOperation =
  | {
      kind: 'mediaGroup';
      photoIndexes: number[];
      caption?: string;
      captionLang?: string;
      replyTo?: RemoteId;
    }
  | { kind: 'message'; text: string; lang: string; replyTo?: RemoteId };

export interface PollSpec {
  question: string;
  options: string[];
  photoIndexes?: number[];
}

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
}

export interface ChannelAdapter {
  readonly key: string;
  readonly capabilities: ChannelCapabilities;
  render(post: Post, settings: unknown): SendOperation[];
  deliver(ops: SendOperation[], ctx: DeliverContext): Promise<RemoteId[]>;
  openPoll?(poll: PollSpec, ctx: DeliverContext): Promise<RemoteId>;
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
