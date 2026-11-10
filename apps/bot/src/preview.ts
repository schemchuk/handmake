import {
  FacebookRenderError,
  facebookSkipReason,
  instagramCaptionWindow,
  InstagramRenderError,
  instagramSkipReason,
  renderFacebook,
  renderInstagram,
  renderTelegram,
  TelegramRenderError,
  telegramCapabilities,
  renderThreads,
  threadsTextLength,
  ThreadsRenderError,
} from '@handmake/channels';
import {
  buildApprovedWorkJob,
  canonicalLinkSettings,
  canonicalUrl,
  readWorkDraftData,
} from '@handmake/core';
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
 * render result matters for the preview. `siteExcluded` projects a test
 * publish (the bot's PUBLISH_LIVE off): the publisher sets it on the real
 * Post, so the preview must render the same flag.
 */
function draftAsPost(draft: Draft, now: Date, siteExcluded = false): Post {
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
    ...(siteExcluded ? { siteExcluded: true } : {}),
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
  /** False while publishes still go to the test channel (bot PUBLISH_LIVE):
   * the projected post is site-excluded, so no canonical footer and no
   * Instagram copy — exactly what the publisher will do. Defaults to live. */
  publishesLive = true,
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
  // no site; work drafts link to the work page; test publishes get no
  // footer because the excluded post has none).
  const canonical = publishesLive
    ? config
      ? canonicalLinkSettings(config, draft.kind === 'work' ? 'works' : 'posts')
      : undefined
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
    // Facebook captions ARE clickable (F33), so the canonical settings ride
    // along and the preview shows the exact caption the Page receives.
    config?.channels.facebook
      ? {
          ...config.channels.facebook,
          ...(canonical ? { canonical } : {}),
        }
      : undefined,
    !publishesLive,
    config?.channels.threads
      ? { ...config.channels.threads, ...(canonical ? { canonical } : {}) }
      : undefined,
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
  facebook?: TenantConfig['channels']['facebook'] & { canonical?: CanonicalLinkSettings },
  /** Projects a site-excluded (test) publish. */
  siteExcluded = false,
  threads?: TenantConfig['channels']['threads'] & { canonical?: CanonicalLinkSettings },
): PreviewMessage {
  const post = draftAsPost(draft, now, siteExcluded);
  const uk = draft.texts['uk'];
  const de = draft.texts['de'];
  const primaryLanguage =
    telegram?.languages?.find((lang) => post.texts[lang] !== undefined) ??
    Object.keys(post.texts)[0];
  const primaryText = primaryLanguage ? post.texts[primaryLanguage] : undefined;

  let threadsPreview: string | undefined;
  let blockedError: string | undefined;
  let instagramCaption: { lang: string; caption: string } | undefined;
  let instagramSkip: ReturnType<typeof instagramSkipReason> | undefined;
  let instagramApplies = false;
  let facebookCaption: { lang: string; caption: string } | undefined;
  let facebookSkip: ReturnType<typeof facebookSkipReason> | undefined;
  let facebookApplies = false;
  try {
    if (draft.kind === 'work') buildApprovedWorkJob(draft);
    const workChannels =
      draft.kind === 'work' ? readWorkDraftData(draft).config.channels : undefined;
    if (draft.kind !== 'work' || (workChannels?.length ?? 0) > 0) renderTelegram(post, telegram);
    if (threads && (workChannels?.includes('threads') ?? true)) {
      const op = renderThreads(post, threads)[0];
      const text =
        op?.kind === 'message' ? op.text : op?.kind === 'mediaGroup' ? op.caption : undefined;
      threadsPreview =
        text === undefined
          ? texts.previewThreadsSkip
          : texts.previewThreads(threadsTextLength(text), text);
    }
    // Instagram copies only items that announce on it (a work announcing on
    // other channels alone must never be judged by Instagram rules); a
    // site-excluded/test post never renders.
    instagramApplies = instagram !== undefined && (workChannels?.includes('instagram') ?? true);
    if (instagramApplies && post.texts[instagram!.language] !== undefined) {
      const ops = renderInstagram(post, instagram);
      if (ops.length === 0) {
        instagramSkip = instagramSkipReason(post);
      } else {
        const op = ops[0] as { caption?: string; captionLang?: string };
        instagramCaption = {
          lang: op.captionLang ?? instagram!.language,
          caption: op.caption ?? '',
        };
      }
    }
    // Facebook follows the same announce-only and test-publish rules as
    // Instagram; its captions carry the clickable canonical site link.
    facebookApplies = facebook !== undefined && (workChannels?.includes('facebook') ?? true);
    if (facebookApplies && post.texts[facebook!.language] !== undefined) {
      const ops = renderFacebook(post, facebook);
      if (ops.length === 0) {
        facebookSkip = facebookSkipReason(post);
      } else {
        const op = ops[0] as { caption?: string; captionLang?: string };
        facebookCaption = {
          lang: op.captionLang ?? facebook!.language,
          caption: op.caption ?? '',
        };
      }
    }
  } catch (error) {
    if (
      error instanceof TelegramRenderError ||
      error instanceof InstagramRenderError ||
      error instanceof FacebookRenderError ||
      error instanceof ThreadsRenderError
    ) {
      // Render limits are author-actionable: name the exact rule (render
      // errors read as-is inside the channel-agnostic blocked text).
      blockedError = error.message;
    } else if (draft.kind === 'work') {
      // Only a broken work setup hides behind the generic text.
      blockedError = texts.workSetupText;
    } else {
      throw error;
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
        // Slice by code points, not UTF-16 units: an emoji astral of the
        // window edge would otherwise split into a lone surrogate (PR #93
        // review note). Array.from iterates code points.
        texts.previewInstagramWindow(
          Array.from(instagramCaption.caption).slice(0, instagramCaptionWindow).join(''),
        ),
      );
    } else if (instagramSkip !== undefined) {
      lines.push('');
      lines.push(texts.previewInstagramSkip(instagramSkip));
    }
  }

  // Facebook (F33, T26b): unlike Instagram, the caption carries the clickable
  // canonical site link, so the block shows that link line — the one thing
  // the author cannot see in the Telegram/Instagram sections above.
  if (facebookApplies && blockedError === undefined) {
    if (facebookCaption !== undefined) {
      lines.push('');
      lines.push(texts.previewFacebookHeader(facebookCaption.lang, facebookCaption.caption.length));
      const canonical = facebook?.canonical;
      if (canonical?.links) {
        lines.push(
          texts.previewFacebookLink(
            canonicalUrl(canonical, canonical.section, post.id, facebookCaption.lang),
          ),
        );
      }
    } else if (facebookSkip !== undefined) {
      lines.push('');
      lines.push(texts.previewFacebookSkip(facebookSkip));
    }
  }

  if (threadsPreview && !blockedError) lines.push('', threadsPreview);
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
