/**
 * "2026-08-10" → "August 10, 2026". The column is a Postgres `date`, so it is
 * parsed and formatted in UTC to keep the calendar day from shifting with the
 * viewer's (or the edge runtime's) time zone.
 */
export function formatMeetingDate(isoDate: string | null): string | null {
  if (!isoDate) return null;
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(d);
}
