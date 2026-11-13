import type { Post } from '../post';
import type { Show } from '../show';
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
 * One send operation. `photoIndexes` reference the content's ordered images; `replyToOp`
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
  | { kind: 'video'; videoSource?: 'authentic'; replyToOp?: number }
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

/**
 * Context for the optional comments capability (F34): secret resolution
 * only — no photos, no idempotency base. Watermarks, dedupe and the
 * at-most-once reply guarantee live in the caller (D1), the capability
 * itself is stateless.
 */
export interface ChannelCommentsContext {
  /** Contest collection only: omit the publishing account’s own comments. */
  excludeOwnerComments?: boolean;
  /** Resolves secret names from tenant config to values. */
  secrets: SecretResolver;
}

/** One of our own posts at the network, as seen by the comments reader. */
export interface ChannelPostRef {
  /** The post's id at the network. */
  id: string;
  /** Creation instant reported by the network (ISO 8601), when present. */
  createdAt?: string;
}

/**
 * One comment on our own post. `handle` and `text` are reader personal
 * data: the capability never puts them into errors or logs, and the
 * caller (T49c) keeps them out of Git.
 */
export interface ChannelComment {
  /** Network account identity, when available; transient vote collection only. */
  accountId?: string;
  /** The comment's id at the network. */
  id: string;
  /** Commenter's handle at the network (Instagram username, Facebook name). */
  handle: string;
  /** Comment text as sent by the commenter. */
  text: string;
  /** Creation instant reported by the network (ISO 8601); '' when absent. */
  createdAt: string;
}

/**
 * Optional comment reader/reply capability (F34, T49b). Only networks
 * with a comments API expose it; `ChannelAdapter.comments` stays undefined
 * elsewhere (e.g. Telegram: its discussion group is explicitly out of
 * scope, spec F35). All operations are bounded and retried like `deliver`.
 */
export interface ChannelCommentsCapability {
  /**
   * Our recent posts at the network, newest first, at most `limit` items
   * (a positive integer) across a bounded number of pages.
   */
  listPosts(limit: number, ctx: ChannelCommentsContext): Promise<ChannelPostRef[]>;
  /**
   * Comments on one of our posts. `since` is a watermark instant from the
   * caller's store. The network filter is inclusive and unreliable, so the
   * capability applies the watermark client-side too: entries with a
   * parseable `createdAt` before `since` are dropped; entries at exactly
   * `since` are kept (the watermark is inclusive — Graph timestamps have
   * second resolution) and the caller's dedupe by id covers their repeats.
   * Entries without a parseable timestamp may repeat across calls as well,
   * and the caller must dedupe by id. Undefined collects the bounded recent
   * page(s). Never returns our own replies.
   */
  listComments(
    postId: RemoteId,
    since: Date | undefined,
    ctx: ChannelCommentsContext,
  ): Promise<ChannelComment[]>;
  /**
   * Replies to one comment with the given (already approved) text and
   * returns the reply's remote id. The at-most-once guarantee is the
   * caller's claim on its row; this is a plain network write.
   */
  replyToComment(commentId: RemoteId, text: string, ctx: ChannelCommentsContext): Promise<RemoteId>;
}

/**
 * One new reader comment handed to the AI drafter (F34, T49c1). The text
 * and handle are reader personal data: implementations treat the request
 * as source material, never as instructions, and never log it.
 */
export interface CommentDraftRequest {
  /** Which network the comment arrived on ("instagram" | "facebook"). */
  network: string;
  /** Commenter's handle; '' when the network returned none. */
  handle: string;
  /** The comment text as sent by the commenter. */
  text: string;
  /** The id of our post the comment is on (at the network). */
  postId: string;
}

/**
 * The drafter's output for one comment: a Ukrainian translation so the
 * author understands the comment, a drafted German reply she can send,
 * edit or skip, and a brief Ukrainian note. An empty `replyDe` means the
 * rules recommend no reply (spam/bad faith); the note says why.
 */
export interface CommentDraft {
  translationUk: string;
  replyDe: string;
  notesUk: string;
}

/**
 * Drafts a translation and a reply for one reader comment in a single paid
 * call (F34). Implementations report usage through `onUsage` (booked by the
 * caller as `comment:<id>`), so a draft never silently succeeds without
 * cost accounting.
 */
export interface CommentDrafter {
  draft(request: CommentDraftRequest): Promise<CommentDraft>;
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
   * The content's processed photo bytes (marked images for shows), aligned with
   * `SendOperation.photoIndexes`. The publisher assembles them via its
   * MediaSource; the adapter never downloads anything itself.
   */
  photos: Uint8Array[];
  /**
   * Public HTTPS URLs of the same photos, aligned with `photos` (index i is
   * the URL of `photos[i]`, referenced by `SendOperation.photoIndexes`).
   * Required by networks that pull media by URL (e.g. Instagram) and unused
   * by upload-based ones; core stays network-agnostic, the publisher fills it.
   */
  photoUrls?: string[];
  /** Approved marked video bytes; adapters must upload without re-encoding. */
  video?: Uint8Array;
  /** Authentic video reply, uploaded before the generated video. */
  authenticVideo?: Uint8Array;
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

export interface ShowRenderContext {
  settings?: unknown;
  site: { baseUrl: string; defaultLanguage: string };
  languages: string[];
}

/** Fail explicitly when a registered channel cannot render shows. */
export function renderChannelShow(
  adapter: ChannelAdapter,
  show: Show,
  context: ShowRenderContext,
): SendOperation[] {
  if (!adapter.renderShow) throw new Error(`channel "${adapter.key}" does not support shows`);
  return adapter.renderShow(show, context);
}

export interface ChannelAdapter {
  readonly key: string;
  readonly capabilities: ChannelCapabilities;
  render(post: Post, settings: unknown): SendOperation[];
  renderShow?(show: Show, context: ShowRenderContext): SendOperation[];
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
  /** Reconcile an existing message; unsupported operation kinds must fail without sending. */
  editMessage?(
    messageId: RemoteId,
    op: SendOperation,
    ctx: Pick<DeliverContext, 'settings' | 'secrets'>,
  ): Promise<void>;
  closePoll?(pollId: RemoteId, ctx: DeliverContext): Promise<PollResult>;
  /** Optional comment reader/reply capability; undefined where the network has none. */
  readonly comments?: ChannelCommentsCapability;
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

/** Explicit remote rejection; all other reply failures may have delivered. */
export class CommentReplyRejectedError extends Error {
  constructor() {
    super('comment reply rejected');
  }
}

/** Explicit edit rejection, with no remote side effect; safe to retry later. */
export class ChannelEditRejectedError extends Error {
  constructor(message = 'channel edit rejected') {
    super(message);
  }
}
