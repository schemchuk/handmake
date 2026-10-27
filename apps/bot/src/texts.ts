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
    'Команди: /new — нова чернетка, /done — перекласти й переглянути, /discard — видалити чернетку.',
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
  photoUnderReadyText:
    'Ця чернетка вже готова до публікації — це фото сюди не додам. ' +
    'Для нового допису спочатку опублікуй цей або відхили його (/discard).',
  unsupportedFileText: (fileName: string) =>
    `Файл «${fileName}» не підійде: я приймаю лише фото у форматах JPEG/PNG і текст. ` +
    `HEIC та інші формати конвертуй у JPEG (або надішли фото як зображення, не як файл).`,
  unsupportedMessageText: 'Поки що я приймаю лише текст і фото — голосове, відео та стікери ні.',
  unknownCommandText: 'Такої команди я не знаю. Команди: /new, /done, /discard.',

  // --- T15: translate, preview, edit, regenerate -----------------------------
  draftNoneText: 'Немає чернетки — надішли текст чи фото, або почни з /new.',
  draftFinishedText: 'Цю чернетку вже опубліковано. Нова — через /new або просто надішли текст.',
  draftBusyText: 'Зараз працюю з цією чернеткою — спробуй за хвилину.',
  doneNeedsText: 'У чернетці поки що немає тексту українською. Надішли його, а потім /done.',
  translatingText: '⏳ Перекладаю німецькою…',
  translateInProgressText: '⏳ Переклад уже йде — за хвилину буде готовий.',
  translationFailedText:
    'Не вийшло перекласти німецькою 😔 Спробуй ще раз /done, або надішли свій німецький текст — ' +
    'я збережу його як є.',
  deSavedText: 'Збережено твій німецький текст. Ось як виглядатиме допис:',
  editPromptText: (lang: 'uk' | 'de', current: string) =>
    `Надішли новий текст ${lang === 'uk' ? 'українською' : 'німецькою'} — він повністю замінить поточний:\n\n${current}`,
  editPromptNewText: (lang: 'uk' | 'de') =>
    `Поточного тексту ${lang === 'uk' ? 'українською' : 'німецькою'} ще немає. ` +
    `Надішли його — я збережу як новий.`,
  editSavedText: (lang: 'uk' | 'de') =>
    `Збережено нову версію ${lang === 'uk' ? 'українською' : 'німецькою'}.`,
  editConflictText: 'Схоже, чернетку щойно змінено — почни з превʼю ще раз.',
  regenUnavailableText: 'Перекласти наново можна лише готову чернетку.',

  // --- T16: publish, face consent, dispatch -------------------------------------
  publishNotReadyText: 'Публікувати можна лише готову чернетку.',
  publishConsentText:
    'Перш ніж публікувати: чи впевнена ти, що на фото немає впізнаваних облич без письмової згоди? ' +
    'Руки й вироби — це саме те, що треба 🙂',
  publishConfirmButton: '✅ Облич немає — публікувати',
  publishCancelButton: '↩️ До перегляду',
  publishingText: '⏳ Публікую… Це займе кілька хвилин, результат прийде сюди повідомленням.',
  publishFailedText:
    'Не вийшло запустити публікацію 😔 Чернетка знову готова — натисни 🚀 ще раз, і я повторю.',

  // --- Preview message (built by preview.ts) ----------------------------------
  previewHeader: (photoCount: number) => `🧵 Перегляд допису (${photoCount} фото)`,
  previewUkLabel: (chars: number) => `🇺🇦 Українською (${chars} симв.):`,
  previewDeLabel: (chars: number) => `🇩🇪 Німецькою (${chars} симв.):`,
  previewDeMissing: '🇩🇪 Німецькою: ще немає.',
  previewTruncatedNote: '\n… (текст скорочено для перегляду)',
  previewCaptionSplitNote:
    'ℹ️ Український текст довший за 1024 символи — фото піде без підпису, а текст окремим повідомленням.',
  previewBlockedText: (error: string) =>
    `❌ Допис не проходить ліміти Telegram:\n${error}\n\nВиправ текст кнопками ✏️ нижче.`,
  editUkButton: '✏️ UA',
  editDeButton: '✏️ DE',
  regenDeButton: '🔁 DE',
  publishButton: '🚀 Опублікувати',
  discardButton: '🗑 Відхилити',
} as const;

export type BotTexts = typeof botTexts;
