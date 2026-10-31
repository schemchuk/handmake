import type { MeetingSchedule } from '@handmake/core';

import { uiStrings } from './i18n';

// 2024-01-01 was a Monday: a fixed reference to get localized weekday names.
const weekdayIndex = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 7,
} as const;

/** "Jeden Donnerstag, 14:00 Uhr" / "Щотижня, четвер, о 14:00". */
export function formatMeeting(schedule: MeetingSchedule, lang: string): string {
  const ui = uiStrings(lang);
  const day = new Date(Date.UTC(2024, 0, weekdayIndex[schedule.weekday]));
  const weekday = new Intl.DateTimeFormat(lang, { weekday: 'long', timeZone: 'UTC' }).format(day);
  return `${ui.every(weekday)}, ${ui.oClock(schedule.time)}`;
}
