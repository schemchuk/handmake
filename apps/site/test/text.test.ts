import { describe, expect, it } from 'vitest';

import { excerpt, paragraphs } from '../src/lib/text';

describe('paragraphs', () => {
  it('splits at blank lines and keeps single line breaks', () => {
    expect(paragraphs('one\ntwo\n\n\nthree\n')).toEqual(['one\ntwo', 'three']);
  });
  it('returns nothing for blank text', () => {
    expect(paragraphs(' \n\n ')).toEqual([]);
  });
});

describe('excerpt', () => {
  it('flattens whitespace and keeps short text whole', () => {
    expect(excerpt('a\n b  c')).toBe('a b c');
  });
  it('cuts at a word boundary with an ellipsis', () => {
    const out = excerpt('alpha beta gamma delta epsilon', 20);
    expect(out).toBe('alpha beta gamma…');
    expect(out.length).toBeLessThanOrEqual(20);
  });
});
