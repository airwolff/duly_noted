import { describe, expect, it } from 'vitest';
import { excerptSnippetText, stripUtteranceMarkers } from './clean-excerpt.js';

const RAW = '[T14] B: Hi, Josh Bradford.\n[T15] I: Um, I just wanted to give you an update.';

describe('stripUtteranceMarkers', () => {
  it('removes [T…] markers but keeps speaker turns and line breaks', () => {
    expect(stripUtteranceMarkers(RAW)).toBe(
      'B: Hi, Josh Bradford.\nI: Um, I just wanted to give you an update.',
    );
  });
});

describe('excerptSnippetText', () => {
  it('removes markers and speaker labels and joins into one line', () => {
    expect(excerptSnippetText(RAW)).toBe(
      'Hi, Josh Bradford. Um, I just wanted to give you an update.',
    );
  });

  it('leaves a colon that is not a speaker label alone', () => {
    expect(excerptSnippetText('[T3] A: Agenda: item one')).toBe('Agenda: item one');
  });

  it('passes through text with no markers', () => {
    expect(excerptSnippetText('Plain text.')).toBe('Plain text.');
  });
});
