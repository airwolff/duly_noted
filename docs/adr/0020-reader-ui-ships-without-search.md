# 0020 — Reader UI v1 ships without search

- Status: Accepted
- Date: 2026-05-10
- Slice: 5

## Context

The locked product decision specifies that meeting pages provide
"keyword + semantic search." Slice 5 builds the reader UI: the
authenticated surface that lets users browse towns, boards, and
meetings, and read the hybrid summary-plus-chaptered-segments page.

Search backend selection has KB research already (S1–S8 vendor analysis)
and is well-scoped, but shipping it requires (a) schema additions
(tsvector and embedding columns on meetings + segments), (b) an
embedding-generation pipeline integrated with the worker (decision
points: per-segment at write time vs. a separate embedding stage),
(c) a hybrid query RPC, and (d) a search input + results UI. That is
materially separate work from the reader pages themselves.

Bundling search into Slice 5 doubles the audit surface and concentrates
risk in one slice. Splitting them lets the reader ship sooner and lets
the search slice's backend choice (S1–S8) get a focused planning
discussion against the KB rather than getting compressed into the
reader-UI scope.

## Decision

Slice 5 ships the reader UI without search. Slice 6 adds search as a
follow-up slice covering schema, embedding pipeline, query RPC, and UI.

## Consequences

**Accepted:**

- The first reader release is browse-only. Users navigate town → board
  → meeting via lists; they cannot keyword- or semantic-search across
  the corpus.
- The locked product decision's "keyword + semantic search" wording is
  not violated — it is deferred. The full v1 product is the reader plus
  the search slice; Slice 5 ships the first half.
- Slice 6 has explicit scope: pgvector embeddings, tsvector lexical
  index, hybrid query, search UI. KB S1–S8 informs the backend choice.

**Risks:**

- At larger corpus scale, browsing without search becomes user-hostile.
  At v1 scale (~24 meetings/year, one board) it is not.
- A second tenant or a multi-board configuration before Slice 6 ships
  pushes the browse-only reader past its usability threshold. This is
  not in the v1 launch plan.

**Revisit trigger:**

- Slice 6 ships → ADR moves to status `Superseded by Slice 6`.
- A scope change adds a second tenant or a second board before Slice 6
  → reopen the slice ordering.

## Alternatives considered

- **Bundle search into Slice 5.** Doubles audit surface; concentrates
  risk; compresses the search-backend (S1–S8) discussion into a slice
  whose primary concern is UI.
- **Ship reader UI behind a feature flag with a search stub.** No
  benefit. The flag is more code than the deferral; the stub is dead
  code until Slice 6.
- **Defer reader UI until search is built.** Highest-value
  user-visible work blocks on the second-most-important work. Closes
  the pipeline-to-product loop later than necessary.
