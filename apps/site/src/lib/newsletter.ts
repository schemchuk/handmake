/** The sole approved external resource, only as a POST form action. */
export const newsletterFormAction =
  'https://d2c04417.sibforms.com/serve/MUIFANZ2KTD7DrH6FXtIYdhL5lv5Olz9vYwkGcbbejUlT3kvUGgNAa1blz-Ef3XyHWmKhmMuREDoIiIxKbgOTvs-gUrwVf4OBvzgEqt-xkWV9qe7STw7XoOD6a1U35HlsyDKyfJtw42ynwHCwVgJZ-06SGnjWR8KPPuufg3f7xh8hHSFOUXChnorbAdKAWgqFsU3NtEuLHAubfFHew==';

export function newsletterStrings(lang: string) {
  return lang === 'uk'
    ? {
        title: 'Безкоштовна схема вишивки',
        intro:
          'Підпишіться на розсилку Faden und Stimmung та отримайте схему троянди у PDF німецькою мовою.',
        contents:
          'У розсилці: безкоштовні схеми, нові роботи авторки, зустрічі й акції гуртка та іноді пропозиції її виробів.',
        email: 'Електронна пошта',
        submit: 'Підписатися та отримати схему',
        consent:
          'Підписуючись, ви погоджуєтеся отримувати розсилку. Відписатися можна будь-коли за посиланням у листі.',
        delivery:
          'Після надсилання форми підтвердьте підписку за посиланням у листі німецькою мовою. Потім відкриється сторінка завантаження.',
        privacy: 'Політика конфіденційності',
        gift: 'Схема троянди',
        download: 'Завантажити PDF німецькою (2 сторінки)',
      }
    : {
        title: 'Kostenlose Stickvorlage',
        intro:
          'Abonniere den Newsletter von Faden und Stimmung und erhalte die Rosenblüte als PDF.',
        contents:
          'Im Newsletter: kostenlose Stickvorlagen, neue Handarbeiten der Autorin, Termine und Aktionen des Kreises sowie gelegentlich Angebote zu ihren Werken.',
        email: 'E-Mail-Adresse',
        submit: 'Anmelden und Stickvorlage erhalten',
        consent:
          'Mit der Anmeldung willigst du in den Newsletter ein. Du kannst dich jederzeit über den Link in jeder E-Mail abmelden.',
        delivery:
          'Bestätige nach dem Absenden deine Anmeldung über den Link in der E-Mail. Danach öffnet sich die Download-Seite.',
        privacy: 'Datenschutzerklärung',
        gift: 'Rosenblüte als Stickvorlage',
        download: 'PDF herunterladen (Deutsch, 2 Seiten)',
      };
}
