/**
 * Length bounds for the meeting summary. 200 chars is a defensible floor
 * (~1–2 sentences of substance); 2000 chars is ~3 short paragraphs and fits
 * the reader-UI card without scrolling on mobile. Tune later if reader-UI
 * testing surfaces a problem. Enforced in Zod only (Anthropic structured
 * outputs do not honor minLength/maxLength — see SPEC §Stage 6 "Hallucination
 * guardrails" #3).
 */
export const SUMMARY_MIN_CHARS = 200;
export const SUMMARY_MAX_CHARS = 2000;
