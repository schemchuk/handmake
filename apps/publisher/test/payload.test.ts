import { describe, expect, it } from 'vitest';

import { parseDispatchPayload, PayloadParseError } from '../src/payload';

const validPayload = JSON.stringify({
  tenantId: 'faden-und-stimmung',
  draftId: 'draft-1',
  texts: { uk: 'Привіт!', de: 'Hallo!' },
  fileIds: ['file-1', 'file-2'],
  provenance: 'human',
});

describe('parseDispatchPayload', () => {
  it('parses a valid payload', () => {
    const payload = parseDispatchPayload(validPayload);
    expect(payload.tenantId).toBe('faden-und-stimmung');
    expect(payload.draftId).toBe('draft-1');
    expect(payload.texts).toEqual({ uk: 'Привіт!', de: 'Hallo!' });
    expect(payload.fileIds).toEqual(['file-1', 'file-2']);
    expect(payload.provenance).toBe('human');
  });

  it('rejects invalid JSON with PayloadParseError', () => {
    expect(() => parseDispatchPayload('{not json')).toThrow(PayloadParseError);
    expect(() => parseDispatchPayload('{not json')).toThrow(/not valid JSON/);
  });

  it('rejects empty texts', () => {
    expect(() =>
      parseDispatchPayload(JSON.stringify({ ...JSON.parse(validPayload), texts: {} })),
    ).toThrow(PayloadParseError);
  });

  it('rejects a non-2-letter language key', () => {
    expect(() =>
      parseDispatchPayload(
        JSON.stringify({ ...JSON.parse(validPayload), texts: { ukrainian: 'text' } }),
      ),
    ).toThrow(PayloadParseError);
  });

  it('rejects an unknown provenance value', () => {
    expect(() =>
      parseDispatchPayload(JSON.stringify({ ...JSON.parse(validPayload), provenance: 'alien' })),
    ).toThrow(PayloadParseError);
  });

  it('rejects unknown fields (strict schema)', () => {
    expect(() =>
      parseDispatchPayload(JSON.stringify({ ...JSON.parse(validPayload), extra: true })),
    ).toThrow(PayloadParseError);
  });

  it('rejects a non-kebab-case tenant id', () => {
    expect(() =>
      parseDispatchPayload(JSON.stringify({ ...JSON.parse(validPayload), tenantId: 'Bad_Id' })),
    ).toThrow(PayloadParseError);
  });
});

describe('dispatch payload: kind (T25)', () => {
  it('defaults kind to post', () => {
    expect(parseDispatchPayload(validPayload).kind).toBe('post');
  });

  it('accepts kind work', () => {
    const payload = parseDispatchPayload(
      JSON.stringify({ ...JSON.parse(validPayload), kind: 'work' }),
    );
    expect(payload.kind).toBe('work');
  });

  it('rejects an unknown kind', () => {
    expect(() =>
      parseDispatchPayload(JSON.stringify({ ...JSON.parse(validPayload), kind: 'story' })),
    ).toThrow(PayloadParseError);
  });
});

describe('dispatch payload: post type and poll (T21)', () => {
  it('defaults the post type to free', () => {
    const payload = parseDispatchPayload(validPayload);
    expect(payload.type).toBe('free');
    expect(payload.poll).toBeUndefined();
  });

  it('parses a wotw-poll payload with its poll', () => {
    const payload = parseDispatchPayload(
      JSON.stringify({
        ...JSON.parse(validPayload),
        type: 'wotw-poll',
        poll: { question: 'Яка робота тижня?', options: ['1. Ваза', '2. Шаль'] },
      }),
    );
    expect(payload.type).toBe('wotw-poll');
    expect(payload.poll).toEqual({
      question: 'Яка робота тижня?',
      options: ['1. Ваза', '2. Шаль'],
    });
  });

  it('rejects a wotw-poll payload without a poll', () => {
    expect(() =>
      parseDispatchPayload(JSON.stringify({ ...JSON.parse(validPayload), type: 'wotw-poll' })),
    ).toThrow(/requires a poll/);
  });

  it('rejects a poll whose options do not match the photo count', () => {
    expect(() =>
      parseDispatchPayload(
        JSON.stringify({
          ...JSON.parse(validPayload),
          type: 'wotw-poll',
          poll: { question: 'q', options: ['1.', '2.', '3.'] },
        }),
      ),
    ).toThrow(/one option per candidate photo/);
  });

  it('rejects a non-poll payload carrying a poll', () => {
    expect(() =>
      parseDispatchPayload(
        JSON.stringify({
          ...JSON.parse(validPayload),
          poll: { question: 'q', options: ['1.', '2.'] },
        }),
      ),
    ).toThrow(/must not carry a poll/);
  });
});
