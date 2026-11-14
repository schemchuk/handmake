import { describe, expect, it } from 'vitest';

import {
  buildApprovedWorkJob,
  createDraft,
  workDraftDataSchema,
  workPublicationSchema,
} from '../src';

const generated = {
  uk: {
    description: '  UA fixture\n',
    provenance: 'ai-assisted' as const,
    model: 'ua-model',
    prompt: 'ua@1',
  },
  de: {
    description: 'DE fixture',
    provenance: 'ai-assisted' as const,
    model: 'de-model',
    prompt: 'de@1',
  },
};
const ready = () => ({
  ...createDraft('tenant', '01JBCA1B2C3D4E5F6G7H8J9K0M', new Date('2026-11-01T10:00:00Z'), {
    kind: 'work',
  }),
  state: 'ready' as const,
  photoRefs: ['opaque-photo'],
  texts: { uk: generated.uk.description, de: generated.de.description },
  extras: {
    work: workDraftDataSchema.parse({
      config: { kind: 'interior', collection: 'fixture', channels: [] },
      generated,
    }),
  },
});
describe('approved work job', () => {
  it('marks unchanged descriptions as ai-generated with stable date and all metadata', () => {
    const draft = ready();
    const before = structuredClone(draft);
    const job = buildApprovedWorkJob(draft);
    expect(job.kind).toBe('work');
    expect(job.work).toMatchObject({
      date: draft.createdAt,
      kind: 'interior',
      collection: 'fixture',
      channels: [],
      versions: {
        uk: { ...generated.uk, provenance: 'ai-generated' },
        de: { ...generated.de, provenance: 'ai-generated' },
      },
    });
    expect(job.fileIds).toEqual(['opaque-photo']);
    expect(draft).toEqual(before);
  });
  it.each(['none', 'author', 'operator', 'both'] as const)(
    'preserves the optional video reference and people=%s through approval and JSON',
    (videoPeople) => {
      const draft = ready();
      Object.assign(draft.extras.work.config, { videoFileId: 'opaque-video', videoPeople });
      const before = structuredClone(draft);
      const job = buildApprovedWorkJob(draft);
      expect(job.work).toMatchObject({ videoFileId: 'opaque-video', videoPeople });
      expect(workPublicationSchema.parse(JSON.parse(JSON.stringify(job.work)))).toEqual(job.work);
      expect(draft).toEqual(before);
    },
  );
  it.each([{ videoFileId: '' }, { videoPeople: 'participant' }])(
    'rejects invalid publication video metadata %j',
    (patch) => {
      const job = buildApprovedWorkJob(ready());
      expect(workPublicationSchema.safeParse({ ...job.work, ...patch }).success).toBe(false);
    },
  );
  it('omits video metadata from existing jobs', () => {
    const job = buildApprovedWorkJob(ready());
    expect(job.work).not.toHaveProperty('videoFileId');
    expect(job.work).not.toHaveProperty('videoPeople');
  });
  it('marks both versions ai-assisted if UA was edited, preserving the approved text exactly', () => {
    const draft = ready();
    draft.texts.uk = '  Edited UA\n';
    const job = buildApprovedWorkJob(draft);
    expect(job.work?.versions['uk']).toEqual({
      ...generated.uk,
      description: draft.texts.uk,
      provenance: 'ai-assisted',
    });
    expect(job.work?.versions['de']?.provenance).toBe('ai-assisted');
  });
  it('keeps DE provenance tied to UA edit state, as explicitly decided', () => {
    const draft = ready();
    draft.texts.de = 'Author edited DE';
    expect(buildApprovedWorkJob(draft).work?.versions['de']).toMatchObject({
      description: draft.texts.de,
      provenance: 'ai-generated',
    });
  });
  it('allows a freshly claimed publishing snapshot', () => {
    expect(buildApprovedWorkJob({ ...ready(), state: 'publishing' }).kind).toBe('work');
  });
  it.each(['collecting', 'translating', 'failed', 'published'] as const)(
    'rejects %s before approval',
    (state) => {
      expect(() => buildApprovedWorkJob({ ...ready(), state })).toThrow(/not ready/);
    },
  );
  it('rejects incomplete metadata, blank text, missing photos and unstable ids', () => {
    const draft = ready();
    delete draft.extras.work.generated!['de'];
    expect(() => buildApprovedWorkJob(draft)).toThrow(/incomplete/);
    expect(() => buildApprovedWorkJob({ ...ready(), texts: { uk: '', de: 'DE' } })).toThrow();
    expect(() => buildApprovedWorkJob({ ...ready(), photoRefs: [] })).toThrow();
    expect(() => buildApprovedWorkJob({ ...ready(), draftId: 'unstable' })).toThrow();
    expect(() => buildApprovedWorkJob({ ...ready(), kind: 'post' })).toThrow();
  });
});
