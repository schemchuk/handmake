import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

import { contentSlugSchema, workKindSchema } from '@handmake/core';
import type {
  GeneratedWorkText,
  TextGenerationRequest,
  TextGenerationResult,
  TextGenerator,
  Translator,
} from '@handmake/core';

import { DEFAULT_TIMEOUT_MS } from './claude-translator';
import { describeWorkUkPromptV1, WORK_PROMPT_VERSION } from './work-prompt';

export interface TextGenerationClient {
  messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
  };
}
export interface ClaudeTextGeneratorOptions {
  model: string;
  apiKey?: string;
  client?: TextGenerationClient;
  translation: { translator: Translator; model: string; promptVersion: string };
  /** Required: a generated work never silently succeeds without confirmed accounting. */
  onUsage: (usage: Anthropic.Usage, responseId: string) => Promise<void>;
}
const nonblank = z.string().refine((value) => value.trim().length > 0);
const requestSchema = z
  .object({
    note: nonblank,
    kind: workKindSchema,
    collection: contentSlugSchema,
    context: nonblank.optional(),
  })
  .strict();
const outputSchema = z.object({ text: z.string(), notes: z.string() }).strict();

/** Two editable language drafts; approval/publishing is deliberately outside this adapter. */
export class ClaudeTextGenerator implements TextGenerator {
  readonly #client: TextGenerationClient;
  constructor(private readonly options: ClaudeTextGeneratorOptions) {
    this.#client =
      options.client ??
      new Anthropic({
        apiKey: options.apiKey,
        maxRetries: 2,
        timeout: DEFAULT_TIMEOUT_MS,
      });
  }

  async generateUkrainian(request: TextGenerationRequest): Promise<GeneratedWorkText> {
    const input = requestSchema.parse(request);
    // create() preserves usage before local output validation, including malformed JSON.
    const response = await this.#client.messages.create({
      model: this.options.model,
      max_tokens: 16000,
      output_config: { effort: 'medium', format: zodOutputFormat(outputSchema) },
      system: describeWorkUkPromptV1,
      messages: [{ role: 'user', content: JSON.stringify(input) }],
    });
    if (!response.usage || !response.id) throw new Error('work generation usage is unavailable');
    await this.options.onUsage(response.usage, response.id);
    if (response.stop_reason !== 'end_turn') {
      throw new Error(`work generation did not complete: ${response.stop_reason}`);
    }
    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');
    const draft = outputSchema.parse(JSON.parse(text));
    if (!draft.text.trim()) throw new Error('work generation returned empty text');
    return {
      version: {
        description: draft.text,
        provenance: 'ai-assisted',
        model: this.options.model,
        prompt: WORK_PROMPT_VERSION,
      },
      notes: draft.notes,
    };
  }

  async translateUkrainian(text: string): Promise<GeneratedWorkText> {
    nonblank.parse(text);
    const de = await this.options.translation.translator.translate({
      text,
      sourceLang: 'uk',
      targetLang: 'de',
      promptVersion: this.options.translation.promptVersion,
    });
    if (!de.text.trim()) throw new Error('work translation returned empty text');
    return {
      version: {
        description: de.text,
        provenance: 'ai-assisted',
        model: this.options.translation.model,
        prompt: this.options.translation.promptVersion,
      },
      notes: de.notes ?? '',
    };
  }

  async generate(request: TextGenerationRequest): Promise<TextGenerationResult> {
    const uk = await this.generateUkrainian(request);
    const de = await this.translateUkrainian(uk.version.description);
    return { versions: { uk: uk.version, de: de.version }, notes: { uk: uk.notes, de: de.notes } };
  }
}
