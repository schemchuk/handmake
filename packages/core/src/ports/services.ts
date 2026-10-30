/**
 * Service ports (architecture section 11.1). Each runtime (bot Worker,
 * publisher CLI) wires concrete implementations in its composition root.
 */

import type { PostPoll, PostType, Provenance } from '../post';
import type { DraftKind } from './store';

export interface PublishJob {
  tenantId: string;
  /** Stable id: the draft id doubles as the post id and idempotency key. */
  postId: string;
  /** What the pipeline builds; only 'post' is implemented (works: phase 2). */
  kind: DraftKind;
  /** Post type: announcement/reminder drafts dispatch their real type (T25). */
  type: PostType;
  /** Language versions to publish; non-empty, Ukrainian at minimum. */
  texts: Record<string, string>;
  /** Opaque photo refs (Telegram file_ids); downloaded inside the pipeline. */
  fileIds: string[];
  /** Dominant provenance; the publisher stamps it on every version. */
  provenance: Provenance;
  /** Poll spec for a wotw-poll draft (produced by the poll cron, T30). */
  poll?: PostPoll;
}

/** Runs a publish job. GitHub Actions via repository_dispatch now. */
export interface PublishRunner {
  run(job: PublishJob): Promise<void>;
}

export interface TranslationRequest {
  text: string;
  sourceLang: string;
  targetLang: string;
  /** Versioned prompt, e.g. "humanize-de@1" (ADR 004). */
  promptVersion?: string;
}

export interface TranslationResult {
  text: string;
  /** Free-form notes for the author, e.g. wording choices. */
  notes?: string;
}

export interface Translator {
  translate(request: TranslationRequest): Promise<TranslationResult>;
}

/** Fetches the author's photos by opaque reference (Telegram file_id now). */
export interface MediaSource {
  fetchPhoto(ref: string): Promise<Uint8Array>;
}

export type NotifyTarget = 'author' | 'operator';

export interface Notifier {
  notify(target: NotifyTarget, message: string): Promise<void>;
}

/** Resolves secret NAMES (from tenant config) to values. Never logs values. */
export interface SecretResolver {
  resolve(name: string): Promise<string>;
}

export interface Clock {
  now(): Date;
}
