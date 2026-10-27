/**
 * User-facing bot strings, in one place so the language can be adjusted or
 * i18n'd later without touching the handlers. Author-facing texts are
 * Ukrainian (the author writes in UA/DE); the refusal is German because a
 * stranger at the door is most likely a German speaker.
 */
export const botTexts = {
  startText:
    'Привіт! Я — бот «Faden und Stimmung». ' +
    'Незабаром тут можна буде писати дописи, додавати фото та публікувати їх у канал. ' +
    'Зараз я лише перевіряю, що все працює.',
  refusalText: 'Hallo! Dieser Bot ist privat und nur für freigeschaltete Nutzer verfügbar.',
} as const;
