/**
 * Anthropic's structured outputs constrain shape but not `minLength` /
 * `maxLength` (see packages/shared/src/summarization/schemas.ts). The prompts
 * state the bounds and the model still overshoots — three of the first three
 * production meetings failed here, by 4–13%, after the ASR spend was already
 * committed.
 *
 * So the bound gets one corrective round trip before the meeting fails: the
 * rejection message goes back to the model, which rewrites to fit. This is a
 * retry of a single LLM call inside one pipeline stage, not the automatic
 * retry of a `failed` meeting that CLAUDE.md §7 forbids — a meeting that
 * exhausts the correction is still marked `failed` and still needs a manual
 * reset.
 */

/** Raised by a parse helper when LLM output violates a length bound. */
export class LengthBoundsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LengthBoundsError';
  }
}

export function buildCorrectionNote(rejection: string): string {
  return (
    `\n\nYour previous response was rejected: ${rejection}. ` +
    `Rewrite it to satisfy the stated length limit, preserving the same facts ` +
    `and the same structure. Do not truncate mid-sentence.`
  );
}

/**
 * Call the model, parse, and on a length-bound violation call once more with
 * the rejection fed back. Any other error propagates untouched, and a second
 * violation propagates too — the caller marks the meeting failed either way.
 */
export async function parseWithLengthRetry<T>(
  call: (correctionNote: string) => Promise<unknown>,
  parse: (raw: unknown) => T,
  label: string,
): Promise<T> {
  try {
    return parse(await call(''));
  } catch (err) {
    if (!(err instanceof LengthBoundsError)) {
      throw err;
    }
    console.warn(`llm length correction ${label}: ${err.message}`);
    return parse(await call(buildCorrectionNote(err.message)));
  }
}
