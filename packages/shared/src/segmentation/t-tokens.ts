/**
 * T-token synthetic timestamp scheme (ADR 0016). The LLM never sees real
 * timestamps; it only sees `[T0]`, `[T1]`, ... tokens injected ahead of every
 * utterance. An out-of-band lookup table maps T-indices back to real ms
 * timestamps. The validator rejects any returned token not in the lookup,
 * structurally eliminating the hallucination class where LLMs fabricate
 * plausible-looking timestamps.
 */

export interface Utterance {
  start: number;
  end: number;
  text: string;
  speaker?: string;
}

export interface TTokenInput {
  /** Transcript blob with `[T{n}]` prefixes injected ahead of every utterance text. */
  text: string;
  /** Parallel array: `lookup[n]` is the millisecond `start` of utterance n. */
  lookup: number[];
}

const T_TOKEN_RE = /^\[T(\d+)\]$/;

/**
 * Parse a `[T{n}]` token into its integer index. Single source of truth for
 * the T-token regex shape; consumed by `lookupTToken` here and by the worker's
 * segmentation pipeline. Returns null if the token shape doesn't match.
 */
export function parseTTokenIndex(token: string): number | null {
  const m = T_TOKEN_RE.exec(token);
  if (!m || !m[1]) return null;
  const idx = Number.parseInt(m[1], 10);
  return Number.isInteger(idx) ? idx : null;
}

/**
 * Inject `[T0]`, `[T1]`, ... ahead of each utterance text. The speaker label
 * (when present) is included so the LLM can identify public-comment vs
 * board-member voices for marker classification.
 */
export function buildTTokenInput(utterances: Utterance[]): TTokenInput {
  const parts: string[] = [];
  const lookup: number[] = [];
  for (let i = 0; i < utterances.length; i += 1) {
    const u = utterances[i];
    if (!u) continue;
    lookup.push(u.start);
    const speaker = u.speaker ? `${u.speaker}: ` : '';
    parts.push(`[T${i}] ${speaker}${u.text}`);
  }
  return { text: parts.join('\n'), lookup };
}

/**
 * Resolve a `[T{n}]` token to its millisecond timestamp. Returns null if the
 * token is malformed or out of range for the lookup.
 */
export function lookupTToken(token: string, lookup: number[]): number | null {
  const idx = parseTTokenIndex(token);
  if (idx === null || idx < 0 || idx >= lookup.length) return null;
  const value = lookup[idx];
  return value === undefined ? null : value;
}

/**
 * Return the subset of input tokens that are NOT valid for the given lookup —
 * either malformed or out of range. Empty array on success.
 */
export function validateTTokens(tokens: string[], lookup: number[]): string[] {
  const offending: string[] = [];
  for (const t of tokens) {
    if (lookupTToken(t, lookup) === null) {
      offending.push(t);
    }
  }
  return offending;
}
