# Known Non-Issues

Findings raised in audits and explicitly accepted as wont-fix.
Append-only. Each entry has a stable ID (`NI-NNN`) so audits can
reference it.

## How audits use this file

The audit prompt reads this file before producing findings. Any
item listed here is suppressed from new audits. If an audit
believes an entry warrants reconsideration, it lists the ID under
"Reopen candidates" in its report — it does not re-raise the item
as a finding.

## Entry format

```
## NI-NNN: <short title>
- Status: Accepted | Promoted (see [target]) | Withdrawn
- Source: docs/audits/<filename>#<finding-id>
- Date accepted: YYYY-MM-DD
- Scope: <files or component this applies to>
- Reasoning: <why this is acceptable now>
- Revisit when: <trigger condition, or "permanent">
```

## Promotion

When an entry's reasoning becomes a permanent stance, promote it:
- to `SPEC.md` if it's a product/architecture position, or
- to `docs/adr/NNNN-<slug>.md` if it's an architectural decision
  with tradeoffs.

After promotion, change Status to `Promoted (see <target>)` and
keep the entry — do not delete. The history is the value.

## Entries


## NI-001: Login client `?? ''` fallback for NEXT_PUBLIC_* env vars
- Status: Accepted
- Source: docs/audits/2026-05-06-spine-scaffold.md#finding-4
- Date accepted: 2026-05-06
- Scope: apps/web/src/app/login/page.tsx:7-8
- Reasoning: Client components in Next.js cannot call server-side Zod validators because `process.env` is not a runtime browser object — `NEXT_PUBLIC_*` values are inlined at build time. The web app's Zod-at-boot gate is enforced by `apps/web/middleware.ts` on every non-asset request, which throws before any page renders. Direct `process.env` reads with `?? ''` fallbacks in client components are stylistically loose but inherit the middleware gate; they are not a runtime safety risk.
- Revisit when: `middleware.ts` is removed, the `loadEnv()` boot gate moves elsewhere, or the login page starts reading server-only env vars (which would be a separate violation).

## NI-002: `_scaffold_health` INSERT lacks idempotency guard
- Status: Accepted
- Source: docs/audits/2026-05-06-spine-scaffold-2.md#question-3
- Date accepted: 2026-05-06
- Scope: supabase/migrations/20260505191054_scaffold.sql:23
- Reasoning: The INSERT is unguarded but the duplication failure mode is gated by the same migration's `CREATE TABLE` statement. If the migration ledger ever lost track and re-ran the migration, `CREATE TABLE` would fail first ("relation already exists") and roll back the transaction before the INSERT could fire. The realistic path runs the migration exactly once on a fresh database, where the INSERT correctly seeds one row. The probe page tolerates the degraded duplicate case via `.maybeSingle()`. No state-machine, security, or data-integrity impact. The seed cannot move to `seed.sql` because `seed.sql` only runs on `db reset`, not on `db push` to a fresh project.
- Revisit when: The scaffold migration is split (table creation moves to a separate migration from the seed INSERT), at which point the INSERT becomes independently reachable and needs a guard.

## NI-003: Scaffold migration DDL lacks `IF NOT EXISTS` / `OR REPLACE` guards
- Status: Accepted
- Source: docs/audits/2026-05-06-spine-scaffold-2.md#question-4
- Date accepted: 2026-05-06
- Scope: supabase/migrations/20260505191054_scaffold.sql:9-90
- Reasoning: Migration DDL guards (`IF NOT EXISTS`, `OR REPLACE`) are unnecessary in this project because (1) Supabase CLI migrations run in transactions per migration, making partial-apply structurally impossible once CI-driven migrations land per Finding 1; and (2) Postgres 15/16 has no clean `IF NOT EXISTS` form for `CREATE POLICY` or `CREATE TYPE ... AS ENUM`, so the remediation requires DO-blocks that are heavier and uglier than bare DDL. Bare DDL is the correct convention for this project.
- Revisit when: Migrations stop running through Supabase CLI / CI (i.e., Finding 1 is reverted), or Postgres adds `IF NOT EXISTS` support for `CREATE POLICY` and `CREATE TYPE AS ENUM` in a major version this project upgrades to.

## NI-004: Cloudflare Pages production build unverified by GitHub Actions CI
- Status: Accepted
- Source: docs/audits/2026-05-06-spine-scaffold.md#question-2
- Date accepted: 2026-05-06
- Scope: .github/workflows/ci.yml, apps/web/next.config.mjs
- Reasoning: Cloudflare Pages git integration runs the production build on every push to `main` and on every PR. As of 2026-05-06, all production deploys have succeeded (HEAD `7396364` deployed green). Cloudflare's deploy is the canonical build verifier per SPEC.md CI/CD section ("git integration on `main`. Preview deploys on PRs serve as the only non-prod environment"). Adding `pages:build` to GitHub Actions CI would duplicate the signal Cloudflare already provides. The lighter checks (typecheck/lint/test/format) catch the regressions CI is appropriate for; build regressions surface via Cloudflare on the PR or on `main`.
- Revisit when: A build regression lands on `main` without being caught by Cloudflare's build (i.e., Cloudflare reports green but runtime fails), or PR previews stop running reliably, or build time on Cloudflare becomes a bottleneck and a fail-fast CI check would shorten the loop.

## NI-005: Worker dev/start scripts rely on root-hoisted tsx/typescript
- Status: Accepted
- Source: docs/audits/2026-05-06-spine-scaffold.md#question-5
- Date accepted: 2026-05-06
- Scope: apps/worker/package.json, apps/worker-cron/package.json, root package.json
- Reasoning: `apps/worker` and `apps/worker-cron` rely on `tsx` and `typescript` hoisted from the workspace root devDependencies. This is the standard pnpm workspace pattern — pnpm hoists root devDeps and resolves them from per-workspace bin paths, which is why Render's `pnpm install --frozen-lockfile && pnpm -F worker build` succeeds. The conditional risk (a future Render contract that strips devDeps via `--prod` or similar) is not a present defect, and the remediation if it ever fires is a 30-second `package.json` edit per worker. Duplicating `tsx`/`typescript` into each worker's devDependencies now would defend against an unspecified future change at the cost of a slightly fatter dependency graph.
- Revisit when: Render's build documentation introduces `--prod`, devDep-stripping behavior, or any other contract change that breaks pnpm root-hoisted devDep resolution; or when a third worker workspace is added (point at which the duplication cost compounds).

## NI-006: Three direct-push commits on main lack Conventional Commits prefix
- Status: Accepted
- Source: docs/audits/2026-05-06-spine-scaffold-3.md#question-1
- Date accepted: 2026-05-06
- Scope: commits 1d86bd9, fbc03eb, 83391b0 on main
- Reasoning: The three commits are immutable artifacts of initial render.yaml deploy debugging during the bootstrap window. Force-pushing main to rewrite history is destructive (invalidates every downstream contributor's clone) and disproportionate to three tiny config tweaks with no runtime impact. CLAUDE.md §5 mandates PR squash-merges going forward, which authors the squash commit message deliberately and bounds this violation category at the merge boundary. The deploy-debugging window that produced these commits is closed.
- Revisit when: A direct-push to main without a Conventional Commits prefix occurs after the PR squash-merge convention is established; or an audit finds the pattern repeating beyond the initial deploy-debugging window.

## NI-007: meetings.youtube_id UNIQUE not yet promoted to (board_id, youtube_id) composite
- Status: Accepted
- Source: docs/audits/2026-05-07-slice-2-ingestion.md#question-1
- Date accepted: 2026-05-08
- Scope: supabase/migrations/ (slice_2_ingestion + slice_2_followup), meetings table UNIQUE constraint
- Reasoning: One publication, one town, one board at v1. A bare UNIQUE on `youtube_id` is sufficient because exactly one board feeds the table. The composite shape reflects the locked tenant-ready schema's intent but adds no enforcement value before a second board exists. Forcing the constraint shape change before there's a constraint problem to solve is plumbing for an unrealized future.
- Revisit when: a second `boards` row is created (same or different publication). That condition forces the constraint reshape — `(board_id, youtube_id)` UNIQUE replaces the bare UNIQUE in the same migration that inserts the second board.

## NI-008: meetings RLS authenticated SELECT lacks per-publication tenant filter
- Status: Accepted
- Source: docs/audits/2026-05-07-slice-2-ingestion.md#question-4
- Date accepted: 2026-05-08
- Scope: supabase/migrations/slice_2_ingestion, meetings RLS policy for authenticated role
- Reasoning: Single-publication configuration at v1. Every authenticated user belongs to the only publication, so a `publication_id IN (SELECT ... FROM memberships WHERE user_id = auth.uid())` predicate evaluates trivially true and adds zero defense in depth. The locked schema already carries the publication chain (`meetings.board_id → boards.town_id → towns.publication_id`); the predicate can be added in one migration when it gains an enforcement role.
- Revisit when: a second publication onboards, OR an authenticated reader UI ships that could expose `meetings` rows across publications. Either reaches the predicate's first non-trivial evaluation.

## NI-009: packages/shared schemas not yet imported by Edge Functions
- Status: Accepted
- Source: Carry-forward from 2026-05-07 triage handoff; not raised as a Finding or Question in either audit
- Date accepted: 2026-05-08
- Scope: packages/shared/src/, supabase/functions/asr-webhook/
- Reasoning: One Edge Function at v1. The shared-package value is consistency across multiple consumers; with a single consumer, duplicating the small JSON shape inline avoids wiring a Deno-compatible import path for an npm-workspace package, which is non-trivial under Supabase Edge Functions' module resolution.
- Revisit when: a second Edge Function lands that needs the same shapes (inbound public API, second webhook receiver, signed-URL minter). At that point the duplication cost crosses the import-wiring cost and shared imports become correct.

## NI-010: ADR 0007 omits "Supabase's recommended pattern" vendor-alignment citation
- Status: Accepted
- Source: docs/audits/2026-05-09-spec-restructure.md#q1
- Date accepted: 2026-05-09
- Scope: docs/adr/0007-migrations-via-github-action.md
- Reasoning: The ADR's standalone argument is self-contained. Forward-only migrations are justified by three independent threads in the ADR text: (1) the no-down-scripts consequence (rollback is by writing a forward migration that undoes); (2) the backwards-compatibility framework (additive ahead of consuming code; expand/contract for destructive changes); (3) the parallel-deploy race safety that backwards-compatibility guarantees. The dropped phrase "matches Supabase's recommended pattern" was an unsourced appeal to vendor authority. Restoring it would weaken the ADR by adding a vague vendor citation without a link to the actual recommendation. The decision is defensible on its standalone merits.
- Revisit when: Supabase publishes a definitive forward-only migration guide that adds material reasoning beyond what the ADR already captures, OR a reviewer/contributor challenges the forward-only choice and asks why no rollback scripts exist (in which case the answer is the rollback-by-forward-migration pattern, not vendor alignment).

## NI-011: ADR 0008 omits "cheapest with diarization in this tier" comparative claim
- Status: Accepted
- Source: docs/audits/2026-05-09-spec-restructure.md#q2
- Date accepted: 2026-05-09
- Scope: docs/adr/0008-assemblyai-universal-3-pro.md
- Reasoning: The literal "cheapest with diarization in this tier" was in tension with its own supporting evidence in the pre-restructure SPEC.md row 2.1 — Deepgram Nova-3 was described in the same row as "comparable price tier" rather than "more expensive." Restoring the stronger claim would re-introduce a weakly-supported assertion. The load-bearing rationale that survives in ADR 0008 — diarization included in base rate, competitive Earnings-21 WER ~8.8%, $0.06/hr Universal-2 premium acceptable at ~$10/year v1 volume, opt-out of training available — is fully preserved and is stronger than the price ranking. The audit verifier flagged this tension explicitly.
- Revisit when: pricing changes substantially and Universal-3 Pro becomes unambiguously cheapest-with-diarization across all current alternatives (Deepgram, Rev.ai, AWS Transcribe, Whisper API). At that point restate the claim with current numbers and a citation.

## NI-012: TRANSCRIPT_EXCERPT_MAX_LEN worker-side cap (SPEC gap)
- Status: Accepted
- Source: docs/audits/2026-05-09-slice-3-segmentation.md#q5
- Date accepted: 2026-05-09
- Scope: apps/worker/src/pipeline/segment.ts:42
- Reasoning: SPEC §Slice 3 schema deltas declares `transcript_excerpt text` with no length cap; the worker enforces 500 chars at write time. At v1 there is exactly one writer (`apps/worker/src/pipeline/segment.ts`), so the worker-side cap is the operative contract. A DB-level CHECK constraint or `varchar(500)` would be more robust against future writers but is unnecessary today. The 500-char value is a reader-UI display optimization, not a data integrity constraint.
- Revisit when: A second segment writer is introduced (Edge Function, bulk import tool, admin UI write path). At that point add a follow-up migration with a `CHECK (char_length(transcript_excerpt) <= 500)` constraint and keep the worker-side cap as defense-in-depth.

## NI-013: Redundant `segments_meeting_id_idx` alongside (meeting_id, sequence_order) UNIQUE
- Status: Accepted
- Source: docs/audits/2026-05-09-slice-3-segmentation.md#q6
- Date accepted: 2026-05-09
- Scope: supabase/migrations/20260509200337_slice_3_segmentation_schema.sql:50; SPEC.md:373-376
- Reasoning: The unique constraint on `(meeting_id, sequence_order)` is backed by a btree whose leading column already serves any `WHERE meeting_id = $1` predicate. The separate single-column index on `(meeting_id)` adds no plan improvement, only marginal write amplification and disk. SPEC §Slice 3 Indexes prescribes both indexes with the same blind spot, so the migration faithfully implements a flawed spec. At v1 volume (~1200 segments/year) the cost is irrelevant.
- Revisit when: Segments table volume grows enough that write amplification is measurable, OR a pass-2 migration touches the segments table for another reason (search columns, membership-aware RLS, soft-delete). Fold the index drop and the corresponding SPEC correction in then.

## NI-014: Speculative barrel exports in packages/shared segmentation
- Status: Accepted
- Source: docs/audits/2026-05-09-slice-3-segmentation.md#q7
- Date accepted: 2026-05-09
- Scope: packages/shared/src/segmentation/index.ts
- Reasoning: The exports `MARKER_TYPES`, `TITLE_MAX_LEN`, `DESCRIPTION_MAX_LEN`, `lookupTToken`, `TTokenInput`, `Step1Output`, `Step2Output`, `Step3Output` have zero internal consumers today. They document the package's intended public surface for imminent consumers: the reader UI (Slice 5+) needs `MARKER_TYPES` for filter chips and the length constants for client-side truncation; the Edge Function or summarization handler may need the t-token helpers. Barrel files do not ship dead code (tree-shaking handles that), and the package is not published. Trimming now means re-exporting later.
- Revisit when: The imminent consumers (reader UI, Edge Function, summarization handler) ship and the actual consumed surface is known. At that point trim any export that remains genuinely unused.

## NI-015: chunkLines admits oversized single line when current is empty
- Status: Accepted
- Source: docs/audits/2026-05-09-slice-3-segmentation.md#q11
- Date accepted: 2026-05-09
- Scope: apps/worker/src/pipeline/segment.ts:89-108
- Reasoning: If a single utterance line exceeds `CHUNK_MAX_CHARS` (24K), the guard `current.length > 0` lets the oversized line through whole. AssemblyAI utterances are sentence-level (~100-300 chars including the `[Tn]` prefix and speaker label), so this is structurally implausible. Even if hit, the resulting chunk fits Anthropic's 200K context window with no API failure. Adding a guard defends against a scenario that cannot happen under the current ASR contract and would not fail if it did.
- Revisit when: ASR vendor changes (off AssemblyAI Universal-3 Pro), OR AssemblyAI's utterance segmentation behavior changes such that single utterances can plausibly exceed 24K chars, OR Anthropic's context window shrinks below the chunk-plus-prompt size.

## NI-016: Failure-path UPDATE in worker handlers is unconditional, not status-guarded
- Status: Accepted
- Source: docs/audits/2026-05-10-slice-4-summarization.md#q1
- Date accepted: 2026-05-10
- Scope: apps/worker/src/pipeline/fail.ts (called from summarize.ts:148 and segment.ts:315)
- Reasoning: The complete-path RPCs (`complete_segmentation`, `complete_summarization`) carry `WHERE status = 'segmenting_inflight'` / `WHERE status = 'summarizing_inflight'` write-side idempotency guards. The failure path uses the shared `markFailed()` helper which fires `UPDATE meetings SET status='failed' WHERE id = $id` with no status filter. SPEC §Stage 6 explicitly permits both forms ("a separate UPDATE (or an `abandon_*_meeting` RPC ...)"), and the asymmetry between complete-path and failure-path is operationally safe at v1: single Render worker dyno, control-flow guarantees `markFailed` is called at most once per claimed row in transient-inflight state. Adding a guarded form would require either parallel abandon RPCs across both Slices 3 and 4 (schema churn) or modifying the shared helper (changes Slice 2 caller semantics). Defensive value lands only when a second `markFailed` caller exists outside the claimed-handler context, or when multi-worker deploys ship.
- Revisit when: Either (a) a second non-handler code path needs to call `markFailed`, or (b) v2 deploys multiple worker instances against the same Supabase, or (c) a production incident traces to a `markFailed`-on-non-inflight-row. Whichever lands first.

## NI-017: Claim RPCs return more columns than the handler currently consumes
- Status: Accepted
- Source: docs/audits/2026-05-10-slice-4-summarization.md#q2
- Date accepted: 2026-05-10
- Scope: supabase/migrations/ (claim_summarizing_meeting, claim_segmenting_meeting); apps/worker/src/pipeline/summarize.ts, segment.ts
- Reasoning: `claim_summarizing_meeting` returns `youtube_id` which `runSummarizationOnce` does not read; `claim_segmenting_meeting` returns `duration_seconds` which `runSegmentationOnce` does not read. The asymmetry is intentional: claim RPCs return a row-identity dump to insulate the schema from future handler additions (B5 transcript-aware summarization, re-summarize handlers, ops tooling) that may want the spare columns without requiring an RPC return-type migration. Trimming would require retroactive migrations on both Slice 3 and Slice 4 schemas with zero behavioral change. The spare-column cost (~36 bytes per claim, ~24 claims/year/handler) is negligible.
- Revisit when: Either (a) a future handler ships and the claim RPC needs columns the current shape doesn't provide, surfacing the migration-deferral cost; or (b) a slice introduces a third claim RPC and the convention's coherence is questioned during planning.
