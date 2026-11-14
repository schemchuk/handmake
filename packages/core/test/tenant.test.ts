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
  it('allows an absent subscription URL and rejects non-HTTPS URLs', () => {
    expect(channelsSchema.parse({ telegram: { channelId: 'CHAT' } }).telegram).toEqual({
      channelId: 'CHAT',
    });
    for (const joinUrl of ['invalid', 'http://example.invalid', 'javascript:alert(1)']) {
      expect(channelsSchema.safeParse({ telegram: { channelId: 'CHAT', joinUrl } }).success).toBe(
        false,
      );
    }
  });

  it('rejects differing site and channel subscription URLs', () => {
    const yaml = realConfig().replace(
      'joinUrl: https://t.me/Faden_und_Stimmung',
      'joinUrl: https://t.me/different',
    );
    expect(() => parseTenantConfig(yaml)).toThrowError(/must match/);
  });

  it('validates the real tenant config file', () => {
    const config = parseTenantConfig(realConfig());
    expect(config.id).toBe('faden-und-stimmung');
    expect(config.languages).toEqual(['uk', 'de']);
    expect(config.meetingSchedule).toEqual({
      weekday: 'thursday',
      time: '14:00',
      timezone: 'Europe/Berlin',
    });
    expect(config.channels.telegram).toEqual({
      channelId: 'TELEGRAM_CHANNEL_ID',
      joinUrl: 'https://t.me/Faden_und_Stimmung',
    });
    expect(config.channels.facebook).toEqual({ language: 'de' });
    expect(config.channels.threads).toEqual({ language: 'de' });
    expect(Object.keys(config.channels)).toEqual(['telegram', 'instagram', 'facebook', 'threads']);
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
      '  instagram:\n    language: de',
      '  instagram:\n    language: fr',
    );
    expect(() => parseTenantConfig(withBadLanguage)).toThrowError(/instagram\.language/);
  });

  it('rejects facebook.language outside the tenant languages', () => {
    const withBadLanguage = realConfig().replace(
      '  facebook:\n    language: de',
      '  facebook:\n    language: fr',
    );
    expect(() => parseTenantConfig(withBadLanguage)).toThrowError(/facebook\.language/);
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
        paper: '#e3ddcd',
        ground: '#27313c',
        ink: '#283442',
        muted: '#5c6470',
        thread: '#b3362b',
      });
      expect(site?.theme.fonts).toEqual({ display: 'Gabriela', body: 'Onest' });
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
          '    colors: { ground: "#27313c", paper: "#FFFFFF", ink: "#000000", muted: "#777777", thread: "#123456" }',
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
      const bad = realConfig().replace("paper: '#e3ddcd'", 'paper: white');
      expect(() => parseTenantConfig(bad)).toThrowError(/colour/);
    });

    it('rejects the removed rule theme key', () => {
      const bad = realConfig().replace(
        "      thread: '#b3362b'",
        "      thread: '#b3362b'\n      rule: '#000000'",
      );
      expect(() => parseTenantConfig(bad)).toThrowError(/rule/);
    });

    it('rejects circle texts that miss a tenant language', () => {
      const bad = realConfig().replace(/\n {6}uk:\n {8}title:[\s\S]*?where: [^\n]*/, '');
      expect(() => parseTenantConfig(bad)).toThrowError(/circle\.texts/);
    });

    it('allows omitted profiles but rejects an empty profile list', () => {
      const tenant = parseTenantConfig(realConfig());
      delete tenant.site!.profiles;
      expect(parseTenantConfig(JSON.stringify(tenant)).site?.profiles).toBeUndefined();
      tenant.site!.profiles = [];
      expect(() => parseTenantConfig(JSON.stringify(tenant))).toThrowError(/site\.profiles/);
    });

    it.each(['http://example.invalid/profile', 'javascript:alert(1)'])(
      'rejects a non-https profile URL: %s',
      (url) => {
        const tenant = parseTenantConfig(realConfig());
        tenant.site!.profiles = [{ network: 'custom', url }];
        expect(() => parseTenantConfig(JSON.stringify(tenant))).toThrowError(
          /site\.profiles\.0\.url/,
        );
      },
    );

    it('rejects a non-https join link', () => {
      const bad = realConfig().replace(/joinUrl: https:\/\/\S+/, 'joinUrl: http://t.me/channel');
      expect(bad).toContain('joinUrl: http://t.me/channel');
      expect(() => parseTenantConfig(bad)).toThrowError(/joinUrl/);
    });

    it('accepts an optional discussion group link and rejects non-https values', () => {
      expect(parseTenantConfig(realConfig()).site?.groupUrl).toBe('https://t.me/+Q7txJldGFzh0Wy');
      const withoutGroup = realConfig().replace(/\n  groupUrl: https:\/\/\S+/, '');
      expect(parseTenantConfig(withoutGroup).site?.groupUrl).toBeUndefined();
      const bad = realConfig().replace('groupUrl: https://', 'groupUrl: http://');
      expect(() => parseTenantConfig(bad)).toThrowError(/groupUrl/);
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

describe('AI budget config', () => {
  const ai = `
ai:
  monthlyTargetEur: 20
  toleranceEur: 5
  translation:
    model: fixture-model
    inputEurPerMillion: 2
    outputEurPerMillion: 10
`;
  it('accepts tenant-local budgets and tariffs while keeping ai optional', () => {
    expect(parseTenantConfig(secondTenant).ai).toBeUndefined();
    expect(parseTenantConfig(secondTenant + ai).ai?.monthlyTargetEur).toBe(20);
  });
  it.each([
    ai.replace('monthlyTargetEur: 20', 'monthlyTargetEur: 0'),
    ai.replace('toleranceEur: 5', 'toleranceEur: -1'),
    ai.replace('inputEurPerMillion: 2', 'inputEurPerMillion: -2'),
    ai.replace('inputEurPerMillion: 2', 'inputEurPerMillion: .inf'),
    ai.replace('inputEurPerMillion: 2', 'inputEurPerMillion: 2\n    unknown: 1'),
    ai.replace('toleranceEur: 5', 'toleranceEur: 5\n  unknown: true'),
  ])('rejects malformed or unknown ai fields', (section) => {
    expect(() => parseTenantConfig(secondTenant + section)).toThrow(TenantConfigError);
  });
});

it('rejects Threads languages outside the tenant language set and unknown settings', () => {
  expect(() =>
    parseTenantConfig(
      realConfig().replace('  threads:\n    language: de', '  threads:\n    language: fr'),
    ),
  ).toThrow(/threads.language/);
  expect(
    channelsSchema.safeParse({ threads: { language: 'de', accessToken: 'bad' } }).success,
  ).toBe(false);
});
