import { describe, expect, it } from 'vitest';

import { buildWorkFromPayload } from '../src/build-work';

const payload = {
  kind: 'work',
  tenantId: 'tenant',
  draftId: '01JBCA1B2C3D4E5F6G7H8J9K0M',
  date: '2026-11-01T10:00:00Z',
  workKind: 'interior',
  collection: 'sample',
  fileIds: ['opaque-ref-a', 'opaque-ref-b'],
  versions: { uk: { description: 'Fixture description', provenance: 'human' } },
};

describe('buildWorkFromPayload', () => {
  it('preserves identity/date/provenance and maps opaque refs to stable photo names', () => {
    const before = structuredClone(payload);
    const first = buildWorkFromPayload(payload);
    expect(buildWorkFromPayload(JSON.parse(JSON.stringify(payload)))).toEqual(first);
    expect(first).toEqual({
      id: payload.draftId,
      tenant: 'tenant',
      date: payload.date,
      kind: 'interior',
      collection: 'sample',
      photos: ['photo-1.jpg', 'photo-2.jpg'],
      versions: payload.versions,
    });
    expect(payload).toEqual(before);
  });

  it.each([
    { kind: 'post' },
    { draftId: 'nonstable' },
    { date: undefined },
    { workKind: 'work' },
    { tenantId: '../tenant' },
    { fileIds: [] },
    { fileIds: [''] },
    { versions: {} },
    { collection: '../sample' },
    { unknown: 'field' },
  ])('rejects malformed payload %j', (patch) => {
    expect(() => buildWorkFromPayload({ ...payload, ...patch })).toThrow();
  });
});
