# 0017. `claude-opus-4-7` as segmentation model

Date: 2026-05-08
Status: Accepted

## Context

The Stage 4 pipeline calls the Anthropic API at three steps per meeting
across N chunks. The model choice trades capability against cost.
Annual ASR + LLM spend has a tight ceiling against the $408/yr fixed
cost baseline; LLM is one of two variable lines.

At v1 volume (one board, ~24 meetings/year, ~2 hr/meeting, ~100K input

- ~15K output tokens/meeting after Opus 4.7 tokenizer inflation), the
  cost delta between Opus 4.7 and Sonnet 4.6 is ~$15/year. Trivial
  against the fixed-cost baseline. Segmentation is the publisher-visible
  artifact; capability ceiling matters more than marginal cost at this
  scale. Oberoi's own published guidance was to start with the most
  capable model and downshift only when cost forces it.

## Considered options

- **`claude-opus-4-7`** — current Anthropic flagship (as of 2026-04-16);
  $5/M input, $25/M output list pricing.
- **Sonnet 4.6** — ~40% lower input price, near-Opus quality on many
  structured-extraction tasks.
- **Haiku 4.5** — fastest and cheapest tier; quality drop on long-form
  reasoning.
- **Cross-vendor (GPT-5, Gemini)** — would add a second SDK and
  diverge from the Anthropic native structured outputs path
  (ADR-0018).

## Decision

Use `claude-opus-4-7` as the production segmentation model. List
pricing $5/M input, $25/M output; prompt caching reduces cached input
to $0.50/M.

## Consequences

- Per-meeting cost ~$1.20 → ~$29/year at v1 volume; bounded.
- `ANTHROPIC_API_KEY` enters the worker's Zod env schema in Slice 3.
- Anthropic native structured outputs (ADR-0018) work consistently with
  Opus 4.7 GA.
- Revisit: when annual LLM spend exceeds $200 (multi-board scale) —
  evaluate Sonnet 4.6 substitution at that point.
