import { Api } from 'grammy';
import type { StoredDraft, D1DraftStore } from './draft-store';
import { botTexts } from './texts';

export type ShowFinishOutcome = 'ready' | 'paid-calls-disabled' | 'failed';

/** Author-only notification; no upstream error or provider payload reaches Telegram. */
export function createShowFinish(token: string, drafts: Pick<D1DraftStore, 'chatIdOf'>) {
  const api = new Api(token);
  return async (stored: StoredDraft, outcome: ShowFinishOutcome, recovery: boolean) => {
    const { tenantId, draftId } = stored.draft;
    const chat = await drafts.chatIdOf(tenantId, draftId);
    if (!chat || !/^[1-9]\d*$/.test(chat)) throw new Error('author chat unavailable');
    const text = recovery
      ? outcome === 'ready'
        ? botTexts.showRecoveryReadyText
        : botTexts.showRecoveryFailedText
      : outcome === 'ready'
        ? botTexts.showRunReadyText
        : outcome === 'paid-calls-disabled'
          ? botTexts.showRunPausedText
          : botTexts.showRunFailedText;
    await api.sendMessage(chat, text, {
      reply_markup: {
        inline_keyboard: [
          ...(outcome !== 'ready' &&
          !recovery &&
          ['collecting', 'failed'].includes(stored.draft.state)
            ? [
                [
                  {
                    text: botTexts.showRetryButton,
                    callback_data: `show:${draftId}:${stored.draft.state === 'failed' ? 'retry' : 'start'}:${stored.version}`,
                  },
                ],
              ]
            : []),
          [
            {
              text: botTexts.showRefreshButton,
              callback_data: `show:${draftId}:preview:${stored.version}`,
            },
          ],
        ],
      },
    });
  };
}
