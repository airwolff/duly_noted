// Segmentation stores excerpts with the utterance markers the LLM cited them
// by: "[T107] A: I thought our Budget Committee…". [T…] is an index into the
// transcript and the letter is an anonymous diarization label; neither means
// anything to a reader.
const UTTERANCE_MARKER_RE = /\[T\d+\]\s*/g;
const MARKER_AND_SPEAKER_RE = /\[T\d+\]\s*(?:[A-Z]{1,2}:\s*)?/g;

/** Drops [T…] markers, keeping speaker turns. For the full excerpt view. */
export function stripUtteranceMarkers(excerpt: string): string {
  return excerpt.replace(UTTERANCE_MARKER_RE, '').trim();
}

/** Drops markers and speaker labels and flattens whitespace. For snippets. */
export function excerptSnippetText(excerpt: string): string {
  return excerpt.replace(MARKER_AND_SPEAKER_RE, ' ').replace(/\s+/g, ' ').trim();
}
