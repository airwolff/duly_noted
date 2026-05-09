# 0016. `[T{integer}]` synthetic timestamp tokens

Date: 2026-05-08
Status: Accepted

## Context

The segmentation pipeline needs the LLM to point at specific moments
in the transcript — start of a chapter, end of a chapter, the marker
sentence. AssemblyAI's `utterances[]` array carries millisecond `start`
fields per utterance, so real timestamps are available. The question
is what timestamp format to put in the LLM input and what format to
expect back.

Oberoi documented verbatim that real timestamp formats (whether
`HH:MM:SS` or millisecond integers) trigger a hallucination class
where the LLM fabricates plausible-looking timestamps not present in
the transcript. This is structural to the LLM, not vendor-specific.

## Considered options

- **`[T{integer}]` synthetic tokens** — replace real timestamps with
  sequential `[T0]`, `[T1]`, `[T2]`… tokens injected ahead of every
  utterance in the LLM input. Out-of-band lookup table maps T-indices
  back to real timestamps. The LLM is instructed to reference and
  return only T-tokens; a Zod validator rejects any token not in the
  lookup table.
- **Real timestamp format (`HH:MM:SS`)** — Oberoi's documented
  hallucination case.
- **LLM-generated millisecond integers** — same hallucination class,
  fewer guard rails.
- **Trust diarized timestamps directly** — would require the LLM to
  emit the boundary as text and a separate matching pass to find the
  closest utterance; brittle.

## Decision

Use `[T{integer}]` synthetic tokens injected ahead of every utterance
in the LLM input. Out-of-band lookup table maps tokens to real
timestamps. Reject any returned token not in the lookup table at the
Zod validation step. Token injection logic and lookup table builder
live in `packages/shared/src/segmentation/t-tokens.ts`.

## Consequences

- The hallucination class — fabricated plausible-looking timestamps —
  is structurally eliminated, not heuristically detected.
- The LLM never sees a real timestamp, so it can never invent one
  without producing a token that fails validation.
- Adds one normalization step on input and one validation step on
  output to every segmentation call.
- Revisit: never expected — failure mode is structural, not
  vendor-specific.
