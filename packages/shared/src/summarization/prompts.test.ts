import { describe, expect, it } from 'vitest';
import { SUMMARY_MAX_CHARS, SUMMARY_MIN_CHARS } from './constants.js';
import {
  buildSummaryUserPrompt,
  SUMMARIZATION_SYSTEM_PROMPT,
  type SummaryPromptSegment,
} from './prompts.js';

const fixtureSegments: SummaryPromptSegment[] = [
  {
    sequence_order: 0,
    marker_type: 'PROCEDURE',
    title: 'Call to order',
    description: 'Chair calls the meeting to order at 7:00 PM.',
    transcript_excerpt: 'Welcome everyone, this meeting is called to order.',
  },
  {
    sequence_order: 1,
    marker_type: 'AGENDA_ITEM',
    title: 'Treasurer report',
    description: 'Treasurer presents the monthly financial report.',
    transcript_excerpt: 'The treasurer presented this month numbers.',
  },
  {
    sequence_order: 2,
    marker_type: 'AGENDA_ITEM',
    title: 'Sidewalk repair bid',
    description: 'Discussion of bids received for sidewalk repairs.',
    transcript_excerpt: 'We received three bids for the sidewalk repair project.',
  },
  {
    sequence_order: 3,
    marker_type: 'VOTE',
    title: 'Vote: accept lowest bid',
    description: 'Board votes to accept the lowest bid.',
    transcript_excerpt: 'All in favor say aye. The motion carries.',
  },
];

describe('SUMMARIZATION_SYSTEM_PROMPT', () => {
  it('includes the verbatim people-grounding directive', () => {
    expect(SUMMARIZATION_SYSTEM_PROMPT).toContain(
      'use only names that appear verbatim in a segment',
    );
    expect(SUMMARIZATION_SYSTEM_PROMPT).toContain(
      'Do not invent names, titles, or roles for any speaker.',
    );
  });

  it('mentions the configured length bounds', () => {
    expect(SUMMARIZATION_SYSTEM_PROMPT).toContain(String(SUMMARY_MIN_CHARS));
    expect(SUMMARIZATION_SYSTEM_PROMPT).toContain(String(SUMMARY_MAX_CHARS));
  });

  it('forbids editorializing and inferring outcomes', () => {
    expect(SUMMARIZATION_SYSTEM_PROMPT).toContain('Do not editorialize');
    expect(SUMMARIZATION_SYSTEM_PROMPT).toContain('Do not infer outcomes');
  });
});

describe('buildSummaryUserPrompt', () => {
  it('renders meeting metadata, agenda list, and segments deterministically', () => {
    const prompt = buildSummaryUserPrompt({
      boardName: 'Lincolnville Selectboard',
      townName: 'Lincolnville',
      meetingTitle: 'Regular Meeting',
      meetingDate: '2026-04-15',
      segments: fixtureSegments,
    });

    expect(prompt).toContain('Board: Lincolnville Selectboard');
    expect(prompt).toContain('Town: Lincolnville');
    expect(prompt).toContain('Title: Regular Meeting');
    expect(prompt).toContain('Date: 2026-04-15');

    expect(prompt).toContain('- Treasurer report');
    expect(prompt).toContain('- Sidewalk repair bid');

    expect(prompt).toContain('[0] PROCEDURE | Call to order');
    expect(prompt).toContain('[1] AGENDA_ITEM | Treasurer report');
    expect(prompt).toContain('[2] AGENDA_ITEM | Sidewalk repair bid');
    expect(prompt).toContain('[3] VOTE | Vote: accept lowest bid');

    const sidewalkIdx = prompt.indexOf('[2] AGENDA_ITEM');
    const voteIdx = prompt.indexOf('[3] VOTE');
    expect(sidewalkIdx).toBeGreaterThan(0);
    expect(voteIdx).toBeGreaterThan(sidewalkIdx);
  });

  it('handles missing meeting title and date', () => {
    const prompt = buildSummaryUserPrompt({
      boardName: 'Board',
      townName: 'Town',
      meetingTitle: null,
      meetingDate: null,
      segments: [],
    });
    expect(prompt).toContain('Title: (untitled)');
    expect(prompt).toContain('Date: (unknown)');
  });

  it('emits "(none identified)" when no AGENDA_ITEM segments exist', () => {
    const prompt = buildSummaryUserPrompt({
      boardName: 'Board',
      townName: 'Town',
      meetingTitle: null,
      meetingDate: null,
      segments: [
        {
          sequence_order: 0,
          marker_type: 'DISCUSSION',
          title: 'Open discussion',
          description: 'Board discusses upcoming events.',
          transcript_excerpt: 'Various items came up.',
        },
      ],
    });
    expect(prompt).toContain('(none identified)');
  });
});
