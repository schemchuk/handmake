import { authenticityLabels } from './authenticity';

/**
 * The AI disclosure line appended to every show caption/description
 * (F30, ADR 015): every generated image is labelled on the site and on
 * every channel. German always leads (the DACH audience); the Ukrainian
 * line carries the German phrase so mixed-language readers see it too.
 */
export const showDisclosures = {
  de: `KI-generiertes Model\n${authenticityLabels.de}`,
  uk: `Модель згенерована ШІ (KI-generiertes Model)\n${authenticityLabels.uk}`,
  en: `AI-generated model\n${authenticityLabels.en}`,
} as const;

/** Preserve legacy captions when no authentic photos precede generated images. */
export function showDisclosure(lang: string, authenticPhotos: number): string | undefined {
  const disclosure = showDisclosures[lang as keyof typeof showDisclosures];
  if (!disclosure || !authenticPhotos) return disclosure;
  const first = authenticPhotos + 1;
  const lines: Record<string, string> = {
    de: `KI-generierte Bilder ab Bild ${first}`,
    uk: `Згенеровані ШІ кадри з кадру ${first}`,
    en: `AI-generated images from image ${first}`,
  };
  return `${disclosure}\n${lines[lang]}`;
}
