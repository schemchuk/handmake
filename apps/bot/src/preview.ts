import {
  instagramCaptionWindow,
  InstagramRenderError,
  instagramSkipReason,
  renderInstagram,
  renderTelegram,
  TelegramRenderError,
  telegramCapabilities,
} from '@handmake/channels';
import { buildApprovedWorkJob, canonicalLinkSettings, readWorkDraftData } from '@handmake/core';
import type { CanonicalLinkSettings, Draft, Post, TenantConfig } from '@handmake/core';

import type { BotTexts } from './texts';
import type { TenantConfigSource } from './tenant-config-source';

/**
 * The author preview (T15): renders the draft through the very same
 * `renderTelegram` the publisher uses, so what she approves is what gets
 * posted. Telegram limits therefore surface here as a blocked state: the
 * Publish button is simply absent and the problem is explained in text.
 */

export interface PreviewKeyboardButton {
  text: string;
  callback_data: string;
}

export interface PreviewMessage {
  text: string;
  /** Inline keyboard; undefined only when nothing can be done (no draft). */
  keyboard: { inline_keyboard: PreviewKeyboardButton[][] } | undefined;
}

/** Display cap per language version: a preview message must itself fit the
 * 4096-char Telegram limit even with both versions and headers inside. */
const previewTextChars = 900;

function truncate(text: string, texts: BotTexts): string {
  if (text.length <= previewTextChars) {
    return text;
  }
  return text.slice(0, previewTextChars) + texts.previewTruncatedNote;
}

/**
 * Synthesizes the Post the publisher would receive from this draft. Key order
 * of `texts` is uk-then-de: without channel settings, renderTelegram takes the
 * language order from the record, and Ukrainian must stay the primary
 * (album-caption) language. The draft id doubles as the post id — only the
 * render result matters for the preview.
 */
function draftAsPost(draft: Draft, now: Date): Post {
  const texts: Record<string, string> = {};
  if (draft.texts['uk'] !== undefined) texts['uk'] = draft.texts['uk'];
  if (draft.texts['de'] !== undefined) texts['de'] = draft.texts['de'];
  return {
    id: draft.draftId,
    tenant: draft.tenantId,
    date: now.toISOString(),
    publishAt: 'now',
    type: draft.type,
    photos: draft.photoRefs,
    channels: ['telegram'],
    versions: {
      uk: { provenance: 'human' },
      ...(texts['de'] !== undefined ? { de: { provenance: 'ai-assisted' as const } } : {}),
    },
    texts,
  };
}

/**
 * The preview keyboard (T25): every button carries the draft id, so a press
 * always acts on the draft this preview was sent for — never on a newer
 * draft or a cron-created one sharing the chat.
 */
function keyboard(draftId: string, texts: BotTexts, blocked: boolean): PreviewKeyboardButton[][] {
  const rows: PreviewKeyboardButton[][] = [
    [
      { text: texts.editUkButton, callback_data: `draft:${draftId}:edit:uk` },
      { text: texts.editDeButton, callback_data: `draft:${draftId}:edit:de` },
      { text: texts.regenDeButton, callback_data: `draft:${draftId}:regen-de` },
    ],
  ];
  const second: PreviewKeyboardButton[] = [];
  if (!blocked) {
    second.push({ text: texts.publishButton, callback_data: `draft:${draftId}:publish` });
  }
  second.push({ text: texts.discardButton, callback_data: `draft:${draftId}:discard` });
  rows.push(second);
  return rows;
}

/** Resolve the same tenant settings used by publication, including its footer. */
export async function buildTenantPreview(
  draft: Draft,
  texts: BotTexts,
  configs?: TenantConfigSource,
): Promise<PreviewMessage> {
  let config: TenantConfig | undefined;
  try {
    config = await configs?.load(draft.tenantId);
  } catch {
    console.warn('Preview tenant config unavailable; using default settings');
  }
  if (config && config.id !== draft.tenantId) throw new Error('tenant config mismatch');
  // T40: the preview must render exactly what the publisher will deliver,
  // including the canonical footer (absent when the flag is off or there is
  // no site; work drafts link to the work page).
  const canonical = config
    ? canonicalLinkSettings(config, draft.kind === 'work' ? 'works' : 'posts')
    : undefined;
  return buildPreview(
    draft,
    texts,
    new Date(),
    config?.channels.telegram
      ? {
          ...config.channels.telegram,
          languages: config.languages,
          ...(canonical ? { canonical } : {}),
        }
      : undefined,
    // Instagram captions carry no link (ported rule: captions are not
    // clickable), so no canonical settings are passed.
    config?.channels.instagram,
  );
}

export function buildPreview(
  draft: Draft,
  texts: BotTexts,
  now = new Date(),
  telegram?: TenantConfig['channels']['telegram'] & {
    languages?: string[];
    canonical?: CanonicalLinkSettings;
  },
  instagram?: TenantConfig['channels']['instagram'],
): PreviewMessage {
  const post = draftAsPost(draft, now);
  const uk = draft.texts['uk'];
  const de = draft.texts['de'];
  const primaryLanguage =
    telegram?.languages?.find((lang) => post.texts[lang] !== undefined) ??
    Object.keys(post.texts)[0];
  const primaryText = primaryLanguage ? post.texts[primaryLanguage] : undefined;

  let blockedError: string | undefined;
  let instagramCaption: { lang: string; caption: string } | undefined;
  let instagramSkip: ReturnType<typeof instagramSkipReason> | undefined;
  // Instagram copies only items that announce on channels (works opt out via
  // their announcement switch); a site-excluded/test post never renders.
  const instagramApplies =
    instagram !== undefined &&
    (draft.kind !== 'work' || readWorkDraftData(draft).config.channels.length > 0);
  try {
    if (draft.kind === 'work') buildApprovedWorkJob(draft);
    if (draft.kind !== 'work' || readWorkDraftData(draft).config.channels.length)
      renderTelegram(post, telegram);
    if (instagramApplies) {
      const ops = renderInstagram(post, instagram);
      if (ops.length === 0) {
        instagramSkip = instagramSkipReason(post);
      } else {
        const op = ops[0] as { caption?: string; captionLang?: string };
        instagramCaption = {
          lang: op.captionLang ?? instagram.language,
          caption: op.caption ?? '',
        };
      }
    }
  } catch (error) {
    if (draft.kind === 'work') blockedError = texts.workSetupText;
    else if (!(error instanceof TelegramRenderError) && !(error instanceof InstagramRenderError)) {
      throw error;
    }
    if (error instanceof TelegramRenderError || error instanceof InstagramRenderError) {
      blockedError = error.message;
    }
  }

  const lines: string[] = [texts.previewHeader(draft.photoRefs.length), ''];
  if (blockedError !== undefined) {
    lines.push(texts.previewBlockedText(blockedError));
    lines.push('');
  }

  const ukText = uk ?? '';
  lines.push(texts.previewUkLabel(ukText.length));
  lines.push(truncate(ukText, texts) || '—');

  lines.push('');
  if (de !== undefined) {
    lines.push(texts.previewDeLabel(de.length));
    lines.push(truncate(de, texts));
  } else {
    lines.push(texts.previewDeMissing);
  }

  // Not a blocker: renderTelegram splits a >1024 caption into an album plus
  // a separate message, but the author should know that layout in advance.
  if (
    blockedError === undefined &&
    draft.photoRefs.length > 0 &&
    primaryText !== undefined &&
    primaryText.length > telegramCapabilities.captionLimit &&
    (draft.kind !== 'work' || readWorkDraftData(draft).config.channels.length > 0)
  ) {
    lines.push('');
    lines.push(texts.previewCaptionSplitNote);
  }

  // Instagram (F33, T26a1): the caption window Instagram shows before "more",
  // the caption length against the 2200 limit, or the reason this post will
  // not copy to Instagram. A caption breaking an Instagram limit is a blocked
  // state (handled above) exactly like a Telegram limit.
  if (instagramApplies && blockedError === undefined) {
    if (instagramCaption !== undefined) {
      lines.push('');
      lines.push(
        texts.previewInstagramHeader(instagramCaption.lang, instagramCaption.caption.length),
      );
      lines.push(
        texts.previewInstagramWindow(instagramCaption.caption.slice(0, instagramCaptionWindow)),
      );
    } else if (instagramSkip !== undefined) {
      lines.push('');
      lines.push(texts.previewInstagramSkip(instagramSkip));
    }
  }

  const rows = keyboard(draft.draftId, texts, blockedError !== undefined);
  if (draft.kind === 'work' && !blockedError) {
    const { config } = readWorkDraftData(draft);
    lines.unshift(
      texts.workPreview(
        texts.workKinds[config.kind],
        String(draft.extras['workCollectionTitle'] ?? '').slice(0, 60),
      ),
    );
    rows.unshift([
      {
        text: config.channels.length ? texts.workAnnounceOn : texts.workAnnounceOff,
        callback_data: `work:${draft.draftId}:announce:${config.channels.length ? 'no' : 'yes'}`,
      },
    ]);
  }
  return {
    text: lines.join('\n'),
    keyboard: { inline_keyboard: rows },
  };
}
