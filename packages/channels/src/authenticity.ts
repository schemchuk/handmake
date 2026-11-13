/** Public authenticity labels for real handmade media (F36). */
export const authenticityLabels: Record<string, string> = {
  de: 'Originalarbeit',
  uk: 'Оригінальна робота',
  en: 'Original work',
};

export function appendAuthenticity(text: string, lang: string, hasPhotos: boolean): string {
  if (!hasPhotos || !text.trim()) return text;
  const label = authenticityLabels[lang];
  if (!label) throw new Error(`unsupported authenticity label language: ${lang}`);
  return `${text}\n\n${label}`;
}
