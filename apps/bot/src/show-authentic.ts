import type { AppContext } from './context';
import type { D1DraftStore, StoredDraft } from './draft-store';

export type ShowAuthentic = {
  editing: boolean;
  items: {
    fileId: string;
    fileName: string;
    kind: 'photo' | 'video';
    size: number;
    duration?: number;
  }[];
  people?: 'none' | 'author' | 'operator' | 'both';
  confirmed: boolean;
};
export const authenticOf = (stored: StoredDraft) =>
  stored.draft.extras['showAuthentic'] as ShowAuthentic | undefined;
const error = 'Цей крок уже змінився. Відкрийте /show ще раз.';

export function authenticKeyboard(stored: StoredDraft) {
  if (stored.draft.extras['showApproved']) return [];
  return [
    [
      {
        text: 'Додати свої фото/відео',
        callback_data: `show:${stored.draft.draftId}:own:${stored.version}`,
      },
    ],
  ];
}

/** Telegram ids remain private draft input; approval transport is supplied separately. */
export function createShowAuthentic(drafts: D1DraftStore) {
  const save = (stored: StoredDraft, value: ShowAuthentic) => {
    const extras: Record<string, unknown> = { ...stored.draft.extras, showAuthentic: value };
    delete extras['showProposal'];
    delete extras['showProposalVersion'];
    return drafts.updateShow(
      { ...stored.draft, extras, updatedAt: new Date().toISOString() },
      stored.version,
    );
  };
  const present = async (ctx: AppContext, stored: StoredDraft) => {
    const own = authenticOf(stored)!;
    const button = (text: string, action: string) => ({
      text,
      callback_data: `show:${stored.draft.draftId}:${action}:${stored.version}`,
    });
    for (const item of own.items) {
      if (item.kind === 'photo')
        await ctx.replyWithPhoto(item.fileId, { caption: 'Оригінальна робота' });
      else await ctx.replyWithVideo(item.fileId, { caption: 'Оригінальна робота' });
    }
    return ctx.reply(
      'Оригінальна робота\nНадішліть до 3 фото та 1 відео (MP4/MOV, до 60 с і 20 МБ). Хто у кадрі?',
      {
        reply_markup: {
          inline_keyboard: [
            ...own.items.map((item, index) => [
              button(
                `Видалити ${item.kind === 'photo' ? 'фото' : 'відео'} ${index + 1}`,
                `ownremove.${index}`,
              ),
            ]),
            ...(['none', 'author', 'operator', 'both'] as const).map((people, index) => [
              button(
                `${own.people === people ? '✓ ' : ''}${['Ніхто', 'Авторка', 'Володимир', 'Обоє'][index]}`,
                `ownpeople.${people}`,
              ),
            ]),
            [button('У кадрі лише авторка і/або Володимир', 'ownconfirm')],
            [button(own.items.length ? 'Готово' : 'Пропустити', 'owndone')],
          ],
        },
      },
    );
  };
  const eligible = (stored: StoredDraft) =>
    stored.draft.state === 'ready' &&
    !!stored.draft.extras['show'] &&
    !stored.draft.extras['showApproved'] &&
    !stored.draft.extras['showCancelled'];
  return {
    async action(ctx: AppContext, stored: StoredDraft, action: string, version: string) {
      const active = await drafts.getSessionShow(
        ctx.tenantId,
        String(ctx.chat?.id),
        stored.draft.draftId,
      );
      if (
        ctx.chat?.type !== 'private' ||
        !active ||
        active.version !== stored.version ||
        String(stored.version) !== version ||
        !eligible(stored)
      )
        return ctx.reply(error);
      if (action === 'owncancel') {
        if (
          !(await drafts.updateShow(
            {
              ...stored.draft,
              state: 'failed',
              updatedAt: new Date().toISOString(),
              extras: { ...stored.draft.extras, showCancelled: true },
            },
            stored.version,
          ))
        )
          return ctx.reply(error);
        return ctx.reply('Показ скасовано.');
      }
      const own: ShowAuthentic = structuredClone(
        authenticOf(stored) ?? { editing: true, items: [], confirmed: false },
      );
      if (action === 'own') own.editing = true;
      else if (!own.editing) return ctx.reply(error);
      else if (action.startsWith('ownremove.')) {
        const index = Number(action.split('.')[1]);
        if (!Number.isInteger(index) || !own.items[index]) return ctx.reply(error);
        own.items.splice(index, 1);
        own.confirmed = false;
      } else if (action.startsWith('ownpeople.')) {
        const people = action.split('.')[1];
        if (!['none', 'author', 'operator', 'both'].includes(people!)) return ctx.reply(error);
        own.people = people as ShowAuthentic['people'];
        own.confirmed = false;
      } else if (action === 'ownconfirm') {
        if (!own.people) return ctx.reply('Спочатку оберіть, хто у кадрі.');
        own.confirmed = true;
      } else if (action === 'owndone') {
        if (own.items.length && (!own.people || !own.confirmed))
          return ctx.reply('Оберіть, хто у кадрі, та підтвердьте, що інших людей немає.');
        own.editing = false;
      } else return ctx.reply(error);
      if (!(await save(stored, own))) return ctx.reply(error);
      const updated = (await drafts.get(ctx.tenantId, stored.draft.draftId))!;
      if (own.editing) return present(ctx, updated);
      return ctx.reply('Збережено. Відкрийте /show для перегляду.');
    },
    async intake(ctx: AppContext, id: string) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const stored = await drafts.getSessionShow(ctx.tenantId, String(ctx.chat?.id), id);
        if (!stored || !eligible(stored) || !authenticOf(stored)?.editing) return false;
        const own = structuredClone(authenticOf(stored)!);
        const photo = ctx.msg?.photo?.at(-1);
        const video = ctx.msg?.video;
        const document = ctx.msg?.document;
        const file = photo ?? video ?? document;
        const kind = photo ? 'photo' : 'video';
        const validDocument =
          document &&
          ['video/mp4', 'video/quicktime'].includes(document.mime_type ?? '') &&
          /\.(mp4|mov)$/i.test(document.file_name ?? '');
        if (
          !file ||
          (!photo && !video && !validDocument) ||
          (video && video.mime_type !== 'video/mp4' && video.mime_type !== 'video/quicktime')
        ) {
          await ctx.reply('Надішліть фото або відео MP4/MOV.');
          return true;
        }
        // Documents carry no duration: require a Telegram video with inspectable metadata.
        if (document) {
          await ctx.reply('Надішліть MP4/MOV як відео, щоб перевірити тривалість до завантаження.');
          return true;
        }
        if (
          !Number.isFinite(file.file_size) ||
          file.file_size! <= 0 ||
          file.file_size! > 20_000_000 ||
          (video &&
            (!Number.isFinite(video.duration) || video.duration <= 0 || video.duration > 60))
        ) {
          await ctx.reply('Файл має бути до 20 МБ, відео — до 60 секунд.');
          return true;
        }
        if (own.items.some((item) => item.fileId === file.file_id)) return true;
        if (own.items.filter((item) => item.kind === kind).length >= (photo ? 3 : 1)) {
          await ctx.reply('Можна додати до 3 фото та 1 відео.');
          return true;
        }
        const extension = photo ? 'jpg' : 'mp4';
        const index = [1, 2, 3].find(
          (n) => !own.items.some((item) => item.fileName === `authentic-${kind}-${n}.${extension}`),
        )!;
        own.items.push({
          fileId: file.file_id,
          fileName: `authentic-${kind}-${index}.${extension}`,
          kind,
          size: file.file_size!,
          ...(video ? { duration: video.duration } : {}),
        });
        own.confirmed = false;
        if (!(await save(stored, own))) continue;
        await ctx.reply(
          'Файл збережено. Додайте решту файлів, потім відкрийте /show і «Додати свої фото/відео», щоб підтвердити, хто у кадрі.',
        );
        return true;
      }
      await ctx.reply(error);
      return true;
    },
  };
}
