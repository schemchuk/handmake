/** Contest weeks are identified by their Monday's local calendar date, not an ISO week number. */
export function contestWeek(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid contest date');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const local = new Date(Date.UTC(part('year'), part('month') - 1, part('day')));
  local.setUTCDate(local.getUTCDate() - ((local.getUTCDay() + 6) % 7));
  return local.toISOString().slice(0, 10);
}

export interface ContestSubmission {
  entryId: string;
  tenantId: string;
  week: string;
  /** Opaque media reference; resolved by the runtime's MediaSource. */
  photoRef: string;
  createdAt: string;
}
