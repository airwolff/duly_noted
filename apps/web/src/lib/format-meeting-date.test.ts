import { describe, expect, it } from 'vitest';
import { formatMeetingDate } from './format-meeting-date.js';

describe('formatMeetingDate', () => {
  it('formats an ISO date as a long US date', () => {
    expect(formatMeetingDate('2026-08-10')).toBe('August 10, 2026');
  });

  it('does not shift the first of the month into the previous day', () => {
    expect(formatMeetingDate('2026-05-01')).toBe('May 1, 2026');
  });

  it('returns null for a missing or malformed date', () => {
    expect(formatMeetingDate(null)).toBeNull();
    expect(formatMeetingDate('not-a-date')).toBeNull();
  });
});
