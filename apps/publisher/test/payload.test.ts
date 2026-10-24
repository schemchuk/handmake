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
