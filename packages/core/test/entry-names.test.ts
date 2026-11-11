import { expect, it } from 'vitest';
import {
  entryReferences,
  resolveEntryNames,
  resolvePostEntryNames,
  entryNamesAllowed,
} from '../src/entry-names';
import type { Post, TenantConfig } from '../src/index';
const a = '01JBCA1B2C3D4E5F6G7H8J9K0M';
const b = '01JBCA1B2C3D4E5F6G7H8J9K0N';
it.each([
  [true, { [a]: 'Fixture', [b]: null }, 'Fixture / Work No 2 / Fixture'],
  [false, { [a]: 'Fixture' }, 'Work No 1 / Work No 2 / Work No 1'],
  [true, {}, 'Work No 1 / Work No 2 / Work No 1'],
])(
  'resolves names with policy %s without renumbering repeated entries',
  (policy, names, expected) => {
    expect(resolveEntryNames(`{entry:${a}} / {entry:${b}} / {entry:${a}}`, names, policy)).toBe(
      expected,
    );
  },
);
it.each(['{entry:bad}', '{entry:}', '{entry:', '{entry}', '{Entry:bad}', '{entry:bad{nested}}'])(
  'rejects malformed tokens: %s',
  (text) => {
    expect(() => entryReferences(text)).toThrow('Invalid entry placeholder');
  },
);
it('keeps numbering across languages and poll fields without mutating persisted content', () => {
  const post = {
    texts: { uk: `{entry:${a}} {entry:${b}}`, de: `{entry:${b}}` },
    poll: { question: `{entry:${a}}`, options: [`{entry:${b}}`] },
    id: a,
    tenant: 'fixture',
    date: '2026-11-11T12:00:00Z',
    publishAt: 'now',
    type: 'wotw-poll',
    photos: [],
    channels: [],
    versions: { uk: { provenance: 'human' } },
  } satisfies Post;
  expect(resolvePostEntryNames(post, {}, false)).toMatchObject({
    texts: { de: 'Work No 2' },
    poll: { options: ['Work No 2'] },
  });
  expect(post.texts.de).toContain('{entry:');
});
it('allows names only when tenant explicitly opts into Telegram', () => {
  const tenant = { entryNamePolicy: { telegram: true } } as TenantConfig;
  for (const channel of ['instagram', 'facebook', 'threads', 'other'])
    expect(entryNamesAllowed(tenant, channel)).toBe(false);
  expect(entryNamesAllowed(tenant, 'telegram')).toBe(true);
  expect(entryNamesAllowed({} as TenantConfig, 'telegram')).toBe(false);
});
