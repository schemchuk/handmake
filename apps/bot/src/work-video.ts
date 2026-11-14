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
export function createWorkVideo(drafts: D1DraftStore) {
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
      if (ctx.msg?.document)
        await ctx.reply('Надішліть MP4/MOV як відео, щоб перевірити тривалість до завантаження.');
      else if (!video || !['video/mp4', 'video/quicktime'].includes(video.mime_type ?? ''))
        await ctx.reply('Надішліть відео MP4/MOV.');
      else {
        const parsed = workDraftVideoSchema.safeParse({
          fileId: video.file_id,
          size: video.file_size,
          duration: video.duration,
          confirmed: false,
        });
        if (!parsed.success) await ctx.reply('Файл має бути до 20 МБ, відео — до 60 секунд.');
        else if (!(await save(stored, { ...stored.draft.extras, workVideo: parsed.data })))
          await ctx.reply(stale);
        else return true;
      }
      return true;
    },
  };
}
