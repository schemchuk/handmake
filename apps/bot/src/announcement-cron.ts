import { deterministicUlid } from '@handmake/core';
import type { TenantConfig, Translator } from '@handmake/core';
import type { Bot } from 'grammy';

import {
  announcementWindowMs,
  latestOccurrenceInWindow,
  meetingDayKey,
  nextMeetingAfter,
  renderTemplate,
} from './announcements';
import type { AllowList } from './allow-list';
import { buildPreview } from './preview';
import type { D1DraftStore } from './draft-store';
import type { BotTexts } from './texts';
import type { TenantConfigSource } from './tenant-config-source';
import type { AppContext } from './context';

export type AnnouncementKind = 'announcement' | 'reminder';

/**
 * F18 cron (T20): for each tenant, when the configured announcement or
 * reminder moment just fired, create one `ready` draft from the Ukrainian
 * template — German via the translator — and send the author the usual
 * preview. Nothing is posted without her 🚀 (same rule as everything else).
 *
 * Idempotency: the draft id is a deterministic ULID seeded with tenant, kind
 * and meeting day, inserted with INSERT OR IGNORE and created already in
 * 'translating'. An overlapping or retried cron tick hits the same id and
 * stops. A crash between insert and markTranslated leaves a 'translating'
 * row no preview button points at — T25 sessions scope /done to the author's
 * own draft, so it lingers until the 30-day retention cleanup.
 */
export interface AnnouncementCronOptions {
  drafts: D1DraftStore;
  translator: Translator;
  /** Production resolves tenant pricing and books each paid call by reference. */
  translatorFor?: (tenantId: string, ref: string) => Promise<Translator>;
  bot: Bot<AppContext>;
  tenantConfigs: TenantConfigSource;
  /** The parsed allow-list, grouped here by tenant: cron needs tenant → authors. */
  allowList: AllowList;
  texts: BotTexts;
}

export async function runAnnouncementCron(
  now: Date,
  options: AnnouncementCronOptions,
): Promise<void> {
  const authorsByTenant = new Map<string, number[]>();
  for (const [userId, tenantId] of options.allowList) {
    const authors = authorsByTenant.get(tenantId) ?? [];
    authors.push(userId);
    authorsByTenant.set(tenantId, authors);
  }

  for (const [tenantId, authorIds] of authorsByTenant) {
    // One failing tenant must never take down the others' announcements.
    try {
      const config = await options.tenantConfigs.load(tenantId);
      await runForTenant(now, tenantId, authorIds, config, options);
    } catch (error) {
      console.error(`announcement cron failed for tenant ${tenantId}:`, (error as Error).message);
    }
  }
}

async function runForTenant(
  now: Date,
  tenantId: string,
  authorIds: number[],
  config: TenantConfig,
  options: AnnouncementCronOptions,
): Promise<void> {
  const timeZone = config.meetingSchedule.timezone;
  for (const kind of ['announcement', 'reminder'] as const) {
    const occurred = latestOccurrenceInWindow(
      config.announcements.schedule[kind],
      now,
      announcementWindowMs,
      timeZone,
    );
    if (!occurred) {
      continue;
    }
    await createDraftAndPreview(now, tenantId, authorIds, kind, occurred, config, options);
  }
}

async function createDraftAndPreview(
  now: Date,
  tenantId: string,
  authorIds: number[],
  kind: AnnouncementKind,
  occurred: Date,
  config: TenantConfig,
  options: AnnouncementCronOptions,
): Promise<void> {
  const timeZone = config.meetingSchedule.timezone;
  const meeting = nextMeetingAfter(config.meetingSchedule, occurred, timeZone);
  const dayKey = meetingDayKey(meeting, timeZone);
  const draftId = await deterministicUlid(`${tenantId}:${kind}:${dayKey}`, meeting.getTime());
  const created = {
    tenantId,
    draftId,
    state: 'translating' as const,
    // T25: the type rides through the dispatch, so an announcement or
    // reminder is committed to the content repo as what it is, not 'free'.
    kind: 'post' as const,
    type: kind,
    extras: {},
    texts: { uk: renderTemplate(config.announcements.templates[kind], meeting, timeZone) },
    photoRefs: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  // The first author holds the row; every author of the tenant gets the
  // preview (in practice the allow-list has exactly one author per tenant).
  const inserted = await options.drafts.createIfAbsent(created, String(authorIds[0]));
  if (!inserted) {
    return;
  }

  let german: string;
  try {
    const translator =
      (await options.translatorFor?.(tenantId, `post:${draftId}`)) ?? options.translator;
    german = (
      await translator.translate({
        text: created.texts.uk,
        sourceLang: 'uk',
        targetLang: 'de',
      })
    ).text;
  } catch {
    await options.drafts.markTranslationFailed(tenantId, draftId, new Date());
    await notifyAll(options, authorIds, options.texts.cronTranslationFailedText);
    return;
  }
  await options.drafts.markTranslated(tenantId, draftId, german, new Date());

  const stored = await options.drafts.get(tenantId, draftId);
  if (!stored) {
    return;
  }
  const preview = buildPreview(stored.draft, options.texts);
  for (const authorId of authorIds) {
    await options.bot.api
      .sendMessage(
        String(authorId),
        preview.text,
        preview.keyboard ? { reply_markup: preview.keyboard } : {},
      )
      .catch(() => undefined);
  }
}

/** Failure to reach one author must not block the others. */
async function notifyAll(
  options: AnnouncementCronOptions,
  authorIds: number[],
  text: string,
): Promise<void> {
  for (const authorId of authorIds) {
    await options.bot.api.sendMessage(String(authorId), text).catch(() => undefined);
  }
}
