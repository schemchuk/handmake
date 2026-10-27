/**
 * User-facing bot strings, in one place so the language can be adjusted or
 * i18n'd later without touching the handlers. Author-facing texts are
 * Ukrainian (the author writes in UA/DE); the refusal is German because a
 * stranger at the door is most likely a German speaker.
 */
export const botTexts = {
  startText:
    'Привіт! Я — бот «Faden und Stimmung». ' +
    'Надсилай текст і фото — я складу з них чернетку допису, а далі перекладу й покажу, що вийде. ' +
    'Команди: /new — нова чернетка, /discard — видалити чернетку.',
  refusalText: 'Hallo! Dieser Bot ist privat und nur für freigeschaltete Nutzer verfügbar.',

  draftCreatedText: (photoCount: number) =>
    `Чернетку створено. Надсилай текст і фото — все зберігатиметься сюди. ` +
    `Фото: ${photoCount}/10. /discard — видалити чернетку.`,
  draftExistsText: (photoCount: number) =>
    `У тебе вже є відкрита чернетка (фото: ${photoCount}/10). ` +
    `Продовжуй додавати, або /discard — видалити й почати заново.`,
  discardDoneText: 'Чернетку видалено.',
  discardNothingText: 'Немає відкритої чернетки — нічого видаляти.',
  textSavedText: (photoCount: number) => `Збережено. Фото в чернетці: ${photoCount}/10.`,
  photoSavedText: (photoCount: number) => `Фото ${photoCount}/10 збережено.`,
  photoLimitText: (maxPhotos: number) =>
    `У чернетці вже максимум ${maxPhotos} фото — це не додам. ` +
    `Опублікуй цей набір, або /discard і почни нову чернетку.`,
  unsupportedFileText: (fileName: string) =>
    `Файл «${fileName}» не підійде: я приймаю лише фото у форматах JPEG/PNG і текст. ` +
    `HEIC та інші формати конвертуй у JPEG (або надішли фото як зображення, не як файл).`,
  unsupportedMessageText: 'Поки що я приймаю лише текст і фото — голосове, відео та стікери ні.',
  unknownCommandText: 'Такої команди я не знаю. Команди: /new, /discard.',
} as const;

export type BotTexts = typeof botTexts;
