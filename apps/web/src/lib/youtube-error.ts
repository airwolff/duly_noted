// IFrame Player API onError event codes that drive the B3 fallback:
//   100 — video removed / not found
//   101 — embedding disabled by owner
//   150 — embedding disabled by owner (variant of 101)
//   153 — live stream unavailable (rare for the v1 corpus)
// Per kb_video-timestamp-linking-ux_2026-04-29_v1_youtube-unavailability,
// the IFrame API does not distinguish "removed" from "made private",
// so a single fallback panel covers all four codes.
const FALLBACK_CODES = new Set([100, 101, 150, 153]);

export function isFallbackErrorCode(code: number): boolean {
  return FALLBACK_CODES.has(code);
}
