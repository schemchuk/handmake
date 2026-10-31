import { describe, expect, it } from 'vitest';

import { uiStrings } from '../src/lib/i18n';
import { formatMeeting } from '../src/lib/schedule';

const thursday = { weekday: 'thursday', time: '14:00', timezone: 'Europe/Berlin' } as const;

describe('formatMeeting', () => {
  it('formats the weekly meeting in German and Ukrainian', () => {
    expect(formatMeeting(thursday, 'de')).toBe('Jeden Donnerstag, 14:00 Uhr');
    expect(formatMeeting(thursday, 'uk')).toBe('Щотижня, четвер, о 14:00');
  });
});

describe('uiStrings', () => {
  it('fails loudly for a language without UI strings', () => {
    expect(() => uiStrings('fr')).toThrow(/no UI strings for language "fr"/);
  });
});
