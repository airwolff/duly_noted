import { describe, expect, it } from 'vitest';
import { buildEmbeddingInput } from './inputs.js';

describe('buildEmbeddingInput', () => {
  it('concatenates title, description, and transcript excerpt with newlines', () => {
    expect(
      buildEmbeddingInput({
        title: 'Budget item',
        description: 'Discussion of the budget.',
        transcript_excerpt: 'We discussed the budget today.',
      }),
    ).toBe('Budget item\nDiscussion of the budget.\nWe discussed the budget today.');
  });

  it('trims trailing whitespace on each field', () => {
    expect(
      buildEmbeddingInput({
        title: 'Title  ',
        description: '  Description.\n',
        transcript_excerpt: 'Excerpt.',
      }),
    ).toBe('Title\nDescription.\nExcerpt.');
  });

  it('throws when the combined input is empty', () => {
    expect(() =>
      buildEmbeddingInput({ title: '', description: '', transcript_excerpt: '' }),
    ).toThrow(/empty/);
  });
});
