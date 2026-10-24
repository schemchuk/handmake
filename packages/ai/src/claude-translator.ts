import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

import type { TranslationRequest, TranslationResult, Translator } from '@handmake/core';

import { TranslationError } from './errors';

export const DEFAULT_MODEL = 'claude-opus-5-5';
export const DEFAULT_PROMPT_VERSION = 'humanize-de@1';

const outputSchema = z.object({
  text: z.string(),
  notes: z.string(),
});

/** The one SDK call the translator needs; tests pass a fake. */
export interface ParseClient {
  messages: {
    parse(params: Record<string, unknown>): Promise<{
      stop_reason: string | null;
      parsed_output: z.infer<typeof outputSchema> | null;
    }>;
  };
}

export interface ClaudeTranslatorOptions {
  /** Text of `prompts/humanize-de@N.md`; see `loadPrompt` for Node. */
  systemPrompt: string;
  /** Provenance written to the post (`versions.de.prompt`). */
  promptVersion?: string;
  /** Model ID from tenant/app config (ADR 004). */
  model?: string;
  /** API key from the secret store; ignored when `client` is given. */
  apiKey?: string;
  client?: ParseClient;
}

/**
 * Translator port backed by the Anthropic API (ADR 004): one call, versioned
 * prompt, structured output. Supports uk -> de with the humanizer prompt.
 */
export class ClaudeTranslator implements Translator {
  readonly model: string;
  readonly promptVersion: string;
  readonly #systemPrompt: string;
  readonly #client: ParseClient;

  constructor(options: ClaudeTranslatorOptions) {
    this.model = options.model ?? DEFAULT_MODEL;
    this.promptVersion = options.promptVersion ?? DEFAULT_PROMPT_VERSION;
    this.#systemPrompt = options.systemPrompt;
    this.#client =
      options.client ??
      (new Anthropic({ apiKey: options.apiKey, maxRetries: 2 }) as unknown as ParseClient);
  }

  async translate(request: TranslationRequest): Promise<TranslationResult> {
    if (request.text.trim() === '') {
      throw new TranslationError('empty-input', 'translate: text is empty');
    }
    if (request.sourceLang !== 'uk' || request.targetLang !== 'de') {
      throw new TranslationError(
        'unsupported-pair',
        `translate: ${request.sourceLang} -> ${request.targetLang} is not supported by ${this.promptVersion}`,
      );
    }

    let response;
    try {
      response = await this.#client.messages.parse({
        model: this.model,
        max_tokens: 16000,
        // Thinking is always on for this model; effort is the only control.
        output_config: { effort: 'medium', format: zodOutputFormat(outputSchema) },
        system: this.#systemPrompt,
        messages: [{ role: 'user', content: `<post>\n${request.text}\n</post>` }],
      });
    } catch (error) {
      throw toTranslationError(error);
    }

    if (response.stop_reason === 'refusal') {
      throw new TranslationError('refused', 'model refused to translate the post');
    }
    if (response.stop_reason === 'max_tokens') {
      throw new TranslationError('truncated', 'translation hit max_tokens');
    }
    const parsed = response.parsed_output;
    if (!parsed || parsed.text.trim() === '') {
      throw new TranslationError('invalid-output', 'model returned no usable translation');
    }
    const notes = parsed.notes.trim();
    return notes === '' ? { text: parsed.text.trim() } : { text: parsed.text.trim(), notes };
  }
}

function toTranslationError(error: unknown): TranslationError {
  if (error instanceof TranslationError) return error;
  if (error instanceof Anthropic.RateLimitError) {
    return new TranslationError('rate-limited', 'Anthropic API rate limit', { cause: error });
  }
  if (error instanceof Anthropic.APIError) {
    // Message only: never include headers or request data (API key).
    return new TranslationError('api-error', `Anthropic API error ${error.status ?? ''}`.trim(), {
      cause: error,
    });
  }
  return new TranslationError(
    'api-error',
    `translation call failed: ${error instanceof Error ? error.message : String(error)}`,
    { cause: error },
  );
}
