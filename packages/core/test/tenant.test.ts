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
announcements:
  schedule:
    announcement:
      weekday: monday
      time: '09:00'
    reminder:
      weekday: tuesday
      time: '17:00'
  templates:
    announcement: 'Treff am {weekday}, {date} um {time}.'
    reminder: 'Heute um {time}: Treff!'
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

  describe('site section', () => {
    it('parses the real site section', () => {
      const site = parseTenantConfig(realConfig()).site;
      expect(site?.baseUrl).toBe('https://fadenundstimmung.de');
      expect(site?.defaultLanguage).toBe('de');
      expect(site?.theme.colors).toEqual({
        paper: '#F0F0EC',
        ink: '#1A1B20',
        muted: '#6F7077',
        rule: '#B3362B',
      });
      expect(site?.theme.fonts).toEqual({ display: 'Familjen Grotesk', body: 'Familjen Grotesk' });
      expect(Object.keys(site?.circle?.texts ?? {}).sort()).toEqual(['de', 'uk']);
    });

    it('is optional: a tenant without a site still parses', () => {
      expect(parseTenantConfig(secondTenant).site).toBeUndefined();
    });

    it('accepts a site without a circle page', () => {
      const withSite = secondTenant.replace(
        'featureFlags:',
        [
          'site:',
          '  baseUrl: https://woll.example',
          '  defaultLanguage: de',
          '  theme:',
          '    colors: { paper: "#FFFFFF", ink: "#000000", muted: "#777777", rule: "#123456" }',
          '    fonts: { display: Inter, body: Inter }',
          'featureFlags:',
        ].join('\n'),
      );
      const site = parseTenantConfig(withSite).site;
      expect(site?.baseUrl).toBe('https://woll.example');
      expect(site?.circle).toBeUndefined();
    });

    it('rejects a defaultLanguage outside the tenant languages', () => {
      const bad = realConfig().replace('defaultLanguage: de', 'defaultLanguage: fr');
      expect(() => parseTenantConfig(bad)).toThrowError(/site\.defaultLanguage/);
    });

    it.each([
      'http://fadenundstimmung.de',
      'https://fadenundstimmung.de/',
      'https://fadenundstimmung.de/blog',
      'fadenundstimmung.de',
    ])('rejects baseUrl %s', (baseUrl) => {
      const bad = realConfig().replace(
        'baseUrl: https://fadenundstimmung.de',
        `baseUrl: ${baseUrl}`,
      );
      expect(() => parseTenantConfig(bad)).toThrowError(/baseUrl/);
    });

    it('rejects a colour that is not #RRGGBB', () => {
      const bad = realConfig().replace("paper: '#F0F0EC'", 'paper: white');
      expect(() => parseTenantConfig(bad)).toThrowError(/colour/);
    });

    it('rejects an unknown theme key', () => {
      const bad = realConfig().replace(
        "      rule: '#B3362B'",
        "      rule: '#B3362B'\n      accent: '#000000'",
      );
      expect(() => parseTenantConfig(bad)).toThrowError(/accent/);
    });

    it('rejects circle texts that miss a tenant language', () => {
      const bad = realConfig().replace(/\n {6}uk:\n {8}title:[\s\S]*?where: [^\n]*/, '');
      expect(() => parseTenantConfig(bad)).toThrowError(/circle\.texts/);
    });

    it('rejects a non-https join link', () => {
      const bad = realConfig().replace(
        'joinUrl: https://t.me/REPLACE_WITH_PUBLIC_CHANNEL_LINK',
        'joinUrl: http://t.me/channel',
      );
      expect(() => parseTenantConfig(bad)).toThrowError(/joinUrl/);
    });

    it('still refuses a secret-looking value inside the site section', () => {
      const bad = realConfig().replace(
        '  defaultLanguage: de',
        '  defaultLanguage: de\n  apiKey: lowercase-secret-value',
      );
      expect(() => parseTenantConfig(bad)).toThrowError(/secret/);
    });
  });

  it('knownChannelKeys matches the channels schema keys', () => {
    expect(knownChannelKeys).toEqual(Object.keys(channelsSchema.shape));
  });
});
