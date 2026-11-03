import { showDraftDataSchema } from '@handmake/core';
import type { ShowResultStore, ShowSourceImage } from '@handmake/core';
import { InputFile } from 'grammy';
import type { AppContext } from './context';
import type { D1DraftStore, StoredDraft } from './draft-store';
import type { BotTexts } from './texts';

export type ShowPreview = (ctx: AppContext, stored: StoredDraft) => Promise<unknown>;

/** Deliver immutable private originals and marked documents; never resolve raw provider media. */
export function createShowPreview(deps: {
  drafts: D1DraftStore;
  texts: BotTexts;
  marked: Pick<ShowResultStore, 'get'>;
  original: (tenant: string, ref: string) => Promise<ShowSourceImage>;
}): ShowPreview {
  return async (ctx, stored) => {
    const { tenantId, draftId } = stored.draft;
    const data = showDraftDataSchema.parse(stored.draft.extras['show']);
    const identity = JSON.stringify(data);
    const current = async () => {
      if (ctx.tenantId !== tenantId || ctx.chat?.type !== 'private')
        throw new Error('stale preview');
      const chat = String(ctx.chat.id);
      const latest = await deps.drafts.getSessionShow(tenantId, chat, draftId);
      if (
        !latest ||
        latest.version !== stored.version ||
        latest.draft.kind !== 'show' ||
        latest.draft.extras['showCancelled'] ||
        !['collecting', 'translating', 'failed', 'ready'].includes(latest.draft.state) ||
        JSON.stringify(showDraftDataSchema.parse(latest.draft.extras['show'])) !== identity
      )
        throw new Error('stale preview');
    };
    await current();
    let missing = 0;
    const send = async (bytes: Uint8Array, name: string, caption: string) => {
      if (!bytes.length || bytes.length > 20_000_000) throw new Error('invalid preview media');
      await current();
      await ctx.replyWithDocument(new InputFile(bytes, `${draftId}-${name}`), { caption });
    };
    try {
      for (const [index, ref] of data.plan.originals.entries()) {
        await current();
        let image: ShowSourceImage;
        try {
          image = await deps.original(tenantId, ref);
        } catch {
          console.error('show preview failed', 'original unavailable');
          missing++;
          continue;
        }
        const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[
          image.mimeType
        ];
        if (!ext) throw new Error('invalid original type');
        await send(
          image.bytes,
          `original-${index + 1}.${ext}`,
          deps.texts.showOriginalLabel(index + 1),
        );
      }
      const slots = [
        ...Array.from({ length: data.plan.imageCount }, (_, i) => `image-${i}`),
        'video',
      ];
      for (const slot of slots) {
        await current();
        const receipt = data.outputs[slot];
        if (!receipt) {
          missing++;
          continue;
        }
        const suffix = `v1:${tenantId}:${draftId}:${receipt.attemptId}`;
        if (receipt.ref !== `show-raw:${suffix}`) throw new Error('invalid output identity');
        let marked: Awaited<ReturnType<ShowResultStore['get']>>;
        try {
          marked = await deps.marked.get(tenantId, draftId, receipt.attemptId);
        } catch {
          console.error('show preview failed', 'marked media unavailable');
          missing++;
          continue;
        }
        if (!marked) {
          console.error('show preview failed', 'marked media missing');
          missing++;
          continue;
        }
        const mimeType = slot === 'video' ? 'video/mp4' : 'image/png';
        if (
          marked.ref !== `show-marked:${suffix}` ||
          marked.result.mimeType !== mimeType ||
          (['callId', 'model', 'promptVersion', 'costEur'] as const).some(
            (key) => marked!.result[key] !== receipt[key],
          )
        )
          throw new Error('invalid marked identity');
        await send(
          marked.result.bytes,
          `${slot}.${slot === 'video' ? 'mp4' : 'png'}`,
          deps.texts.showMarkedLabel(slot),
        );
      }
      await current();
      return ctx.reply(deps.texts.showPreviewStatus(missing), refreshKeyboard(stored, deps.texts));
    } catch {
      console.error('show preview failed', 'delivery interrupted');
      // A partially delivered preview never grants approval. Refresh reads a fresh version via /show.
      return ctx.reply(deps.texts.showPreviewInterruptedText);
    }
  };
}

export function refreshKeyboard(stored: StoredDraft, texts: BotTexts) {
  return {
    reply_markup: {
      inline_keyboard: [
        ...(stored.draft.state === 'ready'
          ? [
              ...Array.from(
                { length: showDraftDataSchema.parse(stored.draft.extras['show']).plan.imageCount },
                (_, i) => `image-${i}`,
              ),
              'video',
            ].map((slot) => [
              {
                text: texts.showRegenerateButton(slot),
                callback_data: `show:${stored.draft.draftId}:regen:${stored.version}.${slot}`,
              },
            ])
          : stored.draft.state === 'failed'
            ? [
                [
                  {
                    text: texts.showRetryButton,
                    callback_data: `show:${stored.draft.draftId}:retry:${stored.version}`,
                  },
                ],
              ]
            : []),
        [
          {
            text: texts.showRefreshButton,
            callback_data: `show:${stored.draft.draftId}:preview:${stored.version}`,
          },
        ],
      ],
    },
  };
}
