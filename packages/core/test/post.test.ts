import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parsePost, PostParseError, serializePost } from '../src/post';

const fixturesDir = join(import.meta.dirname, 'fixtures');

const readFixture = (name: string) => readFileSync(join(fixturesDir, name), 'utf8');

describe('parsePost / serializePost round-trip', () => {
  it.each(['valid-1.md', 'valid-2.md', 'valid-3.md'])('serialize(parse(%s)) === %s', (name) => {
    const markdown = readFixture(name);
    expect(serializePost(parsePost(markdown))).toBe(markdown);
  });

  it('parses frontmatter fields and language texts', () => {
    const post = parsePost(readFixture('valid-1.md'));
    expect(post.id).toBe('01JBCA1B2C3D4E5F6G7H8J9K0M');
    expect(post.tenant).toBe('faden-und-stimmung');
    expect(post.type).toBe('free');
    expect(post.photos).toEqual(['01.jpg', '02.jpg', '03.jpg']);
    expect(post.versions.de).toEqual({
      provenance: 'ai-assisted',
      model: 'claude-opus-5-5',
      prompt: 'humanize-de@1',
    });
    expect(post.texts.uk).toContain('Осінні шарфи');
    expect(post.texts.de).toContain('Herbstschals');
  });
});

describe('parsePost rejects invalid posts', () => {
  it.each<[string, RegExp]>([
    ['invalid-provenance.md', /provenance/],
    ['invalid-missing-language-section.md', /missing language section.*lang:de/],
    ['invalid-undeclared-language-section.md', /without a declared version.*lang:de/],
    ['invalid-ulid.md', /ULID/],
  ])('%s raises PostParseError', (name, messagePattern) => {
    expect(() => parsePost(readFixture(name))).toThrowError(PostParseError);
    expect(() => parsePost(readFixture(name))).toThrowError(messagePattern);
  });

  it('raises a clear error when frontmatter is absent', () => {
    expect(() => parsePost('no frontmatter here')).toThrowError(/frontmatter/);
  });
});
