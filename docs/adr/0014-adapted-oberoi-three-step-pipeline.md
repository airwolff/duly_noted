# 0014. Adapted Oberoi three-step segmentation pipeline

Date: 2026-05-08
Status: Accepted

## Context

The publisher-visible artifact for a meeting is a sequence of titled,
described, time-bounded chapters. The transcript alone is not the
product; the segmentation is. The pipeline has to consume an
AssemblyAI diarized transcript and produce N rows in `segments` with
marker type, title, description, and start/end timestamps.

The reference work is Oberoi's citymeetings.nyc. Two distinct
approaches in his history: the March 2024 baseline was a three-step
LLM pipeline (marker extraction → boundary determination → title +
description). His current production approach (post-summer 2024) is
operator section-marking with AI sub-marker extraction, requiring a
custom review UI. Maine selectboard meetings are structurally simpler
and more agenda-predictable than NYC City Council hearings, so the
earlier baseline plausibly transfers.

## Considered options

- **Adapted Oberoi three-step pipeline** — sequential transcript chunks
  → marker extraction → per-marker boundary determination → per-chapter
  title and description. Single-pass per stage, no multi-LLM consensus.
- **Single-pass LLM** — one prompt, whole transcript, output the full
  segment list. Oberoi's abandoned failure mode; quality collapses on
  long inputs.
- **Operator section-marking + AI sub-extraction** — Oberoi's current
  production approach. Requires the operator review UI not built until
  a later slice.
- **TreeSeg embedding clustering** — unsupervised segmentation by
  embedding-based topic clustering. Unproven in production at this
  domain.

## Decision

Implement the adapted three-step pipeline as the v1 baseline.
Sequential transcript chunks (~8K tokens each) processed independently
in step 1; per-marker boundary determination in step 2; per-chapter
title + description in step 3. No multi-LLM consensus, no retry on
schema-valid output.

## Consequences

- Multi-LLM consensus and claim grounding remain explicit v2 deferrals
  (CLAUDE.md §7).
- The operator section-marking approach supersedes this pipeline when
  the slice that builds the operator review UI lands.
- Revisit: when the operator review UI slice lands and operator
  section-marking becomes feasible; or when segmentation quality
  plateaus below the acceptable threshold for publication.
