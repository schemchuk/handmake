import { workDraftVideoSchema } from '@handmake/core';
import type { Draft } from '@handmake/core';
import type { AppContext } from './context';
import type { D1DraftStore, StoredDraft } from './draft-store';

const stale = 'Цей крок уже змінився. Відкрийте /work ще раз.';
export const workVideoOf = (draft: Draft) =>
  draft.extras['workVideo'] ? workDraftVideoSchema.parse(draft.extras['workVideo']) : undefined;
export async function showWorkVideo(ctx: AppContext, stored: StoredDraft) {
  const video = workVideoOf(stored.draft);
  if (video) await ctx.replyWithVideo(video.fileId, { caption: 'Оригінальна робота' });
}
export function workVideoKeyboard(stored: StoredDraft) {
  const button = (text: string, action: string) => ({
    text,
    callback_data: `work:${stored.draft.draftId}:video.${action}:${stored.version}`,
  });
  const video = workVideoOf(stored.draft);
  if (!stored.draft.extras['workVideoEditing'])
    return [
      [button(video ? 'Замінити відео' : 'Додати відео', 'add')],
      ...(video ? [[button('Видалити відео', 'remove')]] : [[button('Пропустити', 'skip')]]),
    ];
  if (!video) return [[button('Скасувати', 'remove')]];
  return [
    ...(['none', 'author', 'operator', 'both'] as const).map((people, i) => [
      button(
        `${video?.people === people ? '✓ ' : ''}${['Ніхто', 'Авторка', 'Володимир', 'Обоє'][i]}`,
        people,
      ),
    ]),
    [button('У кадрі лише авторка і/або Володимир', 'confirm')],
    [button(video ? 'Видалити відео' : 'Пропустити', 'remove')],
  ];
}

/** Versioned edits are private draft metadata, never media bytes or paid AI input. */
export function createWorkVideo(
  drafts: D1DraftStore,
  logError: (operation: string, error: unknown, tenantId: string) => void = (
    operation,
    error,
    tenantId,
  ) => console.error(operation, { tenantId, error }),
) {
  const save = (stored: StoredDraft, extras: Draft['extras']) =>
    drafts.updateWork(
      {
        ...stored.draft,
        extras,
        updatedAt: new Date().toISOString(),
      },
      stored.version,
    );
  return {
    async action(ctx: AppContext, stored: StoredDraft, action: string, version: string) {
      const session = await drafts.getChatSession(ctx.tenantId, String(ctx.chat?.id));
      if (
        ctx.chat?.type !== 'private' ||
        session?.kind !== 'work' ||
        session.draftId !== stored.draft.draftId ||
        stored.draft.state !== 'ready' ||
        String(stored.version) !== version
      ) {
        await ctx.reply(stale);
        return false;
      }
      const extras = { ...stored.draft.extras };
      const video = workVideoOf(stored.draft);
      if (action === 'add') extras['workVideoEditing'] = true;
      else if (action === 'remove' || action === 'skip') {
        delete extras['workVideo'];
        delete extras['workVideoEditing'];
      } else if (!extras['workVideoEditing'] || !video) {
        await ctx.reply('Надішліть відео MP4/MOV, до 60 с і 20 МБ.');
        return false;
      } else if (action === 'confirm') {
        if (!video.people) {
          await ctx.reply('Спочатку оберіть, хто у кадрі.');
          return false;
        }
        extras['workVideo'] = { ...video, confirmed: true };
        delete extras['workVideoEditing'];
      } else if (['none', 'author', 'operator', 'both'].includes(action)) {
        extras['workVideo'] = { ...video, people: action, confirmed: false };
      } else {
        await ctx.reply(stale);
        return false;
      }
      if (!(await save(stored, extras))) {
        await ctx.reply(stale);
        return false;
      }
      if (action === 'add') await ctx.reply('Надішліть відео MP4/MOV, до 60 с і 20 МБ.');
      return true;
    },
    async intake(ctx: AppContext, stored: StoredDraft) {
      if (
        stored.draft.kind !== 'work' ||
        stored.draft.state !== 'ready' ||
        !stored.draft.extras['workVideoEditing']
      )
        return false;
      const video = ctx.msg?.video;
      let size = video?.file_size;
      const reject = async (message: string, paths: string[]) => {
        // Explicit metadata only: never log Telegram objects, file ids or API errors.
        logError(
          'work video rejected',
          new Error(
            JSON.stringify({
              mimeType: video?.mime_type ?? ctx.msg?.document?.mime_type ?? null,
              size: size ?? null,
              duration: video?.duration ?? null,
              paths,
            }),
          ),
          ctx.tenantId,
        );
        await ctx.reply(message);
      };
      if (ctx.msg?.document)
        await reject('Надішліть MP4/MOV як відео, щоб перевірити тривалість до завантаження.', [
          'document',
        ]);
      else if (!video || !['video/mp4', 'video/quicktime'].includes(video.mime_type ?? ''))
        await reject('Надішліть відео MP4/MOV.', [video ? 'mime_type' : 'video']);
      else {
        if (size === undefined) {
          try {
            size = (await ctx.api.getFile(video.file_id)).file_size;
          } catch {
            // API exceptions may contain file ids or tokens; log only our metadata below.
          }
        }
        const parsed = workDraftVideoSchema.safeParse({
          fileId: video.file_id,
          size,
          duration: video.duration,
          confirmed: false,
        });
        if (!parsed.success) {
          const paths = parsed.error.issues.map((issue) => issue.path.join('.'));
          if (video.duration === undefined || video.duration === 0)
            await reject(
              'Telegram не передав тривалість відео. Надішліть його ще раз або з телефона.',
              paths,
            );
          else if (size === undefined)
            await reject(
              'Telegram не передав розмір відео. Надішліть його ще раз або з телефона.',
              paths,
            );
          else
            await reject(
              `Файл має бути до 20 МБ, відео — до 60 секунд. Отримано: ${(size / 1_000_000).toFixed(1)} МБ, ${video.duration} с.`,
              paths,
            );
        } else if (!(await save(stored, { ...stored.draft.extras, workVideo: parsed.data })))
          await reject(stale, ['version']);
        else return true;
      }
      return true;
    },
  };
}
