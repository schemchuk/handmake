/**
 * Service ports (architecture section 11.1). Each runtime (bot Worker,
 * publisher CLI) wires concrete implementations in its composition root.
 */

export interface PublishJob {
  tenantId: string;
  postId: string;
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

export interface WinnerCandidate {
  id: string;
  photoRef: string;
}

export interface WinnerPick {
  winnerId: string;
  reason: string;
  chosenBy: 'votes' | 'ai';
}

/** Picks the work of the week; Claude with vision as the fallback. */
export interface WinnerPicker {
  pick(candidates: WinnerCandidate[]): Promise<WinnerPick>;
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
