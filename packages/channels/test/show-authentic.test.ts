import { readFileSync } from 'node:fs';
import { showSchema } from '@handmake/core';
import { describe, expect, it } from 'vitest';
import {
  renderTelegramShow,
  renderInstagramShow,
  renderFacebookShow,
  renderThreadsShow,
} from '../src';

const fixture = () =>
  showSchema.parse(
    JSON.parse(
      readFileSync(new URL('../../core/test/fixtures/show.json', import.meta.url), 'utf8'),
    ),
  );
const renderers = [renderTelegramShow, renderInstagramShow, renderFacebookShow, renderThreadsShow];
for (const render of renderers) {
  describe(render.name, () => {
    for (const language of ['de', 'uk']) {
      for (const count of [0, 1, 3]) {
        it(`renders ${count} authentic photos and a video in ${language}`, () => {
          const show = fixture();
          const context = {
            site: { baseUrl: 'https://craft.example', defaultLanguage: 'de' },
            languages: [language],
            settings: { language },
          };
          show.authentic = [
            ...Array.from({ length: count }, (_, i) => ({
              fileName: `authentic-${i}.jpg`,
              kind: 'photo' as const,
              provenance: 'human' as const,
              people: 'none' as const,
            })),
            { fileName: 'authentic.mp4', kind: 'video', provenance: 'human', people: 'none' },
          ];
          const ops = render(show, context);
          expect(ops[0]).toMatchObject({
            kind: 'mediaGroup',
            photoIndexes: Array.from({ length: count + 3 }, (_, i) => i),
          });
          const serialized = JSON.stringify(ops);
          const line =
            language === 'de'
              ? `KI-generierte Bilder ab Bild ${count + 1}`
              : `Згенеровані ШІ кадри з кадру ${count + 1}`;
          if (count) expect(serialized).toContain(line);
          else expect(serialized).not.toContain(line);
          if (render === renderTelegramShow) {
            expect(ops.slice(1, 3)).toEqual([
              { kind: 'video', videoSource: 'authentic', replyToOp: 0 },
              { kind: 'video', replyToOp: 0 },
            ]);
          } else expect(ops).toHaveLength(1);
          if (!count && render !== renderTelegramShow) {
            delete show.authentic;
            expect(render(show, context)).toEqual(ops);
          }
        });
      }
    }
    it('counts the additional disclosure against the full caption budget', () => {
      const show = fixture();
      show.authentic = [
        { fileName: 'authentic.jpg', kind: 'photo', provenance: 'human', people: 'none' },
      ];
      const context = {
        site: { baseUrl: 'https://craft.example', defaultLanguage: 'de' },
        languages: ['de'],
        settings: { language: 'de' },
      };
      const album = render(show, context)[0]!;
      if (album.kind !== 'mediaGroup') throw new Error('expected album');
      const overhead = album.caption!.length - show.versions.de!.description.length;
      const limit =
        render === renderTelegramShow
          ? 4096
          : render === renderInstagramShow
            ? 2200
            : render === renderFacebookShow
              ? 63206
              : 500;
      show.versions.de!.description = 'x'.repeat(limit - overhead);
      expect(() => render(show, context)).not.toThrow();
      show.versions.de!.description += 'x';
      expect(() => render(show, context)).toThrow();
    });
    it('checks the combined photo limit', () => {
      const show = fixture();
      show.authentic = Array.from({ length: 3 }, (_, i) => ({
        fileName: `authentic-${i}.jpg`,
        kind: 'photo',
        provenance: 'human',
        people: 'none',
      }));
      show.images = Array.from(
        { length: render === renderThreadsShow ? 18 : 8 },
        () => show.images[0]!,
      );
      expect(() =>
        render(show, {
          site: { baseUrl: 'https://craft.example', defaultLanguage: 'de' },
          languages: ['de'],
          settings: { language: 'de' },
        }),
      ).toThrow();
    });
  });
}
