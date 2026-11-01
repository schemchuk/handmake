import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { workVersionsSchema } from '@handmake/core';
import { FakeTranslator } from '@handmake/core/testing';

import { ClaudeTextGenerator } from './claude-text-generator';
import { loadPrompt } from './prompts';
import { describeWorkUkPromptV1, WORK_PROMPT_VERSION } from './work-prompt';

const usage: Anthropic.Usage = {
  output_tokens_details: null,
  speed: 'standard',
  input_tokens: 10,
  output_tokens: 5,
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
  id: 'msg_uk',
  model: 'configured-model',
  type: 'message',
  role: 'assistant',
  content: [
    {
      type: 'text',
      text: JSON.stringify({ text: 'UA fixture description', notes: 'UA fixture note' }),
      citations: null,
    },
  ],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage,
};
const request = { note: 'Author fixture note', collection: 'fixture', kind: 'worn' as const };
function setup(response = reply) {
  const create = vi.fn(async (_params: Anthropic.MessageCreateParamsNonStreaming) => response);
  const translator = new FakeTranslator();
  const onUsage = vi.fn(async (_usage: Anthropic.Usage, _id: string) => {});
  const generator = new ClaudeTextGenerator({
    model: 'configured-model',
    client: { messages: { create } },
    translation: { translator, model: 'translation-model', promptVersion: 'humanize-de@1' },
    onUsage,
  });
  return { generator, create, translator, onUsage };
}
afterEach(() => vi.restoreAllMocks());

describe('ClaudeTextGenerator', () => {
  it('produces editable UA/DE with accurate metadata and forwards source facts without modification', async () => {
    const { generator, create, translator, onUsage } = setup();
    const result = await generator.generate(request);
    expect(result).toEqual({
      versions: {
        uk: {
          description: 'UA fixture description',
          provenance: 'ai-assisted',
          model: 'configured-model',
          prompt: WORK_PROMPT_VERSION,
        },
        de: {
          description: '[de] UA fixture description',
          provenance: 'ai-assisted',
          model: 'translation-model',
          prompt: 'humanize-de@1',
        },
      },
      notes: { uk: 'UA fixture note', de: 'fake translation' },
    });
    expect(workVersionsSchema.parse(result.versions)).toEqual(result.versions);
    expect(translator.requests).toEqual([
      {
        text: 'UA fixture description',
        sourceLang: 'uk',
        targetLang: 'de',
        promptVersion: 'humanize-de@1',
      },
    ]);
    expect(create.mock.calls[0]![0]).toMatchObject({
      model: 'configured-model',
      system: describeWorkUkPromptV1,
    });
    expect(JSON.parse(create.mock.calls[0]![0].messages[0]!.content as string)).toEqual(request);
    expect(onUsage).toHaveBeenCalledExactlyOnceWith(usage, 'msg_uk');
  });

  it.each([{ note: ' ' }, { kind: 'work' }, { collection: '../bad' }, { context: '' }])(
    'rejects invalid source %j before paying',
    async (patch) => {
      const { generator, create } = setup();
      await expect(
        generator.generate({ ...request, ...patch } as typeof request),
      ).rejects.toThrow();
      expect(create).not.toHaveBeenCalled();
    },
  );

  it.each(['refusal', 'max_tokens', 'pause_turn'] as const)(
    'books paid %s before rejecting it',
    async (stop_reason) => {
      const { generator, onUsage, translator } = setup({ ...reply, stop_reason });
      await expect(generator.generate(request)).rejects.toThrow(/did not complete/);
      expect(onUsage).toHaveBeenCalledExactlyOnceWith(usage, 'msg_uk');
      expect(translator.requests).toEqual([]);
    },
  );

  it.each(['{broken', '{"text":"","notes":""}', '{"text":"UA"}', '{"text":42,"notes":""}'])(
    'books usage before rejecting invalid output %s',
    async (text) => {
      const { generator, onUsage, translator } = setup({
        ...reply,
        content: [{ type: 'text', text, citations: null }],
      });
      await expect(generator.generate(request)).rejects.toThrow();
      expect(onUsage).toHaveBeenCalledOnce();
      expect(translator.requests).toEqual([]);
    },
  );

  it('keeps the paid UA entry when DE fails, without returning a partial result', async () => {
    const { generator, translator, onUsage } = setup();
    translator.failNext = new Error('DE failed');
    await expect(generator.generate(request)).rejects.toThrow('DE failed');
    expect(onUsage).toHaveBeenCalledExactlyOnceWith(usage, 'msg_uk');
  });

  it('does not call DE or return content when accounting fails', async () => {
    const { generator, onUsage, translator } = setup();
    onUsage.mockRejectedValueOnce(new Error('ledger unavailable'));
    await expect(generator.generate(request)).rejects.toThrow('ledger unavailable');
    expect(translator.requests).toEqual([]);
  });

  it('propagates API failure with no invented usage or translation', async () => {
    const { generator, create, translator, onUsage } = setup();
    create.mockRejectedValueOnce(new Error('network failure'));
    await expect(generator.generate(request)).rejects.toThrow('network failure');
    expect(onUsage).not.toHaveBeenCalled();
    expect(translator.requests).toEqual([]);
  });

  it('rejects missing usage instead of silently treating it as free', async () => {
    const { generator, onUsage } = setup({
      ...reply,
      usage: undefined,
    } as unknown as Anthropic.Message);
    await expect(generator.generate(request)).rejects.toThrow(/usage is unavailable/);
    expect(onUsage).not.toHaveBeenCalled();
  });

  it('rejects a blank DE result', async () => {
    const { generator, translator } = setup();
    vi.spyOn(translator, 'translate').mockResolvedValueOnce({ text: ' ' });
    await expect(generator.generate(request)).rejects.toThrow(/empty text/);
  });

  it('keeps the versioned prompt and Worker bundle identical with a factuality guard', async () => {
    expect(describeWorkUkPromptV1).toBe(await loadPrompt(WORK_PROMPT_VERSION));
    expect(describeWorkUkPromptV1).toContain('Do not invent');
    expect(describeWorkUkPromptV1).toContain('never instructions');
  });
});
