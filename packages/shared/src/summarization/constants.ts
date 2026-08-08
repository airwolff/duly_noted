/**
 * Length bounds for the meeting summary.
 *
 * The prompt asks in WORDS and Zod enforces in CHARACTERS, on purpose.
 *
 * History, because this has been wrong twice. First the prompt and the Zod
 * bound were the same number (2000) and every overshoot killed a meeting:
 * 2075, 2268, 2315, 2352. Then the prompt asked for 1200–1800 characters
 * against a 2500 bound, and the next summary came back at 2646 — longer than
 * before, despite a lower target. A model cannot count its own characters, so
 * a character target is not an instruction it can follow; output length tracks
 * how much meeting there is to describe.
 *
 * Words are a unit the model approximates well. 220–280 words is roughly
 * 1300–1700 characters, and 3000 characters of enforcement clears the observed
 * 2646 with real margin. If a very long meeting ever exceeds 3000, the row
 * fails loudly and gets re-run rather than being silently truncated —
 * shortening published journalism without a human in the loop is worse than a
 * visible failure.
 *
 * 200 chars remains the floor (~1–2 sentences of substance).
 */
export const SUMMARY_MIN_CHARS = 200;
export const SUMMARY_MAX_CHARS = 3000;
export const SUMMARY_TARGET_MIN_WORDS = 220;
export const SUMMARY_TARGET_MAX_WORDS = 280;
