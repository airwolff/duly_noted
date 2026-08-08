import { describe, expect, it } from 'vitest';
import {
  DESCRIPTION_MAX_LEN,
  DESCRIPTION_TARGET_MAX_LEN,
  TITLE_MAX_LEN,
  TITLE_TARGET_MAX_LEN,
  step1OutputSchema,
  step2OutputSchema,
  step3OutputSchema,
} from './schemas.js';
import { STEP_3_SYSTEM_PROMPT } from './prompts.js';

describe('step1OutputSchema', () => {
  it('accepts a valid marker list', () => {
    const parsed = step1OutputSchema.parse({
      markers: [
        { marker_type: 'AGENDA_ITEM', start_token: '[T0]' },
        { marker_type: 'VOTE', start_token: '[T42]' },
      ],
    });
    expect(parsed.markers).toHaveLength(2);
  });

  it('accepts an empty marker list (chunks may have no markers)', () => {
    const parsed = step1OutputSchema.parse({ markers: [] });
    expect(parsed.markers).toEqual([]);
  });

  it('rejects unknown marker_type', () => {
    expect(() =>
      step1OutputSchema.parse({
        markers: [{ marker_type: 'CHAOS', start_token: '[T0]' }],
      }),
    ).toThrow();
  });

  it('rejects start_token without bracket form', () => {
    expect(() =>
      step1OutputSchema.parse({
        markers: [{ marker_type: 'AGENDA_ITEM', start_token: 'T0' }],
      }),
    ).toThrow();
  });

  it('rejects start_token with non-numeric index', () => {
    expect(() =>
      step1OutputSchema.parse({
        markers: [{ marker_type: 'AGENDA_ITEM', start_token: '[Tx]' }],
      }),
    ).toThrow();
  });
});

describe('step2OutputSchema', () => {
  it('accepts a valid end_token', () => {
    const parsed = step2OutputSchema.parse({ end_token: '[T42]' });
    expect(parsed.end_token).toBe('[T42]');
  });

  it('rejects empty string', () => {
    expect(() => step2OutputSchema.parse({ end_token: '' })).toThrow();
  });

  it('rejects malformed end_token', () => {
    expect(() => step2OutputSchema.parse({ end_token: 'T42' })).toThrow();
  });
});

describe('step3OutputSchema', () => {
  it('accepts a valid title + description', () => {
    const parsed = step3OutputSchema.parse({
      title: 'Treasurer report',
      description: 'Treasurer presented the monthly report; board accepted.',
    });
    expect(parsed.title).toBe('Treasurer report');
  });

  it('rejects empty title', () => {
    expect(() => step3OutputSchema.parse({ title: '', description: 'fine' })).toThrow();
  });

  it('rejects title exceeding max length', () => {
    const tooLong = 'x'.repeat(TITLE_MAX_LEN + 1);
    expect(() => step3OutputSchema.parse({ title: tooLong, description: 'fine' })).toThrow();
  });

  it('rejects empty description', () => {
    expect(() => step3OutputSchema.parse({ title: 'fine', description: '' })).toThrow();
  });
});

describe('step 3 prompt targets vs enforced bounds', () => {
  it('keeps the asked-for length below the enforced length', () => {
    // A description came back at 506 against a stated and enforced 500 and
    // failed its meeting. The prompt must aim lower than Zod allows.
    expect(TITLE_TARGET_MAX_LEN).toBeLessThan(TITLE_MAX_LEN);
    expect(DESCRIPTION_TARGET_MAX_LEN).toBeLessThan(DESCRIPTION_MAX_LEN);
    expect(DESCRIPTION_MAX_LEN - DESCRIPTION_TARGET_MAX_LEN).toBeGreaterThanOrEqual(100);
  });

  it('states the target, not the ceiling, in the step 3 prompt', () => {
    expect(STEP_3_SYSTEM_PROMPT).toContain(String(DESCRIPTION_TARGET_MAX_LEN));
    expect(STEP_3_SYSTEM_PROMPT).not.toContain(String(DESCRIPTION_MAX_LEN));
  });
});
