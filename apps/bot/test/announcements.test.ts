import { describe, expect, it } from 'vitest';

import {
  latestOccurrenceInWindow,
  meetingDayKey,
  nextMeetingAfter,
  renderTemplate,
  timeZoneOffsetMinutes,
  zonedTimeToUtc,
} from '../src/announcements';
import type { MeetingSchedule } from '@handmake/core';

const BERLIN = 'Europe/Berlin';

// The 2026 DST transitions around these fixtures: CEST (UTC+2) until
// 2026-10-25 03:00, CET (UTC+1) from 2026-10-25 03:00; and in spring CET
// until 2026-03-29 02:00, CEST from 03:00.
const meeting: MeetingSchedule = { weekday: 'thursday', time: '14:00', timezone: BERLIN };

describe('timeZoneOffsetMinutes', () => {
  it('reports CET in winter and CEST in summer', () => {
    expect(timeZoneOffsetMinutes(BERLIN, new Date('2026-01-15T12:00:00Z'))).toBe(60);
    expect(timeZoneOffsetMinutes(BERLIN, new Date('2026-07-15T12:00:00Z'))).toBe(120);
  });
});

describe('zonedTimeToUtc', () => {
  it('maps a Berlin wall time to the correct instant in winter and summer', () => {
    // 14:00 on 2026-10-24 is CEST (summer time still).
    expect(zonedTimeToUtc(new Date('2026-10-24T14:00:00.000Z'), BERLIN).toISOString()).toBe(
      '2026-10-24T12:00:00.000Z',
    );
    // After the October transition the same wall time is one hour later UTC.
    expect(zonedTimeToUtc(new Date('2026-10-26T14:00:00.000Z'), BERLIN).toISOString()).toBe(
      '2026-10-26T13:00:00.000Z',
    );
  });
});

describe('latestOccurrenceInWindow', () => {
  const tuesday18 = { weekday: 'tuesday' as const, time: '18:00' };

  it('finds the occurrence that just fired', () => {
    // 2026-10-27 17:05Z = 18:05 Berlin (CET).
    const now = new Date('2026-10-27T17:05:00.000Z');
    const found = latestOccurrenceInWindow(tuesday18, now, 45 * 60 * 1000, BERLIN);
    expect(found?.toISOString()).toBe('2026-10-27T17:00:00.000Z');
  });

  it('finds nothing before the moment and nothing after the window', () => {
    const justBefore = new Date('2026-10-27T16:59:59.000Z');
    expect(latestOccurrenceInWindow(tuesday18, justBefore, 45 * 60 * 1000, BERLIN)).toBeUndefined();
    // 19:00Z is two hours after the 17:00Z occurrence — outside 45 minutes.
    const tooLate = new Date('2026-10-27T19:00:00.000Z');
    expect(latestOccurrenceInWindow(tuesday18, tooLate, 45 * 60 * 1000, BERLIN)).toBeUndefined();
  });

  it('tracks the DST change: the same wall time shifts one hour in UTC', () => {
    // Last CEST Tuesday: 18:00 Berlin = 16:00Z.
    const summerNow = new Date('2026-10-20T16:05:00.000Z');
    expect(
      latestOccurrenceInWindow(tuesday18, summerNow, 45 * 60 * 1000, BERLIN)?.toISOString(),
    ).toBe('2026-10-20T16:00:00.000Z');
    // First CET Tuesday: 18:00 Berlin = 17:00Z.
    const winterNow = new Date('2026-10-27T17:05:00.000Z');
    expect(
      latestOccurrenceInWindow(tuesday18, winterNow, 45 * 60 * 1000, BERLIN)?.toISOString(),
    ).toBe('2026-10-27T17:00:00.000Z');
  });

  it('handles a moment on the transition Sunday itself', () => {
    // 2026-10-25 14:00 Berlin = 13:00Z (CET already, the 03:00 transition passed).
    const sunday14 = { weekday: 'sunday' as const, time: '14:00' };
    const now = new Date('2026-10-25T13:05:00.000Z');
    expect(latestOccurrenceInWindow(sunday14, now, 45 * 60 * 1000, BERLIN)?.toISOString()).toBe(
      '2026-10-25T13:00:00.000Z',
    );
  });
});

describe('nextMeetingAfter', () => {
  it('resolves an announcement on Tuesday to the Thursday meeting', () => {
    const tuesdayAnnouncement = new Date('2026-10-27T17:00:00.000Z');
    expect(nextMeetingAfter(meeting, tuesdayAnnouncement, BERLIN).toISOString()).toBe(
      '2026-10-29T13:00:00.000Z',
    );
  });

  it('resolves a same-day reminder to the meeting later that day', () => {
    const thursdayReminder = new Date('2026-10-29T09:00:00.000Z'); // 10:00 Berlin
    expect(nextMeetingAfter(meeting, thursdayReminder, BERLIN).toISOString()).toBe(
      '2026-10-29T13:00:00.000Z',
    );
  });

  it('skips to the next week once the meeting time has passed', () => {
    const atMeetingTime = new Date('2026-10-29T13:00:00.000Z');
    expect(nextMeetingAfter(meeting, atMeetingTime, BERLIN).toISOString()).toBe(
      '2026-11-05T13:00:00.000Z',
    );
  });

  it('stays on Europe/Berlin time across the DST transition', () => {
    const afterTransition = new Date('2026-10-25T13:00:00.000Z');
    expect(nextMeetingAfter(meeting, afterTransition, BERLIN).toISOString()).toBe(
      '2026-10-29T13:00:00.000Z',
    );
  });
});

describe('meetingDayKey', () => {
  it('is the meeting day in the tenant timezone', () => {
    expect(meetingDayKey(new Date('2026-10-29T13:00:00.000Z'), BERLIN)).toBe('2026-10-29');
  });
});

describe('renderTemplate', () => {
  const template = 'Зустріч — у {weekday}, {date} о {time}';

  it('fills all placeholders in Ukrainian', () => {
    const text = renderTemplate(template, new Date('2026-10-29T13:00:00.000Z'), BERLIN);
    expect(text).toBe('Зустріч — у четвер, 29 жовтня о 14:00');
  });

  it('uses the meeting wall time even though the instant is UTC noon', () => {
    // 13:00Z in summer is 14:00 in Berlin.
    const text = renderTemplate(template, new Date('2026-10-22T12:00:00.000Z'), BERLIN);
    expect(text).toBe('Зустріч — у четвер, 22 жовтня о 14:00');
  });

  it('renders winter meetings with CET wall time', () => {
    const text = renderTemplate(template, new Date('2026-01-08T13:00:00.000Z'), BERLIN);
    expect(text).toBe('Зустріч — у четвер, 8 січня о 14:00');
  });
});
