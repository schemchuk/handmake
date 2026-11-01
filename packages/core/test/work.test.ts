import { describe, expect, it } from 'vitest';

import {
  collectionSchema,
  parseCollection,
  parseWork,
  serializeCollection,
  serializeWork,
  workSchema,
} from '../src/work';

const work = {
  id: '01JBCA1B2C3D4E5F6G7H8J9K0M',
  tenant: 'tenant',
  date: '2026-11-01T10:00:00Z',
  collection: 'sample',
  kind: 'worn' as const,
  photos: ['photo-1.jpg'],
  versions: { uk: { description: 'Fixture description', provenance: 'human' as const } },
};
const collection = {
  tenant: 'tenant',
  slug: 'sample',
  order: 0,
  versions: {
    uk: { title: 'Fixture', description: 'Fixture description', provenance: 'human' as const },
  },
  cover: { workId: work.id, fileName: work.photos[0]! },
};

describe('work and collection documents', () => {
  it.each(['worn', 'closeup', 'interior'] as const)(
    'round-trips %s without losing provenance',
    (kind) => {
      const value = {
        ...work,
        kind,
        versions: {
          ...work.versions,
          de: {
            description: 'DE fixture',
            provenance: 'ai-assisted' as const,
            model: 'test-model',
            prompt: 'test@1',
          },
        },
      };
      expect(parseWork(serializeWork(value).replace(/\n/g, '\r\n'))).toEqual(value);
      expect(parseCollection(serializeCollection(collection))).toEqual(collection);
    },
  );

  it.each([
    { id: '../bad' },
    { tenant: '../other' },
    { date: 'yesterday' },
    { collection: '../bad' },
    { kind: 'work' },
    { photos: [] },
    { photos: ['index.md'] },
    { photos: ['../photo.jpg'] },
    { photos: ['a.jpg', 'a.jpg'] },
    { versions: {} },
    { versions: { uk: { description: 'text' } } },
    { versions: { uk: { description: ' ', provenance: 'human' } } },
    { versions: { uk: { description: 'text', provenance: 'unknown' } } },
    { versions: { ukrainian: work.versions.uk } },
    { sale: true },
  ])('rejects invalid work fields %j', (patch) => {
    expect(workSchema.safeParse({ ...work, ...patch }).success).toBe(false);
  });

  it.each([
    { slug: '../sample' },
    { tenant: '' },
    { order: -1 },
    { order: 0.5 },
    { versions: {} },
    { cover: { workId: work.id, fileName: '../../a.jpg' } },
    { versions: { uk: { title: 'Fixture', description: 'text' } } },
    { extra: true },
  ])('rejects invalid collection fields %j', (patch) => {
    expect(collectionSchema.safeParse({ ...collection, ...patch }).success).toBe(false);
  });

  it('preserves author whitespace rather than rewriting descriptions', () => {
    const value = {
      ...work,
      versions: { uk: { ...work.versions.uk, description: '  Fixture\n' } },
    };
    expect(parseWork(serializeWork(value))).toEqual(value);
  });

  it('fails on missing/malformed YAML or divergent body text', () => {
    expect(() => parseWork('not markdown')).toThrow();
    expect(() => parseCollection('---\nversions: [\n---\n')).toThrow();
    expect(() => parseWork(serializeWork(work) + 'untracked text')).toThrow();
  });
});
