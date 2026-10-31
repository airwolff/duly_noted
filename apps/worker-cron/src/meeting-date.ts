const MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
] as const;

// "August 10, 2026", "Aug. 10 2026", "Sept 8, 2026". Month names are matched
// on their first three letters, so any spelling that starts right works.
const TITLE_DATE_RE = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/;

// Board meetings happen in Maine, so a bare upload timestamp is read as a
// local calendar date there, not in UTC.
const MEETING_TIME_ZONE = 'America/New_York';

function isoDate(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return d.toISOString().slice(0, 10);
}

function dateFromTitle(title: string): string | null {
  const match = TITLE_DATE_RE.exec(title);
  if (!match) return null;
  const [, monthWord, day, year] = match;
  const month = MONTHS.indexOf(monthWord!.slice(0, 3).toLowerCase() as (typeof MONTHS)[number]);
  if (month === -1) return null;
  return isoDate(Number(year), month + 1, Number(day));
}

function dateFromTimestamp(publishedAt: string): string | null {
  const instant = new Date(publishedAt);
  if (Number.isNaN(instant.getTime())) return null;
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: MEETING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/**
 * Best-effort calendar date of a meeting. Municipal channels put the meeting
 * date in the video title, which survives late uploads; the upload time is
 * the fallback for titles without one.
 */
export function meetingDate(title: string, publishedAt: string): string | null {
  return dateFromTitle(title) ?? dateFromTimestamp(publishedAt);
}
