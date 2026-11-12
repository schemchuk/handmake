import { instagramCaptionLimit } from '@handmake/channels';
import type { FacebookSkip, InstagramSkip } from '@handmake/channels';

import type { AiBudget, AiCostLedger } from './ai-costs';

/**
 * User-facing bot strings, in one place so the language can be adjusted or
 * i18n'd later without touching the handlers. Author-facing texts are
 * Ukrainian (the author writes in UA/DE); the refusal is German because a
 * stranger at the door is most likely a German speaker.
 */
export const botTexts = {
  pollTooFewEntriesText: 'Цього тижня менше двох конкурсних робіт. Опитування не створено.',
  pollQuestionText: 'Яка робота тижня вам найбільше подобається?',
  pollDraftUkText:
    'Роботи тижня. Голосуйте за номер у Telegram або напишіть у коментарі лише номер роботи звичайними цифрами (1, 2, …), без емодзі.',
  pollDraftDeText:
    'Werke der Woche. Stimmt in Telegram ab oder schreibt nur die Nummer mit normalen Ziffern (1, 2, …) in einen Kommentar, ohne Emojis.',
  previewInvalidEntryText:
    'Некоректне посилання на конкурсну роботу. Виправ текст через редагування: посилання має вигляд {entry:ID}.',

  showRunReadyText: 'Результати готові. Онови перегляд, щоб перевірити та схвалити показ.',
  showRunPausedText:
    'Генерацію призупинено: платні виклики вимкнені. Ця відхилена спроба не спричинила списання. Збережені результати залишаються. «Продовжити генерацію» працюватиме після дозволу платних викликів.',
  showRunFailedText:
    'Запуск зупинився. Нових результатів поза збереженими немає; можливі незавершені витрати перевіряє оператор. «Продовжити генерацію» відновлює роботу зі збереженого стану.',
  showRecoveryReadyText: 'Перевірку збережених результатів завершено. Онови перегляд.',
  showRecoveryFailedText:
    'Перевірку збережених результатів зупинено. Повторення не допоможе без дії оператора. Звернися до оператора; нову генерацію не запускали.',

  showPreviewReadyText:
    'Онови перегляд, щоб побачити оригінали й готові результати. Для нового показу: /discard, потім /show.',
  showRetryButton: 'Продовжити генерацію',
  showPublishRetryButton: 'Повторити публікацію',
  showRegenerateButton: (slot: string) =>
    slot === 'video' ? 'Перегенерувати відео' : `Перегенерувати фото ${Number(slot.slice(6)) + 1}`,
  showRefreshButton: 'Оновити перегляд',
  showOriginalLabel: (index: number) => `Оригінал роботи ${index}`,
  showMarkedLabel: (slot: string) => `ШІ-результат: ${slot}. Порівняй із оригіналами роботи.`,
  showPreviewStatus: (missing: number) =>
    missing
      ? `Ще не готові або недоступні файли: ${missing}. Онови перегляд пізніше.`
      : 'Усі оригінали та марковані результати показано. Схвалення публікації ще недоступне.',
  showPreviewInterruptedText:
    'Перегляд перервано або результати змінились. /show — відкрити актуальний перегляд.',
  showUnavailableText: 'Покази вимкнені або налаштовані не повністю. Спробуй /show пізніше.',
  showSelectText: 'Обери опубліковану роботу для показу або додай нову:',
  showNewWorkButton: 'Нова робота',
  showNewWorkText:
    'Спочатку підготуй і схвали публікацію роботи через /work. Після публікації повернися до /show.',
  showAwaitingWorkText:
    'Роботу ще не опубліковано. Продовж через /work і схвали публікацію, потім повернися до /show.',
  showMissingWorkText:
    'Опубліковану роботу не знайдено. Спробуй /show пізніше або /discard і /show для нового вибору.',
  showSelectionErrorText: 'Вибір застарів або не зберігся. Спробуй /show ще раз.',
  showInputText: (count: number, template: string, model: string | undefined, ready: boolean) =>
    `Оригінали: ${count}/3 (потрібно 2–3). Формат: ${template}. Модель: ${model ?? 'не обрана'}.\n` +
    (ready
      ? 'Вхідні дані збережено. Генерацію ще не запущено.'
      : 'Надішли фото або використай фото роботи, обери формат і модель, потім збережи налаштування.'),
  showUseWorkPhotosButton: 'Використати фото роботи',
  showResetPhotosButton: 'Очистити фото й надіслати нові',
  showStartButton: 'Запустити генерацію',
  showStartText: 'План збережено. Можна повторити відправлення завдання генерації.',
  showStartingText: 'Готую приватні оригінали та завдання генерації…',
  showDispatchedText:
    'Завдання генерації передано. Результати готуються. /show — оновити перегляд.',
  showStartFailedText:
    'Підготовка або відправлення не завершились. /show — повторити без зміни плану.',
  showFinalizeButton: 'Зберегти налаштування',
  showPhotoBoundsText:
    'Для показу потрібно 2–3 оригінали. Зайві фото не додано. /show — налаштування.',
  showNeedsPersonaText: 'Для цього формату обери модель через /show.',
  showPhotoSavedText: (count: number) =>
    `Оригінал збережено (${count}/3). /show — продовжити налаштування.`,
  showContinueText:
    'Це сесія показу. /show — продовжити, /work — робота, /new — допис, /discard — видалити чернетку показу.',
  workUnavailableText: 'Роботи зараз недоступні. Спробуй /work пізніше.',
  workSetupText: 'Обери, як буде представлено роботу:',
  workKinds: { worn: 'На моделі', closeup: 'Крупний план', interior: 'В інтер’єрі' },
  workCollectionsText: 'Обери колекцію або створи нову:',
  workCreateButton: 'Нова колекція',
  workFormText: (languages: string[]) =>
    'Ці поля описують колекцію. Текст роботи береться з підпису до фото. Надішли одним повідомленням, кожне поле з нового рядка:\n' +
    languages.flatMap((lang) => [`Назва (${lang})`, `Опис (${lang})`]).join('\n'),
  workConfiguredText: 'Колекцію обрано. Додай фото та коротку нотатку про роботу, потім /done.',
  workSetupErrorText: 'Не вдалося обрати колекцію чи зберегти зміни. Спробуй /work ще раз.',
  workNeedsPhotosText: 'Додай фото роботи перед /done.',
  workGeneratingText: 'Готую опис роботи українською та німецькою…',
  workRetryText: 'Опис не завершено. /done — продовжити; /discard — видалити чернетку.',
  workUncertainText:
    'Результат попереднього виклику невідомий. Оператору потрібно перевірити витрати. /discard і /work — видалити цю чернетку та почати заново.',
  publishedText: (kind: 'post' | 'work' | 'show', url?: string) =>
    `${kind === 'work' ? 'Роботу' : kind === 'show' ? 'Показ' : 'Допис'} опубліковано.${url ? ` ${url}` : ''}`,
  workAnnounceOn: 'Повідомлення в канали: так',
  workAnnounceOff: 'Повідомлення в канали: ні',
  workPreview: (kind: string, title: string) => `Робота: ${kind}. Колекція: ${title}`,

  costUnavailableText: 'Облік витрат на ШІ не налаштовано.',
  costFailedText: 'Не вдалося отримати витрати на ШІ. Спробуй /cost пізніше.',
  costLimitText: 'Ліміт витрат на ШІ вичерпано. Нові покази доступні наступного місяця.',
  costTargetText: 'Досягнуто місячну ціль витрат на ШІ.',
  costReport: (summary: Awaited<ReturnType<AiCostLedger['summary']>>, budget: AiBudget) => {
    const eur = (n: number) => `${n.toFixed(4)} EUR`;
    const group = (rows: Record<string, number>) =>
      Object.entries(rows)
        .map(([key, n]) => `${key}: ${eur(n)}`)
        .join('\n') || '—';
    return (
      `ШІ · ${summary.month}\nВитрачено: ${eur(summary.total)}\n` +
      `До цілі: ${eur(Math.max(0, budget.monthlyTargetEur - summary.total))}\n` +
      `До ліміту: ${eur(Math.max(0, budget.monthlyTargetEur + budget.toleranceEur - summary.total))}\n` +
      `За сервісами:\n${group(summary.services)}\nЗа показами:\n${group(summary.shows)}`
    );
  },
  startText:
    'Привіт! Я — бот «Faden und Stimmung». ' +
    'Надсилай текст і фото — я складу з них чернетку допису, а далі перекладу й покажу, що вийде. ' +
    'Команди: /new — нова чернетка, /entry — конкурсна робота, /done — перекласти й переглянути, /discard — видалити чернетку.',
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
  unknownCommandText:
    'Такої команди я не знаю. Команди: /new, /entry, /work, /show, /done, /discard.',

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
  // Cron drafts live outside the author's chat session, so the /done retry
  // advice of translationFailedText does not apply to them (T25).
  cronTranslationFailedText:
    'Не вийшло перекласти автоматичний допис німецькою 😔 Його чернетка лишилася без перекладу ' +
    'і буде видалена автоматично. Якщо допис потрібен — надішли текст як звичайно.',
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
  publishInvalidText:
    'Не можу опублікувати цю чернетку: в ній бракує обовʼязкових даних (схоже на технічну помилку). ' +
    'Чернетка лишилася готовою — нічого не втрачено.',

  // --- Preview message (built by preview.ts) ----------------------------------
  previewHeader: (photoCount: number) => `🧵 Перегляд допису (${photoCount} фото)`,
  previewUkLabel: (chars: number) => `🇺🇦 Українською (${chars} симв.):`,
  previewDeLabel: (chars: number) => `🇩🇪 Німецькою (${chars} симв.):`,
  previewDeMissing: '🇩🇪 Німецькою: ще немає.',
  previewTruncatedNote: '\n… (текст скорочено для перегляду)',
  previewCaptionSplitNote:
    'ℹ️ Український текст довший за 1024 символи — фото піде без підпису, а текст окремим повідомленням.',
  previewInstagramHeader: (lang: string, chars: number) =>
    `📸 Instagram (${lang.toUpperCase()}, ${chars}/${instagramCaptionLimit}):`,
  previewInstagramWindow: (text: string) => `видно без «ще»: «${text}»`,
  previewInstagramSkip: (reason: InstagramSkip) =>
    ({
      'no-photos': '📸 Instagram: без фото дописи не приймає — цей туди не піде.',
      'not-site-worthy': '📸 Instagram: туди йдуть лише дописи для сайту — цей пропустимо.',
      'site-excluded': '📸 Instagram: тестовий допис у Instagram не піде.',
    })[reason],
  previewThreads: (chars: number, text: string) =>
    `🧵 Threads (${chars}/500 одиниць тексту; умлаути й емодзі займають кілька одиниць):\n${text}`,
  previewThreadsSkip: '🧵 Threads: цей допис не піде — тестовий або не для сайту.',
  previewFacebookHeader: (lang: string, chars: number) =>
    `📘 Facebook (${lang.toUpperCase()}, ${chars} симв.):`,
  previewFacebookLink: (url: string) => `посилання в підписі (клікабельне): ${url}`,
  previewFacebookSkip: (reason: FacebookSkip) =>
    ({
      'no-photos': '📘 Facebook: без фото дописи не приймає — цей туди не піде.',
      'not-site-worthy': '📘 Facebook: туди йдуть лише дописи для сайту — цей пропустимо.',
      'site-excluded': '📘 Facebook: тестовий допис у Facebook не піде.',
    })[reason],
  previewBlockedText: (error: string) =>
    `❌ Допис не проходить ліміти каналів:\n${error}\n\nВиправ текст кнопками ✏️ нижче.`,
  editUkButton: '✏️ UA',
  editDeButton: '✏️ DE',
  regenDeButton: '🔁 DE',
  publishButton: '🚀 Опублікувати',
  discardButton: '🗑 Відхилити',

  // --- T49c: comment inbox cards (F34) -----------------------------------------
  commentCardHeader: (network: string, handle: string) =>
    `💬 Новий коментар · ${network}${handle === '' ? '' : ` · від @${handle}`}`,
  commentCardCommentLabel: 'Коментар:',
  commentCardTranslationLabel: '🇺🇦 Переклад:',
  commentCardReplyLabel: '🇩🇪 Чернетка відповіді:',
  commentCardNoReply: 'без відповіді — див. нотатку нижче.',
  commentCardNotesLabel: '📝 Нотатка:',
  commentEditPrompt:
    'Надішліть нову німецьку відповідь протягом 30 хвилин. Збережемо перші 2200 символів.',
  commentUnavailable: 'Коментар недоступний для цієї дії або вже обробляється.',
  commentSkipped: 'Коментар пропущено.',
  commentSent: 'Відповідь надіслано.',
  commentReplyTooLong: (network: string) =>
    network === 'threads'
      ? 'Відповідь перевищує ліміт Threads: 500 байтів UTF-8. Скоротіть її перед надсиланням.'
      : 'Відповідь перевищує ліміт: 2200 символів. Скоротіть її перед надсиланням.',
  commentSendFailed:
    'Сервіс відхилив відповідь. Можна змінити текст або натиснути «Надіслати» ще раз.',
  commentSendUncertain:
    'Результат надсилання невідомий. Перевірте відповідь у соцмережі; бот не повторюватиме її автоматично.',
  commentSendReclaimed: 'Завислі надсилання закрито без повтору. Перевірте відповіді в соцмережах.',
  commentSendButton: '✅ Надіслати',
  commentEditButton: '✏️ Змінити',
  commentSkipButton: '↩️ Пропустити',
} as const;

export type BotTexts = typeof botTexts;
