import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

/**
 * Tenant config lives in `config/tenants/<id>.yaml` and holds everything
 * about a tenant except secrets: it references secrets *by name* only.
 * This module is the single place that knows which channel keys exist:
 * `knownChannelKeys` is derived from `channelsSchema` below, so the two
 * can never drift apart.
 */

export const tenantConfigError = 'TenantConfigError';

export class TenantConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = tenantConfigError;
  }
}

export const languageCodeSchema = z.string().regex(/^[a-z]{2}$/);

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:MM');

const weekdaySchema = z.enum([
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]);

const timezoneSchema = z.string().superRefine((tz, ctx) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    ctx.addIssue({ code: 'custom', message: `unknown IANA timezone: ${tz}` });
  }
});

const weeklyMomentSchema = z.object({
  weekday: weekdaySchema,
  time: timeSchema,
});

export const channelsSchema = z
  .object({
    telegram: z
      .object({
        // Name of the secret holding the channel's Telegram chat id.
        channelId: z.string(),
      })
      .strict()
      .optional(),
    instagram: z
      .object({
        // Which tenant language Instagram posts are written in.
        language: languageCodeSchema,
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((channels) => Object.keys(channels).length > 0, 'at least one channel must be enabled');

// Derived from channelsSchema — single source of truth for channel keys.
export const knownChannelKeys = Object.keys(channelsSchema.shape);
export type ChannelKey = keyof typeof channelsSchema.shape;

const hexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'colour must be #RRGGBB');

// An origin only (scheme + host, no path, no trailing slash), so canonical
// URLs are always `${baseUrl}${path}` (T40).
const baseUrlSchema = z.string().superRefine((value, ctx) => {
  let url: URL | undefined;
  try {
    url = new URL(value);
  } catch {
    // reported below
  }
  if (!url || url.protocol !== 'https:' || url.origin !== value) {
    ctx.addIssue({
      code: 'custom',
      message: 'baseUrl must be an https origin without path or trailing slash',
    });
  }
});

const httpsUrlSchema = z.url({ protocol: /^https$/ });

/**
 * Website section (ADR 011, ADR 016). Optional: a tenant may use the bot and
 * channels without a site; the site build refuses a tenant without it.
 * Tenant-agnostic on purpose: colour roles and font names, never brand-
 * specific keys. Per-work accent colours belong to works (T36), not here.
 */
export const siteSchema = z
  .object({
    baseUrl: baseUrlSchema,
    // Served at `/`; every other tenant language under `/<lang>/`.
    defaultLanguage: languageCodeSchema,
    theme: z
      .object({
        colors: z
          .object({
            paper: hexColorSchema, // page background
            ink: hexColorSchema, // main text
            muted: hexColorSchema, // secondary text, captions, meta
            rule: hexColorSchema, // dividers and decorative lines
          })
          .strict(),
        fonts: z
          .object({
            // Font family names; the site self-hosts the files (no font CDN).
            display: z.string().min(1),
            body: z.string().min(1),
          })
          .strict(),
      })
      .strict(),
    // The circle page. Optional: a blogger tenant has no circle. "When" is
    // rendered from meetingSchedule, never duplicated here.
    circle: z
      .object({
        // Public link to join, e.g. the Telegram channel.
        joinUrl: httpsUrlSchema,
        // One entry per tenant language (checked below).
        texts: z.record(
          languageCodeSchema,
          z
            .object({
              title: z.string().min(1),
              what: z.string().min(1),
              where: z.string().min(1),
            })
            .strict(),
        ),
      })
      .strict()
      .optional(),
  })
  .strict();

export type SiteConfig = z.infer<typeof siteSchema>;

export const tenantConfigSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'tenant id must be kebab-case'),
    name: z.string().min(1),
    languages: z.array(languageCodeSchema).min(1),
    channels: channelsSchema,
    contentStore: z
      .object({
        type: z.enum(['git-repo']),
      })
      .strict(),
    meetingSchedule: z
      .object({
        weekday: weekdaySchema,
        time: timeSchema,
        timezone: timezoneSchema,
      })
      .strict(),
    // Whether the poll runs is featureFlags.wotwPoll — a single switch.
    // Times use meetingSchedule.timezone.
    workOfWeek: z
      .object({
        opens: weeklyMomentSchema.strict(),
        closes: weeklyMomentSchema.strict(),
      })
      .strict(),
    // F18: the bot cron announces each meeting and reminds about it. Times
    // use meetingSchedule.timezone; templates are Ukrainian (the author's
    // language) and may use the {weekday}, {date} and {time} placeholders,
    // filled with the announced meeting in meetingSchedule.timezone.
    announcements: z
      .object({
        schedule: z
          .object({
            announcement: weeklyMomentSchema.strict(),
            reminder: weeklyMomentSchema.strict(),
          })
          .strict(),
        templates: z
          .object({
            announcement: z.string().min(1),
            reminder: z.string().min(1),
          })
          .strict(),
      })
      .strict(),
    ai: z
      .object({
        monthlyTargetEur: z.number().positive(),
        toleranceEur: z.number().nonnegative(),
        translation: z
          .object({
            model: z.string().min(1),
            inputEurPerMillion: z.number().nonnegative(),
            outputEurPerMillion: z.number().nonnegative(),
          })
          .strict(),
      })
      .strict()
      .optional(),
    site: siteSchema.optional(),
    featureFlags: z.record(z.string(), z.boolean()),
    // Commercialization stub — must stay empty for now (spec section 8).
    offerings: z.array(z.never()),
  })
  .strict()
  .superRefine((config, ctx) => {
    const site = config.site;
    if (site && !config.languages.includes(site.defaultLanguage)) {
      ctx.addIssue({
        code: 'custom',
        path: ['site', 'defaultLanguage'],
        message: `site.defaultLanguage "${site.defaultLanguage}" is not in languages [${config.languages.join(', ')}]`,
      });
    }
    if (site?.circle) {
      const textLangs = Object.keys(site.circle.texts).sort();
      const tenantLangs = [...config.languages].sort();
      if (textLangs.join(',') !== tenantLangs.join(',')) {
        ctx.addIssue({
          code: 'custom',
          path: ['site', 'circle', 'texts'],
          message: `site.circle.texts must have exactly the tenant languages [${config.languages.join(', ')}], got [${textLangs.join(', ')}]`,
        });
      }
    }
    const instagram = config.channels.instagram;
    if (instagram && !config.languages.includes(instagram.language)) {
      ctx.addIssue({
        code: 'custom',
        path: ['channels', 'instagram', 'language'],
        message: `instagram.language "${instagram.language}" is not in languages [${config.languages.join(', ')}]`,
      });
    }
  });

export type TenantConfig = z.infer<typeof tenantConfigSchema>;
export type WeeklyMoment = z.infer<typeof weeklyMomentSchema>;
export type MeetingSchedule = z.infer<typeof tenantConfigSchema.shape.meetingSchedule>;

/** A value that smells like an actual secret rather than a config value. */
const secretValuePatterns: RegExp[] = [
  // Telegram bot token
  /\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/,
  // AWS access key id
  /\bAKIA[0-9A-Z]{16}\b/,
  // GitHub tokens
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  // Anthropic / OpenAI-style API keys (sk-, sk-ant-, sk-proj-, ...)
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  // PEM private key
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

const secretNameKeyPattern = /(token|secret|password|api[_-]?key)/i;
const secretNameValuePattern = /^[A-Z][A-Z0-9_]*$/;

function assertNoSecretValues(node: unknown, path: string): void {
  if (typeof node === 'string') {
    if (secretNameKeyPattern.test(path) && !secretNameValuePattern.test(node)) {
      throw new TenantConfigError(
        `value at "${path}" looks like a secret, not a secret name; ` +
          'store values in GitHub/Worker secrets and reference them by NAME',
      );
    }
    for (const pattern of secretValuePatterns) {
      if (pattern.test(node)) {
        throw new TenantConfigError(
          `value at "${path}" matches a known secret pattern; ` +
            'secrets must never appear in tenant config',
        );
      }
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, i) => assertNoSecretValues(item, `${path}[${i}]`));
    return;
  }
  if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      assertNoSecretValues(value, path ? `${path}.${key}` : key);
    }
  }
}

export function parseTenantConfig(yamlText: string): TenantConfig {
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (error) {
    throw new TenantConfigError(`tenant config is not valid YAML: ${(error as Error).message}`);
  }

  assertNoSecretValues(raw, '');

  const result = tenantConfigSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.join('.') || '(root)';
    throw new TenantConfigError(
      `invalid tenant config at ${path}: ${issue?.message ?? 'unknown error'}`,
    );
  }
  return result.data;
}
