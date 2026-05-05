# Architecture Decision Records

One file per decision, in short MADR format (https://adr.github.io/madr).

## Naming

`NNNN-kebab-case-slug.md` — e.g. `0001-render-for-background-worker.md`.
Increment `NNNN`. Never renumber existing ADRs.

## Template

```
# NNNN. Title

Date: YYYY-MM-DD
Status: Accepted | Superseded by NNNN | Deprecated

## Context

What forced this decision. The constraints, the question being answered.

## Considered options

- **Option A** — one-line summary
- **Option B** — one-line summary
- **Option C** — one-line summary

## Decision

Chose Option B.

## Consequences

What this commits us to. What it forecloses. What we'll need to revisit.
```
