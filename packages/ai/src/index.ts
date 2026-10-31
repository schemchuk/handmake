export const packageName = '@handmake/ai';
export { ClaudeTranslator, DEFAULT_MODEL, DEFAULT_PROMPT_VERSION } from './claude-translator';
export type { ClaudeTranslatorOptions, MessageClient } from './claude-translator';
export { DEFAULT_TIMEOUT_MS } from './claude-translator';
export { TranslationError } from './errors';
export type { TranslationErrorCode } from './errors';
export { loadPrompt } from './prompts';
export { humanizeDePromptV1 } from './prompt-text';
