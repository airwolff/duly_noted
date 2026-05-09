/**
 * Locked five-element Maine selectboard marker taxonomy (ADR 0015). Per-board
 * tunability is deferred to schema pass 2. The DB enforces this taxonomy via a
 * CHECK constraint on `segments.marker_type` so the LLM cannot drift labels
 * silently — these literals must stay in sync with that constraint.
 */
export const MARKER_TYPES = [
  'AGENDA_ITEM',
  'PUBLIC_COMMENT',
  'DISCUSSION',
  'VOTE',
  'PROCEDURE',
] as const;

export type MarkerType = (typeof MARKER_TYPES)[number];
