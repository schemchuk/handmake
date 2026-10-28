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

  it('tolerates CRLF line endings', () => {
    const post = parsePost(readFixture('valid-1.md').replace(/\n/g, '\r\n'));
    expect(post.texts.uk).toContain('Осінні шарфи');
  });
});

describe('parsePost rejects invalid posts', () => {
  it.each<[string, RegExp]>([
    ['invalid-provenance.md', /provenance/],
    ['invalid-missing-language-section.md', /missing language section.*lang:de/],
    ['invalid-undeclared-language-section.md', /without a declared version.*lang:de/],
    ['invalid-ulid.md', /ULID/],
    ['invalid-empty-language-section.md', /empty language section.*lang:de/],
  ])('%s raises PostParseError', (name, messagePattern) => {
    expect(() => parsePost(readFixture(name))).toThrowError(PostParseError);
    expect(() => parsePost(readFixture(name))).toThrowError(messagePattern);
  });

  it('raises a clear error when frontmatter is absent', () => {
    expect(() => parsePost('no frontmatter here')).toThrowError(/frontmatter/);
  });
});

describe('wotw-poll frontmatter (T21)', () => {
  const pollMarkdown = `---
id: 01JBCA1B2C3D4E5F6G7H8J9K0M
tenant: faden-und-stimmung
date: 2026-10-27T10:00:00+01:00
publishAt: now
type: wotw-poll
photos:
  - 01.jpg
  - 02.jpg
channels:
  - telegram
poll:
  question: Яка робота тижня?
  options:
    - 1. Ваза
    - 2. Шаль
versions:
  uk:
    provenance: human
  de:
    provenance: ai-assisted
---

<!-- lang:uk -->

Голосуйте!

<!-- lang:de -->

Stimmt ab!
`;

  it('parses a wotw-poll with its poll and round-trips', () => {
    const post = parsePost(pollMarkdown);
    expect(post.type).toBe('wotw-poll');
    expect(post.poll).toEqual({ question: 'Яка робота тижня?', options: ['1. Ваза', '2. Шаль'] });
    expect(serializePost(post)).toBe(pollMarkdown);
  });

  it('rejects a wotw-poll without a poll', () => {
    const withoutPoll = pollMarkdown.replace(
      /poll:\n  question:.*\n  options:\n    - 1\. Ваза\n    - 2\. Шаль\n/,
      '',
    );
    expect(() => parsePost(withoutPoll)).toThrowError(/requires a poll/);
  });

  it('rejects a poll whose options do not match the candidate photos', () => {
    const threeOptions = pollMarkdown.replace(
      '    - 2. Шаль\n',
      '    - 2. Шаль\n    - 3. Сережки\n',
    );
    expect(() => parsePost(threeOptions)).toThrowError(/one option per candidate photo/);
  });

  it('rejects a non-poll post carrying a poll', () => {
    const freeWithPoll = pollMarkdown.replace('type: wotw-poll', 'type: free');
    expect(() => parsePost(freeWithPoll)).toThrowError(/must not carry a poll/);
  });
});
