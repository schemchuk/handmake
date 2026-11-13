/** UI strings per language. A tenant language without an entry here fails the build. */
export interface UiStrings {
  showsHeading: string;
  noShows: string;
  authenticityLabel: string;
  skip: string;
  worksHeading: string;
  collectionsHeading: string;
  noWorks: string;
  descriptionLabel: string;
  navCircle: string;
  postsHeading: string;
  noPosts: string;
  back: string;
  when: string;
  where: string;
  join: string;
  joinChannel: string;
  groupHeading: string;
  groupText: string;
  joinGroup: string;
  every: (weekday: string) => string;
  oClock: (time: string) => string;
  aiAssisted: string;
  aiGenerated: string;
  language: string;
  profiles: string;
}

const strings: Record<string, UiStrings> = {
  de: {
    showsHeading: 'Shows',
    noShows: 'Noch keine Shows.',
    authenticityLabel: 'Originalarbeit',
    skip: 'Zum Inhalt springen',
    worksHeading: 'Arbeiten',
    collectionsHeading: 'Kollektionen',
    noWorks: 'Noch keine Arbeiten.',
    descriptionLabel: 'Beschreibung',
    navCircle: 'Kreis',
    postsHeading: 'Beiträge',
    noPosts: 'Noch keine Beiträge.',
    back: 'Alle Beiträge',
    when: 'Wann',
    where: 'Wo',
    join: 'Zum Telegram-Kanal',
    joinChannel: 'Telegram-Kanal abonnieren',
    groupHeading: 'Austauschgruppe',
    groupText:
      'Unserem Kanal ist eine Gruppe angehängt: Dort zeigst du deine eigenen Handarbeiten — als Foto mit einem kurzen Text — und dort erscheinen die Kommentare unter den Beiträgen des Kanals. Beim Posten gelten die Regeln der Gruppe.',
    joinGroup: 'Zur Austauschgruppe',
    every: (weekday) => `Jeden ${weekday}`,
    oClock: (time) => `${time} Uhr`,
    aiAssisted: 'Mit KI-Unterstützung erstellt',
    aiGenerated: 'Von KI erstellt',
    language: 'Sprache',
    profiles: 'Social-Media-Profile',
  },
  uk: {
    showsHeading: 'Покази',
    noShows: 'Поки що немає показів.',
    authenticityLabel: 'Оригінальна робота',
    skip: 'Перейти до вмісту',
    worksHeading: 'Роботи',
    collectionsHeading: 'Колекції',
    noWorks: 'Поки що немає робіт.',
    descriptionLabel: 'Опис',
    navCircle: 'Гурток',
    postsHeading: 'Дописи',
    noPosts: 'Поки що немає дописів.',
    back: 'Усі дописи',
    when: 'Коли',
    where: 'Де',
    join: 'До Telegram-каналу',
    joinChannel: 'Підписатися на Telegram-канал',
    groupHeading: 'Група для обміну',
    groupText:
      "До нашого каналу приєднано групу: там ти показуєш власні роботи — фото з коротким текстом — і там з'являються коментарі під дописами каналу. Публікуючи, ти дотримуєшся правил групи.",
    joinGroup: 'До групи',
    every: (weekday) => `Щотижня, ${weekday}`,
    oClock: (time) => `о ${time}`,
    aiAssisted: 'Створено за допомогою ШІ',
    aiGenerated: 'Створено ШІ',
    language: 'Мова',
    profiles: 'Профілі в соцмережах',
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
