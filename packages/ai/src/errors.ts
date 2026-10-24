export type TranslationErrorCode =
  | 'empty-input'
  | 'unsupported-pair'
  | 'refused'
  | 'truncated'
  | 'invalid-output'
  | 'rate-limited'
  | 'api-error';

/**
 * Typed failure the bot can show to the author (F7): `userMessage` is safe
 * to display (Ukrainian, no internals); `message` is for logs.
 */
export class TranslationError extends Error {
  readonly code: TranslationErrorCode;
  readonly userMessage: string;

  constructor(code: TranslationErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'TranslationError';
    this.code = code;
    this.userMessage = USER_MESSAGES[code];
  }
}

const RETRY = 'Спробуйте ще раз або напишіть німецький текст самі.';

const USER_MESSAGES: Record<TranslationErrorCode, string> = {
  'empty-input': 'Текст порожній, нічого перекладати.',
  'unsupported-pair': 'Ця пара мов поки не підтримується.',
  refused: `Модель відмовилась перекладати цей текст. ${RETRY}`,
  truncated: `Переклад вийшов обірваним. ${RETRY}`,
  'invalid-output': `Не вдалося розібрати відповідь моделі. ${RETRY}`,
  'rate-limited': `Сервіс перекладу зараз перевантажений. ${RETRY}`,
  'api-error': `Сервіс перекладу тимчасово недоступний. ${RETRY}`,
};
