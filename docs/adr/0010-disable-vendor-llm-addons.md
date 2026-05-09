# 0010. Disable AssemblyAI vendor LLM add-ons

Date: 2026-05-07
Status: Accepted

## Context

AssemblyAI offers several premium add-ons on the same submit call:
`auto_chapters`, `sentiment_analysis`, `content_safety`,
`iab_categories`, vendor-side `summarization`. The most relevant to
this project is `auto_chapters`, which would generate chapter
boundaries directly from the audio and could plausibly substitute for
the Stage 4 segmentation pipeline.

Two constraints push against using the vendor add-ons. First, there's
a documented silent-500 failure mode on Universal-3 Pro when
`auto_chapters` is enabled. Second, segmentation is the publisher-
visible artifact — chapter title and description quality is the
product. Owning the segmentation pipeline (our LLM, our prompts, our
schema validation) is a deliberate scope decision, not a cost
optimization.

## Considered options

- **All vendor LLM add-ons disabled** — chapter and summary generation
  run on our own pipeline (Stage 4). No vendor-side LLM exposure.
- **Use AssemblyAI `auto_chapters` as Stage 4 baseline** — would
  collapse a whole stage of work but ties chapter quality to a vendor
  surface and exposes the SINGLE-SOURCE silent-500 risk.

## Decision

Disable `auto_chapters`, `sentiment_analysis`, `content_safety`,
`iab_categories`, and vendor-side `summarization` at submit time.
Keep `speaker_labels: true` and `speech_models: ['universal-3-pro']`.

## Consequences

- The Stage 4 segmentation pipeline is owned end-to-end. Chapter title,
  description, and marker taxonomy all run through our own LLM with
  Zod-validated outputs.
- Submit body stays minimal; one fewer vendor surface to fail on.
- Revisit: if the Stage 4 pipeline cost exceeds projection by >5×.
