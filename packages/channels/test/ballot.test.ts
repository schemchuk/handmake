import { expect, it } from 'vitest';
import type { Post } from '@handmake/core';
import { renderInstagram, renderThreads, renderFacebook } from '../src';

const post = (count: number): Post => ({
  id: '01JBCA1B2C3D4E5F6G7H8J9K0M',
  tenant: 'tenant',
  date: '2026-11-16T12:00:00Z',
  publishAt: 'now',
  type: 'wotw-poll',
  channels: ['instagram', 'threads', 'facebook'],
  photos: Array.from({ length: count }, (_, i) => `${i}.jpg`),
  versions: { uk: { provenance: 'human' }, de: { provenance: 'human' } },
  texts: { uk: 'Private name {entry:secret}', de: 'Private name {entry:secret}' },
});
it.each(['uk', 'de'])('renders anonymous ordered carousels in %s', (language) => {
  for (const render of [renderInstagram, renderThreads, renderFacebook]) {
    for (const count of [2, 3, 10]) {
      const ops = render(post(count), { language });
      expect(ops).toHaveLength(1);
      const op = ops[0]!;
      expect(op.kind).toBe('mediaGroup');
      if (op.kind !== 'mediaGroup') throw new Error();
      expect(op.photoIndexes).toEqual(Array.from({ length: count }, (_, i) => i));
      expect(op.caption).not.toMatch(/Private name|\{entry:/);
      expect(op.caption).toContain(language === 'uk' ? `Робота № ${count}` : `Werk Nr. ${count}`);
      expect(op.caption).toContain(language === 'uk' ? 'Оригінальна робота' : 'Originalarbeit');
    }
  }
});
it('enforces ballot carousel limits and keeps results skipped', () => {
  for (const render of [renderInstagram, renderThreads]) {
    for (const count of [0, 1, 11]) expect(() => render(post(count), { language: 'de' })).toThrow();
    expect(render({ ...post(3), type: 'wotw-result' }, { language: 'de' })).toEqual([]);
  }
});
