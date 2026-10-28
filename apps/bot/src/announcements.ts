import type { MeetingSchedule, WeeklyMoment } from '@handmake/core';

/**
 * F18 schedule math and template rendering for the meeting announcement and
 * reminder (T20). Pure functions, tested against Europe/Berlin wall time
 * including the DST transitions. The bot cron asks "did this weekly moment
 * just fire?" and "which meeting does it refer to?"; the answers must be the
 * same no matter which of the overlapping 15-minute cron ticks computes them.
 */

/** How long after a weekly moment a cron tick still picks it up. The cron
 * runs every 15 min; the window tolerates one fully missed tick so a hiccup
 * never silently drops an announcement. Duplicates inside the window are
 * impossible by construction: the draft id is deterministic per meeting. */
export const announcementWindowMs = 45 * 60 * 1000;

const weekdayIndex: Record<WeeklyMoment['weekday'], number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 0,
};

const ukWeekdays = ['неділя', 'понеділок', 'вівторок', 'середа', 'четвер', 'пʼятниця', 'субота'];
const ukMonthsGenitive = [
  'січня',
  'лютого',
  'березня',
  'квітня',
  'травня',
  'червня',
  'липня',
  'серпня',
  'вересня',
  'жовтня',
  'листопада',
  'грудня',
];

/** Minutes the timezone is ahead of UTC at `instant` (via Intl, DST-aware). */
export function timeZoneOffsetMinutes(timeZone: string, instant: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts: Record<string, string> = {};
  for (const part of dtf.formatToParts(instant)) {
    if (part.type !== 'literal') {
      parts[part.type] = part.value;
    }
  }
  const asUtc = Date.UTC(
    Number(parts['year']),
    Number(parts['month']) - 1,
    Number(parts['day']),
    Number(parts['hour']),
    Number(parts['minute']),
    Number(parts['second']),
  );
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/**
 * Interprets `wall`'s UTC fields as a wall clock reading in `timeZone` and
 * returns the corresponding instant. One refinement pass: the offset at the
 * guessed instant can differ from the offset at the wall reading itself
 * across a DST transition (the date-fns-tz algorithm).
 */
export function zonedTimeToUtc(wall: Date, timeZone: string): Date {
  const wallMs = Date.UTC(
    wall.getUTCFullYear(),
    wall.getUTCMonth(),
    wall.getUTCDate(),
    wall.getUTCHours(),
    wall.getUTCMinutes(),
  );
  let offset = timeZoneOffsetMinutes(timeZone, new Date(wallMs));
  const guess = new Date(wallMs - offset * 60000);
  const refined = timeZoneOffsetMinutes(timeZone, guess);
  if (refined !== offset) {
    offset = refined;
  }
  return new Date(wallMs - offset * 60000);
}

/** Y/M/D of `instant` in `timeZone`, returned as a Date whose UTC fields
 * carry them (a "local date" for iteration only — not an instant). */
function wallDay(instant: Date, timeZone: string): Date {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts: Record<string, string> = {};
  for (const part of dtf.formatToParts(instant)) {
    if (part.type !== 'literal') {
      parts[part.type] = part.value;
    }
  }
  return new Date(
    Date.UTC(Number(parts['year']), Number(parts['month']) - 1, Number(parts['day'])),
  );
}

function addDays(day: Date, days: number): Date {
  return new Date(day.getTime() + days * 24 * 60 * 60 * 1000);
}

function momentInstant(moment: WeeklyMoment, day: Date, timeZone: string): Date {
  const [hours, minutes] = moment.time.split(':').map(Number);
  const wall = new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hours!, minutes!),
  );
  return zonedTimeToUtc(wall, timeZone);
}

/**
 * The most recent firing of `moment` within `windowMs` before `now`, or
 * undefined. Because the window is far shorter than a week, checking the
 * local days spanned by [now - window, now] covers every candidate.
 */
export function latestOccurrenceInWindow(
  moment: WeeklyMoment,
  now: Date,
  windowMs: number,
  timeZone: string,
): Date | undefined {
  const start = new Date(now.getTime() - windowMs);
  let candidate: Date | undefined;
  for (
    let day = wallDay(start, timeZone);
    day.getTime() <= wallDay(now, timeZone).getTime();
    day = addDays(day, 1)
  ) {
    if (day.getUTCDay() !== weekdayIndex[moment.weekday]) {
      continue;
    }
    const instant = momentInstant(moment, day, timeZone);
    if (
      instant.getTime() > start.getTime() &&
      instant.getTime() <= now.getTime() &&
      (candidate === undefined || instant.getTime() > candidate.getTime())
    ) {
      candidate = instant;
    }
  }
  return candidate;
}

/**
 * The next meeting strictly after `after`, per the tenant's meeting schedule.
 * A reminder fires on the meeting day before the meeting time, so the meeting
 * it refers to can be same-day; an announcement always refers to a future
 * one. Checks at most eight local days.
 */
export function nextMeetingAfter(schedule: MeetingSchedule, after: Date, timeZone: string): Date {
  const wanted = weekdayIndex[schedule.weekday];
  const [hours, minutes] = schedule.time.split(':').map(Number);
  for (let i = 0; i <= 7; i++) {
    const day = addDays(wallDay(after, timeZone), i);
    if (day.getUTCDay() !== wanted) {
      continue;
    }
    const wall = new Date(
      Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hours!, minutes!),
    );
    const instant = zonedTimeToUtc(wall, timeZone);
    if (instant.getTime() > after.getTime()) {
      return instant;
    }
  }
  throw new Error('no meeting found within 8 days of the schedule; check tenant config');
}

/** The meeting's calendar day in its timezone, as YYYY-MM-DD — the unique
 * key: one announcement and one reminder draft exist per meeting day. */
export function meetingDayKey(meeting: Date, timeZone: string): string {
  const day = wallDay(meeting, timeZone);
  const y = day.getUTCFullYear();
  const m = String(day.getUTCMonth() + 1).padStart(2, '0');
  const d = String(day.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Fills the Ukrainian template placeholders with the meeting in its timezone:
 * {weekday} («четвер»), {date} («29 жовтня»), {time} («14:00»). The German
 * version is produced later by the translator, which localizes the date the
 * same way it does for hand-written Ukrainian texts.
 */
export function renderTemplate(template: string, meeting: Date, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts: Record<string, string> = {};
  for (const part of dtf.formatToParts(meeting)) {
    if (part.type !== 'literal') {
      parts[part.type] = part.value;
    }
  }
  const englishWeekdays = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
  ];
  const weekday = ukWeekdays[englishWeekdays.indexOf(parts['weekday']!.toLowerCase())]!;
  const day = wallDay(meeting, timeZone);
  const date = `${day.getUTCDate()} ${ukMonthsGenitive[day.getUTCMonth()]}`;
  const time = `${parts['hour']}:${parts['minute']}`;
  return template
    .replaceAll('{weekday}', weekday)
    .replaceAll('{date}', date)
    .replaceAll('{time}', time);
}
