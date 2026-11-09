import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ClaudeCommentDrafter } from './claude-comment-drafter';
import { commentReplyPromptV1 } from './comment-reply-prompt';

const READER_HANDLE = 'anna_reader';
const READER_TEXT = 'Wunderschöne Stickerei!';

const usage: Anthropic.Usage = {
  output_tokens_details: null,
  speed: 'standard',
  input_tokens: 120,
  output_tokens: 60,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation: null,
  server_tool_use: null,
  service_tier: 'standard',
  inference_geo: 'not_available',
};
const reply: Anthropic.Message = {
  container: null,
  diagnostics: null,
  stop_details: null,
  id: 'msg_comment',
  model: 'configured-model',
  type: 'message',
  role: 'assistant',
  content: [
    {
      type: 'text',
      text: JSON.stringify({
        translation_uk: 'Чудова вишивка!',
        reply_de: 'Danke, Anna, das freut uns sehr!',
        notes_uk: '',
      }),
      citations: null,
    },
  ],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage,
};
const request = {
  network: 'instagram',
  handle: READER_HANDLE,
  text: READER_TEXT,
  postId: 'media-1',
};
function setup(response = reply) {
  const create = vi.fn(async (_params: Anthropic.MessageCreateParamsNonStreaming) => response);
  const onUsage = vi.fn(async (_usage: Anthropic.Usage, _id: string) => {});
  const drafter = new ClaudeCommentDrafter({
    model: 'configured-model',
    client: { messages: { create } },
    onUsage,
  });
  return { drafter, create, onUsage };
}
afterEach(() => vi.restoreAllMocks());

describe('ClaudeCommentDrafter', () => {
  it('returns the translation, the German draft and the note in one paid call', async () => {
    const { drafter, create, onUsage } = setup();

    const draft = await drafter.draft(request);

    expect(draft).toEqual({
      translationUk: 'Чудова вишивка!',
      replyDe: 'Danke, Anna, das freut uns sehr!',
      notesUk: '',
    });
    expect(create.mock.calls[0]![0]).toMatchObject({
      model: 'configured-model',
      system: commentReplyPromptV1,
    });
    expect(JSON.parse(create.mock.calls[0]![0].messages[0]!.content as string)).toEqual(request);
    expect(onUsage).toHaveBeenCalledExactlyOnceWith(usage, 'msg_comment');
  });

  it('requires usage identity before any output validation', async () => {
    const create = vi.fn(
      async (_params: Anthropic.MessageCreateParamsNonStreaming) =>
        ({ ...reply, id: undefined }) as unknown as Anthropic.Message,
    );
    const onUsage = vi.fn(async (_usage: Anthropic.Usage, _id: string) => {});
    const drafter = new ClaudeCommentDrafter({
      model: 'configured-model',
      client: { messages: { create } },
      onUsage,
    });

    await expect(drafter.draft(request)).rejects.toThrow(/usage is unavailable/);
    expect(onUsage).not.toHaveBeenCalled();
  });

  it.each([{ handle: '' }, { network: 'facebook' }] as const)(
    'accepts a from-less comment and both supported networks: %j',
    async (patch) => {
      const { drafter, create } = setup();
      const draft = await drafter.draft({ ...request, ...patch });
      expect(draft.replyDe).not.toBe('');
      expect(create).toHaveBeenCalledOnce();
    },
  );

  it.each([{ text: ' ' }, { network: 'telegram' }, { postId: '' }, { handle: 7 }])(
    'rejects invalid source %j before paying',
    async (patch) => {
      const { drafter, create } = setup();
      await expect(drafter.draft({ ...request, ...patch } as typeof request)).rejects.toThrow();
      expect(create).not.toHaveBeenCalled();
    },
  );

  it.each(['refusal', 'max_tokens', 'pause_turn'] as const)(
    'books paid %s before rejecting it',
    async (stop_reason) => {
      const { drafter, onUsage } = setup({ ...reply, stop_reason });
      await expect(drafter.draft(request)).rejects.toThrow(/did not complete/);
      expect(onUsage).toHaveBeenCalledExactlyOnceWith(usage, 'msg_comment');
    },
  );

  it.each([
    '{broken',
    '{"translation_uk":"","reply_de":"","notes_uk":""}',
    '{"translation_uk":"UA"}',
    '{"translation_uk":42,"reply_de":"","notes_uk":""}',
  ])('books usage before rejecting invalid output %s', async (text) => {
    const { drafter, onUsage } = setup({
      ...reply,
      content: [{ type: 'text', text, citations: null }],
    });
    await expect(drafter.draft(request)).rejects.toThrow();
    expect(onUsage).toHaveBeenCalledExactlyOnceWith(usage, 'msg_comment');
  });

  it('an empty reply_de is a valid recommendation to not reply', async () => {
    const { drafter } = setup({
      ...reply,
      content: [
        {
          type: 'text',
          citations: null,
          text: JSON.stringify({
            translation_uk: 'Купіть підписників тут',
            reply_de: '',
            notes_uk: 'Схоже на спам: варто приховати і не відповідати.',
          }),
        },
      ],
    });
    const draft = await drafter.draft({ ...request, text: 'cheap followers click here' });
    expect(draft.replyDe).toBe('');
    expect(draft.notesUk).toContain('спам');
  });

  it('error messages never echo the reader comment or handle', async () => {
    const { drafter } = setup({ ...reply, stop_reason: 'max_tokens' });
    let caught: unknown;
    await drafter.draft(request).catch((error) => {
      caught = error;
    });
    const message = caught instanceof Error ? caught.message : String(caught);
    expect(message).not.toContain(READER_TEXT);
    expect(message).not.toContain(READER_HANDLE);
  });
});
