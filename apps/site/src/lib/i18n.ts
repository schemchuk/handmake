/** UI strings per language. A tenant language without an entry here fails the build. */
export interface UiStrings {
  skip: string;
  navCircle: string;
  postsHeading: string;
  noPosts: string;
  back: string;
  when: string;
  where: string;
  join: string;
  every: (weekday: string) => string;
  oClock: (time: string) => string;
  aiAssisted: string;
  aiGenerated: string;
  language: string;
}

const strings: Record<string, UiStrings> = {
  de: {
    skip: 'Zum Inhalt springen',
    navCircle: 'Kreis',
    postsHeading: 'Beiträge',
    noPosts: 'Noch keine Beiträge.',
    back: 'Alle Beiträge',
    when: 'Wann',
    where: 'Wo',
    join: 'Zum Telegram-Kanal',
    every: (weekday) => `Jeden ${weekday}`,
    oClock: (time) => `${time} Uhr`,
    aiAssisted: 'Mit KI-Unterstützung erstellt',
    aiGenerated: 'Von KI erstellt',
    language: 'Sprache',
  },
  uk: {
    skip: 'Перейти до вмісту',
    navCircle: 'Гурток',
    postsHeading: 'Дописи',
    noPosts: 'Поки що немає дописів.',
    back: 'Усі дописи',
    when: 'Коли',
    where: 'Де',
    join: 'До Telegram-каналу',
    every: (weekday) => `Щотижня, ${weekday}`,
    oClock: (time) => `о ${time}`,
    aiAssisted: 'Створено за допомогою ШІ',
    aiGenerated: 'Створено ШІ',
    language: 'Мова',
  },
};

export function uiStrings(lang: string): UiStrings {
  const found = strings[lang];
  if (!found) {
    throw new Error(`no UI strings for language "${lang}" in apps/site/src/lib/i18n.ts`);
  }
  return found;
}

/** Native name of a language for the switcher. */
export function languageName(lang: string): string {
  return new Intl.DisplayNames([lang], { type: 'language' }).of(lang) ?? lang;
}
