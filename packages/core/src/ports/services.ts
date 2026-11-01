import type { ShowPublication } from '../show';
/**
 * Service ports (architecture section 11.1). Each runtime (bot Worker,
 * publisher CLI) wires concrete implementations in its composition root.
 */

import type { PostPoll, PostType, Provenance } from '../post';
import type { DraftKind } from './store';
import type { Work } from '../work';
import type { WorkPublication } from '../work-publication';

interface PublishJobBase {
  tenantId: string;
  /** Stable id: the draft id doubles as the post id and idempotency key. */
  postId: string;
  /** What the pipeline builds. */
  kind: DraftKind;
  /** Post type: announcement/reminder drafts dispatch their real type (T25). */
  type: PostType;
  /** Language versions to publish; non-empty, Ukrainian at minimum. */
  texts: Record<string, string>;
  /** Opaque photo refs (Telegram file_ids); downloaded inside the pipeline. */
  fileIds: string[];
  /** Dominant provenance for regular posts; work metadata preserves each language separately. */
  provenance: Provenance;
  /** Poll spec for a wotw-poll draft (produced by the poll cron, T30). */
  poll?: PostPoll;
}

export type PublishJob = PublishJobBase &
  (
    | { kind: 'post'; work?: never; show?: never }
    | { kind: 'work'; work: WorkPublication; show?: never }
    | { kind: 'show'; show: ShowPublication; work?: never }
  );

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

/** Draft descriptions only; the author edits and approves them in a separate flow. */
export interface TextGenerationRequest {
  note: string;
  kind: Work['kind'];
  collection: string;
  /** Additional facts supplied by the author, never inferred from a template. */
  context?: string;
}

export interface TextGenerationResult {
  versions: Work['versions'];
  notes: Record<string, string>;
}

export interface GeneratedWorkText {
  version: Work['versions'][string];
  notes: string;
}

export interface TextGenerator {
  /** Stages let the caller persist a paid UA result before attempting DE. */
  generateUkrainian(request: TextGenerationRequest): Promise<GeneratedWorkText>;
  translateUkrainian(text: string): Promise<GeneratedWorkText>;
  generate(request: TextGenerationRequest): Promise<TextGenerationResult>;
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

/** Downloads generated images or video without altering their AI markers. */
export interface ShowMediaSource {
  fetchMedia(ref: string): Promise<Uint8Array>;
}
