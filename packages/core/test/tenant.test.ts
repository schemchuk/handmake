import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  parseTenantConfig,
  channelsSchema,
  knownChannelKeys,
  TenantConfigError,
} from '../src/tenant';

const realConfigPath = join(import.meta.dirname, '../../../config/tenants/faden-und-stimmung.yaml');
const realConfig = () => readFileSync(realConfigPath, 'utf8');

const secondTenant = `
id: woll-und-ton
name: Woll und Ton
languages: [de]
channels:
  telegram:
    channelId: WOLL_TELEGRAM_CHANNEL_ID
  instagram:
    language: de
contentStore:
  type: git-repo
meetingSchedule:
  weekday: tuesday
  time: '18:30'
  timezone: Europe/Berlin
workOfWeek:
  opens:
    weekday: monday
    time: '09:00'
  closes:
    weekday: tuesday
    time: '12:00'
featureFlags:
  translation: false
  wotwPoll: true
offerings: []
`;

describe('parseTenantConfig', () => {
  it('validates the real tenant config file', () => {
    const config = parseTenantConfig(realConfig());
    expect(config.id).toBe('faden-und-stimmung');
    expect(config.languages).toEqual(['uk', 'de']);
    expect(config.meetingSchedule).toEqual({
      weekday: 'thursday',
      time: '14:00',
      timezone: 'Europe/Berlin',
    });
    expect(config.channels.telegram).toEqual({ channelId: 'TELEGRAM_CHANNEL_ID' });
    expect(config.offerings).toEqual([]);
  });

  it('parses two independent tenants', () => {
    const first = parseTenantConfig(realConfig());
    const second = parseTenantConfig(secondTenant);
    expect(first.id).not.toBe(second.id);
    expect(second.languages).toEqual(['de']);
    expect(second.channels.instagram).toEqual({ language: 'de' });
    expect(second.featureFlags.wotwPoll).toBe(true);
  });

  it('rejects a missing required field', () => {
    const withoutSchedule = realConfig().replace(
      /meetingSchedule:[\s\S]*?\nworkOfWeek:/,
      'workOfWeek:',
    );
    expect(() => parseTenantConfig(withoutSchedule)).toThrowError(TenantConfigError);
    expect(() => parseTenantConfig(withoutSchedule)).toThrowError(/meetingSchedule/);
  });

  it('rejects an unknown channel key', () => {
    const withTiktok = realConfig().replace(
      'channels:\n  telegram:',
      'channels:\n  tiktok:\n    language: de\n  telegram:',
    );
    expect(() => parseTenantConfig(withTiktok)).toThrowError(/tiktok/);
  });

  it('rejects a value that looks like a secret, not a secret name', () => {
    // Built by concatenation so the committed source contains no token shape.
    const fakeToken = `123456789:AA${'x7'.repeat(18)}`;
    const withToken = realConfig().replace('TELEGRAM_CHANNEL_ID', fakeToken);
    expect(() => parseTenantConfig(withToken)).toThrowError(/secret/);
  });

  it('rejects a lowercase value under a secret-named key', () => {
    const withLowercase = realConfig().replace(
      '    channelId: TELEGRAM_CHANNEL_ID',
      '    channelId: TELEGRAM_CHANNEL_ID\n    botToken: telegram_token_123',
    );
    expect(() => parseTenantConfig(withLowercase)).toThrowError(/secret/);
  });

  it('rejects an unknown IANA timezone', () => {
    const withBadTz = realConfig().replace('Europe/Berlin', 'Mars/Olympus_Mons');
    expect(() => parseTenantConfig(withBadTz)).toThrowError(/timezone/);
  });

  it('rejects instagram.language outside the tenant languages', () => {
    const withBadLanguage = realConfig().replace(
      '  telegram:\n    channelId: TELEGRAM_CHANNEL_ID',
      '  telegram:\n    channelId: TELEGRAM_CHANNEL_ID\n  instagram:\n    language: fr',
    );
    expect(() => parseTenantConfig(withBadLanguage)).toThrowError(/instagram\.language/);
  });

  it('rejects a non-empty offerings stub', () => {
    const withOffering = realConfig().replace('offerings: []', 'offerings:\n  - paid-course');
    expect(() => parseTenantConfig(withOffering)).toThrowError(/offerings/);
  });

  it('knownChannelKeys matches the channels schema keys', () => {
    expect(knownChannelKeys).toEqual(Object.keys(channelsSchema.shape));
  });
});
