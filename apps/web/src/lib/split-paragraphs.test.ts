import { describe, expect, it } from 'vitest';
import { splitParagraphs } from './split-paragraphs.js';

describe('splitParagraphs', () => {
  it('splits on blank lines', () => {
    expect(splitParagraphs('First para.\n\nSecond para.\n\nThird para.')).toEqual([
      'First para.',
      'Second para.',
      'Third para.',
    ]);
  });

  it('returns pre-paragraph summaries as a single block', () => {
    // Summaries written before the prompt asked for paragraphs must still render.
    const legacy = 'One long block with no blank lines in it at all.';
    expect(splitParagraphs(legacy)).toEqual([legacy]);
  });

  it('keeps single newlines inside a paragraph', () => {
    expect(splitParagraphs('Line one\nline two.\n\nNext.')).toEqual([
      'Line one\nline two.',
      'Next.',
    ]);
  });

  it('collapses runs of blank lines instead of emitting empty paragraphs', () => {
    expect(splitParagraphs('A.\n\n\n\nB.')).toEqual(['A.', 'B.']);
  });

  it('normalizes Windows line endings', () => {
    expect(splitParagraphs('A.\r\n\r\nB.')).toEqual(['A.', 'B.']);
  });

  it('returns nothing for whitespace-only input', () => {
    expect(splitParagraphs('   \n\n  ')).toEqual([]);
  });
});
