import { authenticOf } from './show-authentic';
import { refreshKeyboard } from './show-preview';
import { botTexts } from './texts';
import { showPublicationSchema } from '@handmake/core';
import type { PublishJob, WorkReader, ShowPublication, ShowVideo } from '@handmake/core';
import { InputFile } from 'grammy';
import type { AppContext } from './context';
import type { D1DraftStore, StoredDraft } from './draft-store';
import { publishingStaleMs } from './draft-store';
import { MissingShowVerification, resolveVerifiedShowSnapshot } from './show-verification';
import type { createShowVerificationStore } from './show-verification';

export type ShowApproval = {
  present(ctx: AppContext, stored: StoredDraft): Promise<unknown>;
  approve(ctx: AppContext, stored: StoredDraft, version: string): Promise<PublishJob | undefined>;
};

/** Uploads are repeatable; only the final version CAS grants immutable publication consent. */
export function createShowApproval(deps: {
  drafts: D1DraftStore;
  verified: Pick<ReturnType<typeof createShowVerificationStore>, 'get'>;
  works: WorkReader;
  authentic?: (stored: StoredDraft) => Promise<ShowPublication['media']>;
  backfill?: (stored: StoredDraft) => Promise<void | 'dispatched' | 'running'>;
}): ShowApproval {
  const { drafts } = deps;
  const current = async (ctx: AppContext, stored: StoredDraft) => {
    const active = await drafts.getSessionShow(
      ctx.tenantId,
      String(ctx.chat?.id),
      stored.draft.draftId,
    );
    if (
      ctx.chat?.type !== 'private' ||
      ctx.tenantId !== stored.draft.tenantId ||
      !active ||
      active.version !== stored.version ||
      active.draft.extras['showCancelled']
    )
      throw new Error('stale show approval');
  };
  return {
    async present(ctx, stored) {
      await current(ctx, stored);
      if (stored.draft.state !== 'ready' || stored.draft.extras['showApproved'])
        throw new Error('show not ready');
      const own = authenticOf(stored);
      if (own?.editing || (own?.items.length && (!own.confirmed || !own.people))) {
        return ctx.reply(
          'Завершіть додавання власних медіа та підтвердьте, хто у кадрі.',
          refreshKeyboard(stored, botTexts),
        );
      }
      let authenticMedia: ShowPublication['media'] = [];
      if (own?.items.length) {
        try {
          if (!deps.authentic) throw new Error('authentic transport unavailable');
          authenticMedia = await deps.authentic(stored);
          await current(ctx, stored);
        } catch {
          return ctx.reply(
            'Не вдалося зберегти власні фото/відео. Спробуйте «Оновити перегляд» ще раз.',
            refreshKeyboard(stored, botTexts),
          );
        }
      }
      const media: ShowPublication['media'] = [...authenticMedia];
      const images: ShowPublication['show']['images'] = [];
      let video: ShowVideo | undefined;
      const snapshot = await (async () => {
        // Preflight every slot without retaining media before any Telegram upload.
        await resolveVerifiedShowSnapshot(deps, stored, async () => {});
        return resolveVerifiedShowSnapshot(deps, stored, async (item) => {
          await current(ctx, stored);
          const fileName = `${item.slot}.${item.slot === 'video' ? 'mp4' : 'png'}`;
          const message = await ctx.replyWithDocument(new InputFile(item.result.bytes, fileName));
          const doc = message.document;
          if (
            !doc?.file_id ||
            !doc.file_unique_id ||
            doc.file_name !== fileName ||
            doc.file_size !== item.result.bytes.length ||
            doc.mime_type !== item.result.mimeType
          )
            throw new Error('document identity mismatch');
          media.push({ fileName, ref: own?.items.length ? item.ref : doc.file_id });
          const metadata = {
            fileName,
            provenance: 'ai-generated' as const,
            model: item.result.model,
            promptVersion: item.result.promptVersion,
            callId: item.result.callId,
            marker: item.evidence.marker,
          };
          if (item.slot === 'video') video = { ...metadata, durationSeconds: 5 };
          else images.push(metadata);
        });
      })().catch(async (error: unknown) => {
        if (!(error instanceof MissingShowVerification) || !deps.backfill) throw error;
        await current(ctx, stored);
        try {
          const outcome = await deps.backfill(stored);
          if (outcome === 'running') {
            await ctx.reply(
              'Перевірка файлів уже триває. Натисніть «Оновити перегляд» після завершення. Якщо запуск не завершиться, повторна спроба стане доступною протягом години.',
              refreshKeyboard(stored, botTexts),
            );
            return;
          }
        } catch {
          await ctx.reply(
            'Не вдалося запустити перевірку збережених файлів. Спробуйте «Оновити перегляд» ще раз.',
          );
          return;
        }
        await ctx.reply(
          'Показ збережено. Запущено перевірку файлів без повторної генерації та оплати. Після завершення натисніть «Оновити перегляд».',
          refreshKeyboard(stored, botTexts),
        );
      });
      if (!snapshot) return;
      if (own?.items.length) {
        await ctx.reply('Оригінальна робота');
        for (const item of own.items) {
          await current(ctx, stored);
          if (item.kind === 'photo') await ctx.replyWithPhoto(item.fileId);
          else await ctx.replyWithVideo(item.fileId);
        }
      }
      const work = await deps.works.readWork(snapshot.tenantId, snapshot.plan.workId);
      if (!work || work.tenant !== snapshot.tenantId || work.id !== snapshot.plan.workId)
        throw new Error('linked work missing');
      const publication = showPublicationSchema.parse({
        show: {
          id: snapshot.showId,
          tenant: snapshot.tenantId,
          date: stored.draft.createdAt,
          workId: work.id,
          template: snapshot.plan.template,
          model: snapshot.plan.model,
          provenance: 'ai-assisted',
          originals: work.photos.map((fileName) => ({ fileName, provenance: 'human' })),
          images,
          video,
          ...(own?.items.length
            ? {
                authentic: own.items.map((item) => ({
                  fileName: item.fileName,
                  kind: item.kind,
                  provenance: 'human',
                  people: own.people,
                })),
              }
            : {}),
          versions: work.versions,
        },
        media,
      });
      const job: PublishJob = {
        tenantId: snapshot.tenantId,
        postId: snapshot.showId,
        kind: 'show',
        type: stored.draft.type,
        provenance: 'ai-assisted',
        texts: Object.fromEntries(
          Object.entries(work.versions).map(([lang, v]) => [lang, v.description]),
        ),
        fileIds: [],
        show: publication,
      };
      if (new TextEncoder().encode(JSON.stringify(job)).length > 60_000)
        throw new Error('show dispatch too large');
      // Send every character, with no truncation or regeneration of the author's descriptions.
      await ctx.reply(`Робота: ${work.id}`);
      for (const [lang, version] of Object.entries(work.versions)) {
        await ctx.reply(`${lang} (${version.provenance})`);
        for (let i = 0; i < version.description.length; i += 4000)
          await ctx.reply(version.description.slice(i, i + 4000));
      }
      await current(ctx, stored);
      if (
        !(await drafts.updateShow(
          {
            ...stored.draft,
            extras: {
              ...stored.draft.extras,
              showProposal: job,
              showProposalVersion: stored.version + 1,
            },
            updatedAt: new Date().toISOString(),
          },
          stored.version,
        ))
      )
        throw new Error('stale show proposal');
      // Failed notification leaves the proposal recoverable through /show, with a fresh preview.
      return ctx.reply('Схвалити ці тексти та всі надіслані файли показу?', {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: 'Схвалити показ',
                callback_data: `show:${snapshot.showId}:approve:${stored.version + 1}`,
              },
            ],
            ...refreshKeyboard({ ...stored, version: stored.version + 1 }, botTexts).reply_markup
              .inline_keyboard,
          ],
        },
      });
    },
    async approve(ctx, stored, version) {
      await current(ctx, stored);
      const approved = stored.draft.extras['showApproved'] as PublishJob | undefined;
      if (approved) {
        if (String(stored.draft.extras['showApprovalVersion']) !== version) return;
        const claimed = await drafts.claimPublishing(
          ctx.tenantId,
          stored.draft.draftId,
          new Date(),
          new Date(Date.now() - publishingStaleMs),
          String(ctx.chat!.id),
        );
        return claimed ? approved : undefined;
      }
      if (
        String(stored.version) !== version ||
        stored.draft.state !== 'ready' ||
        (!!authenticOf(stored)?.items.length && !authenticOf(stored)?.confirmed) ||
        authenticOf(stored)?.editing === true ||
        stored.draft.extras['showProposalVersion'] !== stored.version
      )
        return;
      const proposal = stored.draft.extras['showProposal'] as PublishJob | undefined;
      if (
        !proposal ||
        proposal.kind !== 'show' ||
        proposal.tenantId !== ctx.tenantId ||
        proposal.postId !== stored.draft.draftId
      )
        throw new Error('missing show proposal');
      showPublicationSchema.parse(proposal.show);
      await resolveVerifiedShowSnapshot(deps, stored, async () => {});
      // One statement freezes payload and state against cancellation and regeneration.
      if (!(await drafts.freezeShowApproval(stored, proposal, String(ctx.chat!.id)))) return;
      return proposal;
    },
  };
}
