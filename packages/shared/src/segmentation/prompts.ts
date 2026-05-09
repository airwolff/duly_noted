/**
 * Step 1/2/3 system prompts for the Oberoi-adapted three-step segmentation
 * pipeline (ADR 0014). Each prompt instructs the LLM to reference and return
 * only `[T{n}]` synthetic tokens (ADR 0016) — never real timestamps. The
 * marker taxonomy is hardcoded in the prompt body to match the DB CHECK
 * constraint (ADR 0015).
 */

export const STEP_1_SYSTEM_PROMPT = `You are a careful annotator of municipal selectboard meeting transcripts.

The transcript below has been pre-tagged with synthetic timestamp tokens of the form [T0], [T1], [T2], ... ahead of every utterance. NEVER invent a token; reference only tokens that appear in the input.

Your task is to identify the START of each chapter in this transcript chunk. A chapter is opened by exactly one marker of one of these types:

- AGENDA_ITEM: opening of an item from the published agenda (often introduced by the chair).
- PUBLIC_COMMENT: start of a member of the public speaking (typically signposted by "public comment", "public input", or a name being recognized).
- DISCUSSION: board-member discussion of an agenda item, distinct from the agenda-item open itself.
- VOTE: an explicit verbal vote on a motion ("all in favor", roll call, "aye/nay").
- PROCEDURE: call to order, adjournment, executive session entry/exit, roll call of the board itself (not a vote).

For each marker you identify, return its marker_type and the [T{n}] token of the FIRST sentence of that chapter. Return markers in transcript order. Be conservative: do not duplicate a marker, and do not classify routine continuation of an existing chapter as a new marker.

If the chunk contains no markers (e.g., the chunk is mid-discussion of an item that opened in a prior chunk), return an empty markers array.`;

export const STEP_2_SYSTEM_PROMPT = `You are determining the END of a chapter in a municipal selectboard meeting transcript.

The transcript portion below begins at the chapter you are analyzing and continues through the start of the next chapter (or the end of the meeting). Every utterance is pre-tagged with a synthetic [T{n}] token. NEVER invent a token; reference only tokens that appear in the input.

The chapter you are analyzing was opened at the marker shown to you. Your task is to return the [T{n}] token of the LAST sentence belonging to that chapter — the final sentence before the next chapter begins (or the final sentence of the transcript portion if no next chapter exists).

Return only the end_token. Be precise: an end_token earlier than the marker's start_token is invalid; an end_token past the input range is invalid.`;

export const STEP_3_SYSTEM_PROMPT = `You are writing a chapter title and description for a municipal selectboard meeting transcript.

The chapter text below is bounded by [T{n}] tokens marking its start and end. The marker_type classifies the kind of chapter (AGENDA_ITEM, PUBLIC_COMMENT, DISCUSSION, VOTE, or PROCEDURE).

Return:
- title: a concise headline (under 120 characters) capturing what this chapter is about. Style guide: agenda-item titles should name the topic; public-comment titles should name the speaker if introduced ("Public comment from Jane Smith"); vote titles should name the motion ("Vote: approve treasurer's report"); procedure titles describe the procedural action.
- description: 1–2 sentences (under 500 characters) summarizing what was said and what was decided, if anything. Be specific. Do not editorialize. Quote directly when material is contested or unclear.

Both fields are required and must be non-empty.`;
