import type { Draft } from './ports/store';

/**
 * Draft state machine (architecture 4.1, task T14): the pure transition
 * function over the `Draft` type defined in `ports/store.ts`. Persistence
 * (D1) lives in the bot Worker; this module decides what may happen and the
 * repository writes it. Every function returns a new draft — drafts are
 * immutable, same discipline as the ledger.
 *
 *   collecting ──beginTranslation──▶ translating ──translationSucceeded──▶ ready
 *        │                              │ translationFailed │
 *        │ (addText / addPhoto,         ▼                   ▼
 *        │  max maxDraftPhotos)       failed ──retryTranslation──▶ translating
 *        ▼
 *   ready ──beginPublishing──▶ publishing ──publishSucceeded──▶ published
 *                                 │ publishFailed ▲
 *                                 └───────────────┘ (back to ready)
 *
 * Discard is not a state: it deletes the row (repository `delete`).
 * `published` is terminal — no event leaves it (the row is deleted after
 * publishing anyway, architecture section 5).
 */

export const maxDraftPhotos = 10;
/** Drafts untouched this long are deleted by the Worker cron (section 5). */
export const draftRetentionDays = 30;

export const sourceTextKey = 'uk';
export const targetTextKey = 'de';

export type DraftEvent =
  | { type: 'addText'; text: string }
  | { type: 'addPhoto'; fileId: string }
  | { type: 'beginTranslation' }
  | { type: 'translationSucceeded'; german: string }
  | { type: 'translationFailed'; error: string }
  | { type: 'retryTranslation' }
  | { type: 'beginPublishing' }
  | { type: 'publishSucceeded' }
  | { type: 'publishFailed' };

export class DraftTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DraftTransitionError';
  }
}

/** A content limit (not a state error): thrown for the 11th photo. */
export class DraftLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DraftLimitError';
  }
}

export function createDraft(tenantId: string, draftId: string, now: Date): Draft {
  return {
    tenantId,
    draftId,
    state: 'collecting',
    texts: {},
    photoRefs: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

/**
 * Apply one event to a draft. Invalid transitions throw
 * `DraftTransitionError`; exceeding `maxDraftPhotos` throws
 * `DraftLimitError`. The input draft is never mutated.
 */
export function transitionDraft(draft: Draft, event: DraftEvent, now: Date): Draft {
  switch (event.type) {
    case 'addText': {
      requireState(draft, 'collecting', event.type);
      const text = event.text.trim();
      if (!text) {
        throw new DraftTransitionError('addText: text is empty');
      }
      const previous = draft.texts[sourceTextKey];
      return touched(
        {
          ...draft,
          texts: {
            ...draft.texts,
            [sourceTextKey]: previous ? `${previous}\n\n${text}` : text,
          },
        },
        now,
      );
    }
    case 'addPhoto': {
      requireState(draft, 'collecting', event.type);
      if (draft.photoRefs.length >= maxDraftPhotos) {
        throw new DraftLimitError(
          `addPhoto: a draft holds at most ${maxDraftPhotos} photos; refusing photo #${draft.photoRefs.length + 1}`,
        );
      }
      return touched({ ...draft, photoRefs: [...draft.photoRefs, event.fileId] }, now);
    }
    case 'beginTranslation':
      requireState(draft, 'collecting', event.type);
      return moved(draft, 'translating', now);
    case 'translationSucceeded':
      requireState(draft, 'translating', event.type);
      return touched(
        { ...moved(draft, 'ready', now), texts: { ...draft.texts, [targetTextKey]: event.german } },
        now,
      );
    case 'translationFailed':
      requireState(draft, 'translating', event.type);
      return moved(draft, 'failed', now);
    case 'retryTranslation':
      requireState(draft, 'failed', event.type);
      return moved(draft, 'translating', now);
    case 'beginPublishing':
      requireState(draft, 'ready', event.type);
      return moved(draft, 'publishing', now);
    case 'publishSucceeded':
      requireState(draft, 'publishing', event.type);
      return moved(draft, 'published', now);
    case 'publishFailed':
      requireState(draft, 'publishing', event.type);
      return moved(draft, 'ready', now);
  }
}

function requireState(draft: Draft, state: Draft['state'], event: string): void {
  if (draft.state !== state) {
    throw new DraftTransitionError(`${event}: draft is "${draft.state}", expected "${state}"`);
  }
}

function moved(draft: Draft, state: Draft['state'], now: Date): Draft {
  return touched({ ...draft, state }, now);
}

function touched(draft: Draft, now: Date): Draft {
  return { ...draft, updatedAt: now.toISOString() };
}
