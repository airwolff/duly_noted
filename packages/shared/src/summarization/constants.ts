/**
 * Length bounds for the meeting summary.
 *
 * Two different numbers on purpose. The TARGET pair is what the prompt asks
 * for; the MIN/MAX pair is what Zod enforces. They were the same number until
 * production showed why that fails: Anthropic does not honor minLength /
 * maxLength (see SPEC §Stage 6 "Hallucination guardrails" #3), the model aims
 * at whatever number the prompt states, and it overshoots. The first four real
 * summaries came in at 2075, 2268, 2315, and 2352 chars against a stated and
 * enforced 2000 — every one of them a failed meeting, and the last of those
 * had already been through a correction retry. A model cannot count its own
 * characters; it can only aim.
 *
 * So the prompt now asks for 1200–1800 and Zod allows up to 2500. The ~700
 * chars of slack absorb the observed 4–18% overshoot. All four production
 * summaries above would have passed. The retry in the worker stays as the
 * backstop for the tail.
 *
 * 200 chars remains a defensible floor (~1–2 sentences of substance). 2500 is
 * a ceiling that should rarely be approached, not a size to fill: the meeting
 * page renders the summary as one unclamped paragraph.
 */
export const SUMMARY_MIN_CHARS = 200;
export const SUMMARY_MAX_CHARS = 2500;
export const SUMMARY_TARGET_MIN_CHARS = 1200;
export const SUMMARY_TARGET_MAX_CHARS = 1800;
