import { newUlid, parseTenantConfig } from '@handmake/core';
import { describe, expect, it } from 'vitest';

import { buildPostFromPayload } from '../src/build-post';
import type { DispatchPayload } from '../src/payload';

const tenant = parseTenantConfig(`
id: faden-und-stimmung
name: Faden und Stimmung
languages: [uk, de]
channels:
  telegram:
    channelId: TELEGRAM_CHANNEL_ID
contentStore:
  type: git-repo
meetingSchedule:
  weekday: thursday
  time: '14:00'
  timezone: Europe/Berlin
workOfWeek:
  opens: { weekday: monday, time: '10:00' }
  closes: { weekday: wednesday, time: '20:00' }
announcements:
  schedule:
    announcement: { weekday: tuesday, time: '18:00' }
    reminder: { weekday: thursday, time: '10:00' }
  templates:
    announcement: 'Ankündigung {weekday} {date} {time}'
    reminder: 'Erinnerung {date} {time}'
featureFlags:
  wotwPoll: false
offerings: []
`);

const payload: DispatchPayload = {
  tenantId: 'faden-und-stimmung',
  draftId: 'draft-1',
  texts: { uk: 'uk text', de: 'de text' },
  fileIds: ['file-1', 'file-2', 'file-3'],
  provenance: 'ai-assisted',
};

const now = new Date('2026-10-24T10:00:00.000Z');

describe('buildPostFromPayload', () => {
  it('maps payload and tenant fields to a post', () => {
    const post = buildPostFromPayload(payload, tenant, {
      now,
      newId: () => '01JDRYRNT000000000000000BC',
    });
    expect(post).toEqual({
      id: '01JDRYRNT000000000000000BC',
      date: '2026-10-24T10:00:00.000Z',
      publishAt: 'now',
      type: 'free',
      tenant: 'faden-und-stimmung',
      channels: ['telegram'],
      photos: ['photo-1.jpg', 'photo-2.jpg', 'photo-3.jpg'],
      versions: {
        uk: { provenance: 'ai-assisted' },
        de: { provenance: 'ai-assisted' },
      },
      texts: { uk: 'uk text', de: 'de text' },
    });
  });

  it('generates a ULID id when no newId is given', () => {
    const post = buildPostFromPayload(payload, tenant, { now });
    expect(post.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(newUlid(now)).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('reuses the draftId as post id when it is a ULID', () => {
    const post = buildPostFromPayload(
      { ...payload, draftId: '01JBCA1B2C3D4E5F6G7H8J9K0M' },
      tenant,
      { now },
    );
    expect(post.id).toBe('01JBCA1B2C3D4E5F6G7H8J9K0M');
  });

  it('generates a fresh id when the draftId is not a ULID', () => {
    const post = buildPostFromPayload({ ...payload, draftId: 'draft-1' }, tenant, { now });
    expect(post.id).not.toBe('draft-1');
    expect(post.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('orders languages by the tenant, whatever the payload key order', () => {
    const post = buildPostFromPayload(
      { ...payload, texts: { de: 'de text', fr: 'fr text', uk: 'uk text' } },
      tenant,
      { now },
    );
    expect(Object.keys(post.texts)).toEqual(['uk', 'de', 'fr']);
    expect(Object.keys(post.versions)).toEqual(['uk', 'de', 'fr']);
  });

  it('names no photos for an empty fileIds list', () => {
    const post = buildPostFromPayload({ ...payload, fileIds: [] }, tenant, { now });
    expect(post.photos).toEqual([]);
  });
});
