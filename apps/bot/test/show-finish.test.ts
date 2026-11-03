import { beforeEach, expect, it, vi } from 'vitest';
import { createDraft } from '@handmake/core';
import { createShowFinish } from '../src/show-finish';
const { sendMessage } = vi.hoisted(() => ({ sendMessage: vi.fn() }));
vi.mock('grammy', () => ({
  Api: class {
    sendMessage = sendMessage;
  },
}));
beforeEach(() => vi.clearAllMocks());
const stored = {
  draft: createDraft('tenant', '01JBCA1B2C3D4E5F6G7H8J9K0A', new Date(), { kind: 'show' }),
  version: 12,
  pendingEdit: null,
};
it.each(['ready', 'paid-calls-disabled', 'failed'] as const)(
  'delivers %s to the scoped author with current callbacks',
  async (outcome) => {
    const chatIdOf = vi.fn().mockResolvedValue('123');
    await createShowFinish('test', { chatIdOf })(stored, outcome, false);
    expect(chatIdOf).toHaveBeenCalledWith('tenant', stored.draft.draftId);
    const [chat, text, options] = sendMessage.mock.calls[0]!;
    expect(chat).toBe('123');
    expect(text).toContain(
      outcome === 'ready'
        ? 'Результати готові'
        : outcome === 'failed'
          ? 'Запуск зупинився'
          : 'платні виклики вимкнені',
    );
    expect(options.reply_markup.inline_keyboard.flat()).toContainEqual({
      text: 'Оновити перегляд',
      callback_data: `show:${stored.draft.draftId}:preview:12`,
    });
    if (outcome !== 'ready')
      expect(options.reply_markup.inline_keyboard.flat()).toContainEqual({
        text: 'Продовжити генерацію',
        callback_data: `show:${stored.draft.draftId}:start:12`,
      });
  },
);
it('explains recovery failures need operator action and never offers paid generation', async () => {
  await createShowFinish('test', { chatIdOf: async () => '123' })(stored, 'failed', true);
  expect(sendMessage.mock.calls[0]![1]).toContain('не допоможе без дії оператора');
  expect(sendMessage.mock.calls[0]![2].reply_markup.inline_keyboard).toHaveLength(1);
});
it('rejects missing or non-private author destinations', async () => {
  await expect(
    createShowFinish('test', { chatIdOf: async () => '-123' })(stored, 'failed', false),
  ).rejects.toThrow('author chat unavailable');
  expect(sendMessage).not.toHaveBeenCalled();
});
