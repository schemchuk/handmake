import type { Post, PostType } from '../post';
import type { RemoteId } from './channel';

/**
 * Publish ledger (architecture section 3): per-channel delivery status of a
 * post, kept separate from the post so retries do not rewrite it. Pure
 * transition functions live in the ledger module (T06).
 */

export type ChannelStatus = 'pending' | 'done' | 'failed';

export interface LedgerEntry {
  status: ChannelStatus;
  remoteIds: RemoteId[];
  /** Last error message when status is "failed". */
  error?: string;
  /** ISO timestamp of the last transition. */
  updatedAt: string;
}

export interface PublishLedger {
  tenantId: string;
  postId: string;
  channels: Record<string, LedgerEntry>;
}

export interface PhotoFile {
  fileName: string;
  data: Uint8Array;
}

/** Where published content lives. Git repo now; tenant repos or R2 later. */
export interface ContentStore {
  savePost(post: Post, photos: PhotoFile[]): Promise<void>;
  readPost(tenantId: string, postId: string): Promise<Post | undefined>;
  readLedger(tenantId: string, postId: string): Promise<PublishLedger | undefined>;
  writeLedger(ledger: PublishLedger): Promise<void>;
}

export type DraftState =
  'collecting' | 'translating' | 'ready' | 'publishing' | 'published' | 'failed';

/** What a draft becomes on publish (T25): a channel post, or a work (phase 2). */
export type DraftKind = 'post' | 'work';

export interface Draft {
  tenantId: string;
  draftId: string;
  state: DraftState;
  kind: DraftKind;
  /** Post type (free, announcement, reminder, wotw-poll, wotw-result). */
  type: PostType;
  /** Kind-specific extras as opaque JSON: poll spec, entry refs, collection. */
  extras: Record<string, unknown>;
  texts: Record<string, string>;
  /** Opaque photo references (Telegram file_ids), not binary data. */
  photoRefs: string[];
  createdAt: string;
  updatedAt: string;
}

/** Draft persistence for the bot. D1 now; the state machine is pure (T14).
 * The D1 implementation adds optimistic locking (a version counter quoted on
 * every write) and one-collecting-draft-per-chat enforcement on top of this
 * minimal port, because the Worker handles Telegram updates concurrently. */
export interface DraftStore {
  get(tenantId: string, draftId: string): Promise<Draft | undefined>;
  save(draft: Draft): Promise<void>;
  delete(tenantId: string, draftId: string): Promise<void>;
  listByState(tenantId: string, state: DraftState): Promise<Draft[]>;
}
