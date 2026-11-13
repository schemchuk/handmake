/** Public authenticity labels for real handmade media (F36). */
export const authenticityLabels: Record<string, string> = {
  de: 'Originalarbeit',
  uk: 'Оригінальна робота',
  en: 'Original work',
};

export function appendAuthenticity(text: string, lang: string, hasPhotos: boolean): string {
  if (!hasPhotos || !text.trim()) return text;
  const label = authenticityLabels[lang];
  if (!label) return text;
  const hashtags = text.match(/(?:\s+)(#[^\s#]+(?:[ \t]+#[^\s#]+)*)\s*$/u);
  if (hashtags?.index !== undefined)
    return `${text.slice(0, hashtags.index).trimEnd()}\n\n${label}\n\n${hashtags[1]}`;
  return `${text}\n\n${label}`;
}
