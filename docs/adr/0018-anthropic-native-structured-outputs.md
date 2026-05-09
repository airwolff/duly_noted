# 0018. Anthropic native structured outputs

Date: 2026-05-08
Status: Accepted

## Context

The segmentation pipeline produces typed outputs at every step
(marker list, chapter boundaries, title + description). LLM outputs
are untrusted input per CLAUDE.md §6 and must be Zod-validated before
any DB write. The question is what enforces schema conformance at the
LLM layer, before Zod sees the output.

Anthropic's native structured outputs went GA on Opus 4.7, Sonnet 4.6,
Sonnet 4.5, Opus 4.5, and Haiku 4.5. The API surface is
`output_config.format` with a JSON schema; constrained decoding
guarantees schema conformance (not factual accuracy) on the model
side. Before native structured outputs went GA, the standard pattern
was the `instructor` library plus Pydantic, or a manual JSON parse
with retry on parse failure.

## Considered options

- **Anthropic native structured outputs** — `output_config.format` with
  JSON schema, constrained decoding, GA across the relevant model
  family.
- **`instructor` library + Pydantic** — Oberoi's path on OpenAI;
  third-party dependency, parallel retry surface to Zod, designed for
  a Python stack we're not using.
- **Manual `JSON.parse` + retry** — extra retry surface; fragile when
  the LLM emits invalid JSON.
- **Tool-use coercion** — schema-conformance via tool-call shapes; works
  but adds complexity that constrained decoding now solves directly.

## Decision

Use Anthropic native structured outputs (`output_config.format` with
JSON schema). JSON schemas live in
`packages/shared/src/segmentation/schemas.ts`; Zod schemas mirror them
and validate every output before any DB write. The `instructor`
library is not a dependency.

## Consequences

- Schema conformance is enforced by constrained decoding; an entire
  retry surface (parse → fail → retry → fail …) goes away.
- Zod validation on the write path remains per CLAUDE.md §6; native
  structured outputs guarantee shape, not facts.
- The T-token validator (ADR-0016) still runs because constrained
  decoding cannot enforce that returned tokens exist in the
  per-meeting lookup table.
- Revisit: if Anthropic deprecates the API surface (unlikely).
