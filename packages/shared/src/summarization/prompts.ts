import type { MarkerType } from '../segmentation/index.js';
import { SUMMARY_MAX_CHARS, SUMMARY_MIN_CHARS } from './constants.js';

/**
 * Slice 4 summarization prompts. The system prompt enforces the Oberoi
 * entity-grounding pattern (KB kb_hallucination-mitigation-summarization
 * C2/C3) — the user prompt enumerates the meeting's known entities (board,
 * town, title, date, agenda items) and the system prompt instructs the model
 * to ground claims in the supplied context only. The people-attribution rule
 * is the v1 grounding stance: no member roster, names must appear verbatim
 * in segment excerpts.
 */

export const SUMMARIZATION_SYSTEM_PROMPT = `You are writing a meeting summary for a municipal selectboard meeting.

The user prompt will provide:
- Meeting metadata: board name, town name, meeting title, meeting date.
- A list of agenda-item titles parsed from the meeting's segments.
- An ordered list of segments produced by the segmentation pipeline. Each segment carries a marker_type (AGENDA_ITEM, PUBLIC_COMMENT, DISCUSSION, VOTE, or PROCEDURE), a title, a 1–2 sentence description, and a short transcript excerpt.

Ground every claim — board name, town name, agenda items, votes, decisions, dollar amounts, dates — in the supplied metadata and segment context only. Do not introduce facts that are not present in the input.

When referring to people: use only names that appear verbatim in a segment's transcript_excerpt. If a speaker is referenced only by an AssemblyAI diarization label, preserve that label unchanged. Do not invent names, titles, or roles for any speaker.

Be specific. Do not editorialize. Quote directly from a segment's transcript_excerpt or description when material is contested or unclear. Do not infer outcomes (passed, failed, approved, rejected) that are not stated in the segments.

Return a single prose summary in the \`summary\` field of the structured output. The summary must be between ${SUMMARY_MIN_CHARS} and ${SUMMARY_MAX_CHARS} characters. No markdown, no headings, no bullet points — plain prose only.`;

export interface SummaryPromptSegment {
  sequence_order: number;
  marker_type: MarkerType;
  title: string;
  description: string;
  transcript_excerpt: string;
}

export interface SummaryPromptInput {
  boardName: string;
  townName: string;
  meetingTitle: string | null;
  meetingDate: string | null;
  segments: ReadonlyArray<SummaryPromptSegment>;
}

function formatAgendaList(segments: ReadonlyArray<SummaryPromptSegment>): string {
  const items = segments.filter((s) => s.marker_type === 'AGENDA_ITEM').map((s) => `- ${s.title}`);
  if (items.length === 0) {
    return '(none identified)';
  }
  return items.join('\n');
}

function formatSegments(segments: ReadonlyArray<SummaryPromptSegment>): string {
  return segments
    .map(
      (s) =>
        `[${s.sequence_order}] ${s.marker_type} | ${s.title}\n    ${s.description}\n    Excerpt: ${s.transcript_excerpt}`,
    )
    .join('\n\n');
}

export function buildSummaryUserPrompt(input: SummaryPromptInput): string {
  const title = input.meetingTitle ?? '(untitled)';
  const date = input.meetingDate ?? '(unknown)';
  return `Meeting metadata:
- Board: ${input.boardName}
- Town: ${input.townName}
- Title: ${title}
- Date: ${date}

Agenda items identified (parsed from AGENDA_ITEM-typed segments):
${formatAgendaList(input.segments)}

Segments (in transcript order):
${formatSegments(input.segments)}`;
}
