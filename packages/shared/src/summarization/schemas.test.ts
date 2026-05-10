import { describe, expect, it } from 'vitest';
import { SUMMARY_MAX_CHARS, SUMMARY_MIN_CHARS } from './constants.js';
import { summaryOutputSchema } from './schemas.js';

describe('summaryOutputSchema', () => {
  it('accepts a summary at the minimum length', () => {
    const summary = 'x'.repeat(SUMMARY_MIN_CHARS);
    const parsed = summaryOutputSchema.parse({ summary });
    expect(parsed.summary).toHaveLength(SUMMARY_MIN_CHARS);
  });

  it('accepts a summary at the maximum length', () => {
    const summary = 'x'.repeat(SUMMARY_MAX_CHARS);
    const parsed = summaryOutputSchema.parse({ summary });
    expect(parsed.summary).toHaveLength(SUMMARY_MAX_CHARS);
  });

  it('rejects a summary one char below minimum', () => {
    const summary = 'x'.repeat(SUMMARY_MIN_CHARS - 1);
    expect(() => summaryOutputSchema.parse({ summary })).toThrow();
  });

  it('rejects a summary one char above maximum', () => {
    const summary = 'x'.repeat(SUMMARY_MAX_CHARS + 1);
    expect(() => summaryOutputSchema.parse({ summary })).toThrow();
  });

  it('rejects a missing summary field', () => {
    expect(() => summaryOutputSchema.parse({})).toThrow();
  });

  it('rejects a non-string summary', () => {
    expect(() => summaryOutputSchema.parse({ summary: 42 })).toThrow();
  });
});
