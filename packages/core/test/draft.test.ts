import { describe, expect, it } from 'vitest';

import {
  createDraft,
  DraftLimitError,
  DraftTransitionError,
  maxDraftPhotos,
  transitionDraft,
} from '../src/draft';
import type { Draft } from '../src/ports';

const tenantId = 'faden-und-stimmung';
const t0 = new Date('2026-10-27T10:00:00.000Z');
const t1 = new Date('2026-10-27T10:05:00.000Z');
const t2 = new Date('2026-10-27T10:10:00.000Z');

function draft(): Draft {
  return createDraft(tenantId, 'draft-1', t0);
}

describe('createDraft', () => {
  it('starts in collecting with empty content', () => {
    const d = draft();
    expect(d).toEqual({
      tenantId,
      draftId: 'draft-1',
      state: 'collecting',
      texts: {},
      photoRefs: [],
      createdAt: t0.toISOString(),
      updatedAt: t0.toISOString(),
    });
  });
});

describe('collecting', () => {
  it('addText stores the UA text and stamps updatedAt', () => {
    const d = transitionDraft(draft(), { type: 'addText', text: '  Привіт! ' }, t1);
    expect(d.texts['ua']).toBe('Привіт!');
    expect(d.updatedAt).toBe(t1.toISOString());
    expect(d.state).toBe('collecting');
  });

  it('a second addText joins with a blank line', () => {
    let d = transitionDraft(draft(), { type: 'addText', text: 'Перший рядок' }, t1);
    d = transitionDraft(d, { type: 'addText', text: 'Другий рядок' }, t2);
    expect(d.texts['ua']).toBe('Перший рядок\n\nДругий рядок');
  });

  it('addText with only whitespace is rejected', () => {
    expect(() => transitionDraft(draft(), { type: 'addText', text: '   ' }, t1)).toThrow(
      DraftTransitionError,
    );
  });

  it('addPhoto appends the file id', () => {
    const d = transitionDraft(draft(), { type: 'addPhoto', fileId: 'file-1' }, t1);
    expect(d.photoRefs).toEqual(['file-1']);
  });

  it('accepts exactly maxDraftPhotos photos', () => {
    let d = draft();
    for (let i = 0; i < maxDraftPhotos; i++) {
      d = transitionDraft(d, { type: 'addPhoto', fileId: `file-${i}` }, t1);
    }
    expect(d.photoRefs).toHaveLength(maxDraftPhotos);
  });

  it('the 11th photo is refused with DraftLimitError and the draft is unchanged', () => {
    let d = draft();
    for (let i = 0; i < maxDraftPhotos; i++) {
      d = transitionDraft(d, { type: 'addPhoto', fileId: `file-${i}` }, t1);
    }
    const snapshot = d;
    expect(() => transitionDraft(d, { type: 'addPhoto', fileId: 'file-10' }, t2)).toThrow(
      DraftLimitError,
    );
    expect(d).toEqual(snapshot);
  });
});

describe('the full lifecycle', () => {
  it('collecting → translating → ready carries the DE text', () => {
    let d = transitionDraft(draft(), { type: 'addText', text: 'Привіт!' }, t1);
    d = transitionDraft(d, { type: 'beginTranslation' }, t1);
    expect(d.state).toBe('translating');
    d = transitionDraft(d, { type: 'translationSucceeded', german: 'Hallo!' }, t2);
    expect(d.state).toBe('ready');
    expect(d.texts).toEqual({ ua: 'Привіт!', de: 'Hallo!' });
  });

  it('translation failure goes to failed and retryTranslation returns to translating', () => {
    let d = transitionDraft(draft(), { type: 'beginTranslation' }, t1);
    d = transitionDraft(d, { type: 'translationFailed', error: 'ai down' }, t2);
    expect(d.state).toBe('failed');
    d = transitionDraft(d, { type: 'retryTranslation' }, t2);
    expect(d.state).toBe('translating');
  });

  it('publishing succeeds to published', () => {
    let d = transitionDraft(draft(), { type: 'beginTranslation' }, t1);
    d = transitionDraft(d, { type: 'translationSucceeded', german: 'Hallo!' }, t1);
    d = transitionDraft(d, { type: 'beginPublishing' }, t2);
    expect(d.state).toBe('publishing');
    d = transitionDraft(d, { type: 'publishSucceeded' }, t2);
    expect(d.state).toBe('published');
  });

  it('a failed dispatch reverts publishing back to ready (architecture 4.5)', () => {
    let d = transitionDraft(draft(), { type: 'beginTranslation' }, t1);
    d = transitionDraft(d, { type: 'translationSucceeded', german: 'Hallo!' }, t1);
    d = transitionDraft(d, { type: 'beginPublishing' }, t2);
    d = transitionDraft(d, { type: 'publishFailed' }, t2);
    expect(d.state).toBe('ready');
  });
});

describe('invalid transitions are rejected', () => {
  const cases: Array<[string, Draft, Parameters<typeof transitionDraft>[1]]> = [
    ['addText in ready', readyDraft(), { type: 'addText', text: 'ще' }],
    ['addPhoto in translating', translatingDraft(), { type: 'addPhoto', fileId: 'f' }],
    ['beginTranslation in ready', readyDraft(), { type: 'beginTranslation' }],
    [
      'translationSucceeded in collecting',
      draft(),
      {
        type: 'translationSucceeded',
        german: 'Hallo!',
      },
    ],
    [
      'translationSucceeded in failed',
      failedDraft(),
      {
        type: 'translationSucceeded',
        german: 'Hallo!',
      },
    ],
    ['retryTranslation in translating', translatingDraft(), { type: 'retryTranslation' }],
    ['beginPublishing in collecting', draft(), { type: 'beginPublishing' }],
    ['publishSucceeded in ready', readyDraft(), { type: 'publishSucceeded' }],
    ['publishFailed in ready', readyDraft(), { type: 'publishFailed' }],
    ['beginTranslation in published', publishedDraft(), { type: 'beginTranslation' }],
    ['addPhoto in published', publishedDraft(), { type: 'addPhoto', fileId: 'f' }],
  ];

  it.each(cases)('%s throws DraftTransitionError', (_name, d, event) => {
    expect(() => transitionDraft(d, event, t2)).toThrow(DraftTransitionError);
  });

  it('the input draft is never mutated by a rejected transition', () => {
    const d = readyDraft();
    const snapshot = JSON.stringify(d);
    expect(() => transitionDraft(d, { type: 'addText', text: 'ще' }, t2)).toThrow();
    expect(JSON.stringify(d)).toBe(snapshot);
  });
});

function translatingDraft(): Draft {
  return transitionDraft(draft(), { type: 'beginTranslation' }, t1);
}

function readyDraft(): Draft {
  let d = translatingDraft();
  d = transitionDraft(d, { type: 'translationSucceeded', german: 'Hallo!' }, t1);
  return d;
}

function failedDraft(): Draft {
  return transitionDraft(translatingDraft(), { type: 'translationFailed', error: 'x' }, t1);
}

function publishedDraft(): Draft {
  let d = transitionDraft(readyDraft(), { type: 'beginPublishing' }, t1);
  d = transitionDraft(d, { type: 'publishSucceeded' }, t1);
  return d;
}
