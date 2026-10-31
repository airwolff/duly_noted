import { describe, expect, it } from 'vitest';
import { formatDuration, formatTimestamp } from './format-duration.js';

describe('formatDuration', () => {
  it('formats hours and minutes', () => {
    expect(formatDuration(3664)).toBe('1 hr 1 min');
  });

  it('drops a zero component', () => {
    expect(formatDuration(2400)).toBe('40 min');
    expect(formatDuration(7200)).toBe('2 hr');
  });

  it('returns null for a missing or zero length', () => {
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(0)).toBeNull();
  });
});

describe('formatTimestamp', () => {
  it('formats under an hour as m:ss', () => {
    expect(formatTimestamp(754)).toBe('12:34');
    expect(formatTimestamp(5)).toBe('0:05');
  });

  it('formats an hour or more as h:mm:ss', () => {
    expect(formatTimestamp(3725)).toBe('1:02:05');
  });
});
