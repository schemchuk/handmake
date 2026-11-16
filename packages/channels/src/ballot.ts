import type { Post } from '@handmake/core';

/** Generated anonymous copy shared by Meta delivery and author previews. */
export function ballotCaption(post: Post, language: string): string {
  const intros: Record<string, string> = {
    uk: 'Роботи тижня. Напишіть у коментарі лише номер роботи звичайними цифрами (1, 2, …), без емодзі.',
    de: 'Werke der Woche. Schreibt nur die Nummer mit normalen Ziffern (1, 2, …) in einen Kommentar, ohne Emojis.',
  };
  const intro = intros[language];
  if (!intro) throw new Error('Unsupported ballot language');
  const label = language === 'uk' ? 'Робота №' : 'Werk Nr.';
  return `${intro}\n\n${post.photos.map((_, index) => `${label} ${index + 1}`).join('\n')}`;
}
