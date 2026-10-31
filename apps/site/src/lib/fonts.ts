import cyrillic from '@fontsource-variable/onest/files/onest-cyrillic-wght-normal.woff2?url';
import cyrillicExt from '@fontsource-variable/onest/files/onest-cyrillic-ext-wght-normal.woff2?url';
import latin from '@fontsource-variable/familjen-grotesk/files/familjen-grotesk-latin-wght-normal.woff2?url';
import latinExt from '@fontsource-variable/familjen-grotesk/files/familjen-grotesk-latin-ext-wght-normal.woff2?url';

/**
 * Self-hosted fonts (no third-party font CDN, GDPR). Familjen Grotesk has no Cyrillic,
 * so Ukrainian text falls back per glyph to Onest, which is metrically close enough
 * at the weights the site uses.
 */
const latinRange =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const latinExtRange =
  'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';
const cyrillicRange = 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116';
const cyrillicExtRange = 'U+0460-052F,U+1C80-1C8A,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F';

function face(family: string, url: string, range: string): string {
  return `@font-face{font-family:'${family}';font-style:normal;font-weight:100 900;font-display:swap;src:url(${url}) format('woff2');unicode-range:${range}}`;
}

export const bundledLatinFamily = 'Familjen Grotesk';

/** CSS for all bundled faces. */
export function fontFaceCss(): string {
  return [
    face(bundledLatinFamily, latin, latinRange),
    face(bundledLatinFamily, latinExt, latinExtRange),
    face('Onest', cyrillic, cyrillicRange),
    face('Onest', cyrillicExt, cyrillicExtRange),
  ].join('\n');
}

/** The tenant's configured family first; the bundled faces make it render even if it is not installed. */
export function fontStack(family: string): string {
  const names = [...new Set([family, bundledLatinFamily, 'Onest'])];
  return `${names.map((name) => `'${name}'`).join(',')},system-ui,sans-serif`;
}
