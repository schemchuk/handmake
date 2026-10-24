export const packageName = '@handmake/ai';
export { ClaudeTranslator, DEFAULT_MODEL, DEFAULT_PROMPT_VERSION } from './claude-translator';
export type { ClaudeTranslatorOptions, ParseClient } from './claude-translator';
export { TranslationError } from './errors';
export type { TranslationErrorCode } from './errors';
export { loadPrompt } from './prompts';
