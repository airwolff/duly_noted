import { describe, expect, it } from 'vitest';
import { meetingDate } from './meeting-date.js';

describe('meetingDate', () => {
  it('reads the date from a title like "Select Board - August 10, 2026"', () => {
    expect(meetingDate('Select Board - August 10, 2026', '2026-08-11T03:00:00Z')).toBe(
      '2026-08-10',
    );
  });

  it('accepts abbreviated months and a missing comma', () => {
    expect(meetingDate('Select Board Sept 8 2026', '2026-09-09T00:00:00Z')).toBe('2026-09-08');
    expect(meetingDate('Select Board - Jan. 5, 2026', '2026-01-06T00:00:00Z')).toBe('2026-01-05');
  });

  it('prefers the title over the upload time', () => {
    expect(meetingDate('Select Board - May 11, 2026', '2026-05-20T12:00:00Z')).toBe('2026-05-11');
  });

  it('falls back to the upload date in Maine time when the title has no date', () => {
    // 01:30 UTC on Aug 11 is still Aug 10 in America/New_York.
    expect(meetingDate('Lincolnville Select Board Meeting', '2026-08-11T01:30:00Z')).toBe(
      '2026-08-10',
    );
  });

  it('ignores an impossible calendar date in the title', () => {
    expect(meetingDate('Select Board - February 30, 2026', '2026-03-01T15:00:00Z')).toBe(
      '2026-03-01',
    );
  });

  it('returns null when neither source yields a date', () => {
    expect(meetingDate('Select Board', 'not a timestamp')).toBeNull();
  });
});
