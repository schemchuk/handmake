import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

import type { CommentDraft, CommentDraftRequest, CommentDrafter } from '@handmake/core';

import { COMMENT_REPLY_PROMPT_VERSION, commentReplyPromptV1 } from './comment-reply-prompt';
import { DEFAULT_TIMEOUT_MS } from './claude-translator';

const nonblank = z.string().refine((value) => value.trim().length > 0);
const requestSchema = z
  .object({
    network: z.enum(['instagram', 'facebook']),
    handle: z.string(),
    text: nonblank,
    postId: nonblank,
  })
  .strict();
const outputSchema = z
  .object({
    translation_uk: nonblank,
    reply_de: z.string(),
    notes_uk: z.string(),
  })
  .strict();

export interface ClaudeCommentDrafterOptions {
  /** Model ID from tenant config (the translation pricing block, ADR 004). */
  model: string;
  /** API key from the secret store; ignored when `client` is given. */
  apiKey?: string;
  client?: TextGenerationClient;
  /** Required: a drafted comment never silently succeeds without confirmed accounting. */
  onUsage: (usage: Anthropic.Usage, responseId: string) => Promise<void>;
}

/**
 * Comment drafter (F34, T49c1): one paid call producing the Ukrainian
 * translation, the German reply draft and a Ukrainian note for the author.
 * Mirrors ClaudeTextGenerator: usage is preserved before local output
 * validation (a malformed draft is still paid), `onUsage` is required, and
 * error messages never echo the request — the comment text and handle are
 * reader personal data.
 */
export class ClaudeCommentDrafter implements CommentDrafter {
  readonly #client: TextGenerationClient;

  constructor(private readonly options: ClaudeCommentDrafterOptions) {
    this.#client =
      options.client ??
      new Anthropic({
        apiKey: options.apiKey,
        maxRetries: 2,
        timeout: DEFAULT_TIMEOUT_MS,
      });
  }

  async draft(request: CommentDraftRequest): Promise<CommentDraft> {
    const input = requestSchema.parse(request);
    const response = await this.#client.messages.create({
      model: this.options.model,
      max_tokens: 4000,
      output_config: { effort: 'medium', format: zodOutputFormat(outputSchema) },
      system: commentReplyPromptV1,
      messages: [{ role: 'user', content: JSON.stringify(input) }],
    });
    if (!response.usage || !response.id) throw new Error('comment draft usage is unavailable');
    await this.options.onUsage(response.usage, response.id);
    if (response.stop_reason !== 'end_turn') {
      throw new Error(`comment draft did not complete: ${response.stop_reason}`);
    }
    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');
    const draft = outputSchema.parse(JSON.parse(text));
    return {
      translationUk: draft.translation_uk.trim(),
      replyDe: draft.reply_de.trim(),
      notesUk: draft.notes_uk.trim(),
    };
  }
}

export { COMMENT_REPLY_PROMPT_VERSION };

/** The one SDK call the drafter needs; tests pass a fake. */
export interface TextGenerationClient {
  messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
  };
}
