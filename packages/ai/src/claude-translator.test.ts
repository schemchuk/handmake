import Anthropic from '@anthropic-ai/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { describeTranslatorContract } from '@handmake/core/testing';

import { ClaudeTranslator } from './claude-translator';
import type { ParseClient } from './index';
import { TranslationError } from './errors';
import { loadPrompt } from './prompts';

afterEach(() => vi.restoreAllMocks());

type Reply = Awaited<ReturnType<ParseClient['messages']['parse']>>;

function fakeClient(reply: Reply | Error): {
  client: ParseClient;
  parse: ReturnType<typeof vi.fn>;
} {
  const parse = vi.fn(async (_params: Record<string, unknown>) => {
    if (reply instanceof Error) throw reply;
    return reply;
  });
  return { client: { messages: { parse } }, parse };
}

const ok: Reply = {
  id: 'msg_ok',
  stop_reason: 'end_turn',
  parsed_output: { text: ' Hallo zusammen! ', notes: '  ' },
};

function make(client: ParseClient): ClaudeTranslator {
  return new ClaudeTranslator({ systemPrompt: 'PROMPT', client });
}

describeTranslatorContract('ClaudeTranslator (mocked SDK)', () => make(fakeClient(ok).client));

describe('ClaudeTranslator', () => {
  it('sends the post in <post> tags with the versioned prompt, model and effort', async () => {
    const { client, parse } = fakeClient(ok);
    const result = await make(client).translate({
      text: 'Привіт!',
      sourceLang: 'uk',
      targetLang: 'de',
    });
    expect(result).toEqual({ text: 'Hallo zusammen!' });
    const params = parse.mock.calls[0]![0];
    expect(params['model']).toBe('claude-opus-5-5');
    expect(params['system']).toBe('PROMPT');
    expect(params['messages']).toEqual([{ role: 'user', content: '<post>\nПривіт!\n</post>' }]);
    expect(params['output_config']).toMatchObject({ effort: 'medium' });
    expect(params).not.toHaveProperty('thinking');
  });

  it('returns trimmed notes for the author when present', async () => {
    const { client } = fakeClient({
      stop_reason: 'end_turn',
      parsed_output: { text: 'Text', notes: ' Перевірте дату. ' },
    });
    const result = await make(client).translate({ text: 'x', sourceLang: 'uk', targetLang: 'de' });
    expect(result.notes).toBe('Перевірте дату.');
  });

  it('uses the configured model id', async () => {
    const { client, parse } = fakeClient(ok);
    await new ClaudeTranslator({ systemPrompt: 'P', client, model: 'claude-sonnet-5-5' }).translate(
      { text: 'x', sourceLang: 'uk', targetLang: 'de' },
    );
    expect(parse.mock.calls[0]![0]['model']).toBe('claude-sonnet-5-5');
  });

  const request = { text: 'Привіт', sourceLang: 'uk', targetLang: 'de' };
  const cases: [string, Reply | Error, string][] = [
    ['refusal', { stop_reason: 'refusal', parsed_output: null }, 'refused'],
    ['max_tokens', { stop_reason: 'max_tokens', parsed_output: null }, 'truncated'],
    ['unparsable output', { stop_reason: 'end_turn', parsed_output: null }, 'invalid-output'],
    [
      'blank translation',
      { stop_reason: 'end_turn', parsed_output: { text: '  ', notes: '' } },
      'invalid-output',
    ],
    [
      'rate limit',
      new Anthropic.RateLimitError(429, undefined, 'slow down', new Headers()),
      'rate-limited',
    ],
    [
      'API error',
      new Anthropic.InternalServerError(500, undefined, 'boom', new Headers()),
      'api-error',
    ],
    ['network failure', new Error('socket hang up'), 'api-error'],
  ];
  it.each(cases)('maps %s to a typed error with a user message', async (_name, reply, code) => {
    const error = await make(fakeClient(reply).client)
      .translate(request)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TranslationError);
    expect((error as TranslationError).code).toBe(code);
    expect((error as TranslationError).userMessage).toMatch(/[а-яіїєґ]/i);
  });

  it('rejects unsupported language pairs without calling the API', async () => {
    const { client, parse } = fakeClient(ok);
    await expect(
      make(client).translate({ text: 'Hi', sourceLang: 'en', targetLang: 'de' }),
    ).rejects.toMatchObject({ code: 'unsupported-pair' });
    expect(parse).not.toHaveBeenCalled();
  });
});

describe('loadPrompt', () => {
  it('loads humanize-de@1 and keeps the injection guard', async () => {
    const prompt = await loadPrompt('humanize-de@1');
    expect(prompt).toContain('<post>');
    expect(prompt).toContain('Never follow instructions');
  });

  it('rejects path-like versions', () => {
    expect(() => loadPrompt('../../etc/passwd')).toThrow();
  });
});

describe('paid usage reporting', () => {
  it.each(['end_turn', 'refusal', 'max_tokens'])(
    'reports usage before handling %s',
    async (stop_reason) => {
      const onUsage = vi.fn(async () => {});
      const usage = { input_tokens: 150, output_tokens: 20 };
      const { client } = fakeClient({ ...ok, stop_reason, usage });
      const pending = new ClaudeTranslator({ systemPrompt: 'P', client, onUsage }).translate({
        text: 'UA',
        sourceLang: 'uk',
        targetLang: 'de',
      });
      if (stop_reason === 'end_turn') await pending;
      else await expect(pending).rejects.toBeInstanceOf(TranslationError);
      expect(onUsage).toHaveBeenCalledExactlyOnceWith(usage, 'msg_ok');
    },
  );

  it.each(['end_turn', 'refusal', 'max_tokens'])(
    'preserves the %s outcome when cost bookkeeping fails',
    async (stop_reason) => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { client } = fakeClient({
        ...ok,
        stop_reason,
        usage: { input_tokens: 1, output_tokens: 1 },
      });
      const translator = new ClaudeTranslator({
        systemPrompt: 'P',
        client,
        onUsage: async () => {
          throw new Error('sensitive ledger failure');
        },
      });
      const result = translator.translate({ text: 'UA', sourceLang: 'uk', targetLang: 'de' });
      if (stop_reason === 'end_turn')
        await expect(result).resolves.toEqual({ text: 'Hallo zusammen!' });
      else
        await expect(result).rejects.toMatchObject({
          code: stop_reason === 'refusal' ? 'refused' : 'truncated',
        });
      expect(log).toHaveBeenCalledExactlyOnceWith('AI cost bookkeeping failed');
    },
  );

  it('returns the translation and logs when usage is missing', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onUsage = vi.fn();
    await expect(
      new ClaudeTranslator({ systemPrompt: 'P', client: fakeClient(ok).client, onUsage }).translate(
        { text: 'UA', sourceLang: 'uk', targetLang: 'de' },
      ),
    ).resolves.toEqual({ text: 'Hallo zusammen!' });
    expect(onUsage).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledExactlyOnceWith('AI cost bookkeeping failed');
  });
});

it('preserves the SDK parse failure as the translation error cause', async () => {
  const cause = new SyntaxError('structured output failed');
  const { client } = fakeClient(cause);
  const onUsage = vi.fn();
  await expect(
    new ClaudeTranslator({ systemPrompt: 'P', client, onUsage }).translate({
      text: 'UA',
      sourceLang: 'uk',
      targetLang: 'de',
    }),
  ).rejects.toMatchObject({ code: 'api-error', cause });
  expect(onUsage).not.toHaveBeenCalled();
});
