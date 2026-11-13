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
