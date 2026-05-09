import { describe, expect, it } from 'vitest';
import {
  TITLE_MAX_LEN,
  step1OutputSchema,
  step2OutputSchema,
  step3OutputSchema,
} from './schemas.js';

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
