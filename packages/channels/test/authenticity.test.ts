import { appendAuthenticity } from '../src/authenticity';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { showSchema, type Post, type SendOperation } from '@handmake/core';
import {
  renderTelegram,
  renderTelegramShow,
  renderInstagram,
  renderInstagramShow,
  renderFacebook,
  renderFacebookShow,
  renderThreads,
  renderThreadsShow,
} from '../src';

const post: Post = {
  id: '01JBCA1B2C3D4E5F6G7H8J9K0M',
  tenant: 'fixture',
  date: '2026-11-13T10:00:00Z',
  publishAt: 'now',
  type: 'free',
  channels: ['telegram'],
  photos: ['photo.jpg'],
  texts: { de: 'Approved text', uk: 'Схвалений текст' },
  versions: { de: { provenance: 'ai-assisted' }, uk: { provenance: 'human' } },
};
const visible = (ops: SendOperation[]) =>
  ops
    .map((op) =>
      op.kind === 'message' ? op.text : op.kind === 'mediaGroup' ? (op.caption ?? '') : '',
    )
    .join('\n');
const canonical = {
  links: true,
  baseUrl: 'https://craft.example',
  defaultLanguage: 'de',
  section: 'works',
} as const;
const show = showSchema.parse(
  JSON.parse(readFileSync(new URL('../../core/test/fixtures/show.json', import.meta.url), 'utf8')),
);

describe.each([
  ['telegram', renderTelegram, renderTelegramShow],
  ['instagram', renderInstagram, renderInstagramShow],
  ['facebook', renderFacebook, renderFacebookShow],
  ['threads', renderThreads, renderThreadsShow],
] as const)('%s authenticity', (_name, render, renderShow) => {
  it.each([
    ['de', 'Originalarbeit'],
    ['uk', 'Оригінальна робота'],
  ])(
    'labels photo posts and work announcements in %s without changing provenance',
    (lang, label) => {
      const before = structuredClone(post);
      for (const section of ['posts', 'works'] as const) {
        const text = visible(
          render(post, { language: lang, languages: [lang], canonical: { ...canonical, section } }),
        );
        expect(text).toContain(`${post.texts[lang]}\n\n${label}`);
        if (text.includes('https://'))
          expect(text.indexOf(label)).toBeLessThan(text.indexOf('https://'));
      }
      expect(post).toEqual(before);
    },
  );
  it('leaves text-only posts without an authenticity label', () => {
    const text = visible(render({ ...post, photos: [] }, { language: 'de' }));
    expect(text).not.toContain('Originalarbeit');
  });
  it('keeps generated-model disclosure and labels the real work in shows', () => {
    const text = visible(
      renderShow(show, { languages: ['de'], settings: { language: 'de' }, site: canonical }),
    );
    expect(text).toContain('KI-generiertes Model\nOriginalarbeit');
  });
});

it('skips unsupported languages and places the label before trailing hashtags', () => {
  expect(appendAuthenticity('Approved text', 'fr', true)).toBe('Approved text');
  expect(appendAuthenticity('Text\n\n#craft #handmade', 'de', true)).toBe(
    'Text\n\nOriginalarbeit\n\n#craft #handmade',
  );
});
