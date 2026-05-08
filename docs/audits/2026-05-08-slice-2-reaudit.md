---
date: 2026-05-08
scope: Slice 2 re-audit — post-smoke fixes (speech_models, service_role grants, --env-file) and verify_jwt = false on asr-webhook
commit_range: 4ad6d06..HEAD
head_sha: 472ba0ddb606008cd214d86f4e04e485f0272d5b
prior_audit: 2026-05-07-slice-2-ingestion.md
known_non_issues_consulted: true
audit_method: parallel-subagents-with-verification
passes_run: P1, P2, P3, P4, P5, P6
findings_count: 2
questions_count: 0
findings_dropped_by_verification: 0
findings_filtered_by_known_non_issues: 0
---

# Audit — Slice 2 re-audit (post-smoke fixes + verify_jwt)

Six parallel subagents (P1–P6) reviewed the two commits since the prior
audit's fix-pass merged: `c29271a` (post-smoke fixes — `speech_models`
field, `service_role` GRANTs migration, `--env-file=.env.local` on
worker dev script) and `472ba0d` (`verify_jwt = false` on `asr-webhook`).
Three candidate findings were raised — two by P1+P4 collapsing to the
same root cause (dangling NI registry references), one by P4 alone
(half-applied env-file fix). Both verified true above the 80-confidence
floor.

The user explicitly asked for a meta-finding on **what categories of
defect the original audit checklist missed**, since three production-only
bugs (AssemblyAI 400, scaffold-table GRANT gap, JWT gate on Edge
Function) slipped past the 2026-05-07 audit. That analysis is at the
bottom under "Audit-checklist gaps surfaced by this re-audit."

## Mechanical pass results

| Check                                | Result | Notes                                                                                                                  |
| ------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| `pnpm -r typecheck`                  | PASS   | All five workspaces clean.                                                                                             |
| `pnpm -r lint`                       | PASS   | All five workspaces clean.                                                                                             |
| `pnpm -r test`                       | PASS   | 35 tests across 4 workspaces with tests (db 2, shared 12, worker 5, worker-cron 16). `apps/web` runs `--passWithNoTests`. |
| `pnpm format:check`                  | PASS   | Clean.                                                                                                                 |
| `git diff --shortstat 4ad6d06..HEAD` | n/a    | 7 files / 20+ / 2−. One new migration (9 LOC), one new TOML stanza (3 LOC), four small in-place edits.                 |
| `git log --oneline 4ad6d06..HEAD`    | n/a    | Two commits, both Conventional Commits prefixed (`fix:` / `fix(asr-webhook):`).                                        |
| TODO/FIXME/XXX in changed files      | 0      | Clean.                                                                                                                 |
| `console.*` introduced               | 0      | None added.                                                                                                            |
| Hardcoded URLs                       | 0      | None added.                                                                                                            |
| Secret-shaped strings                | 0      | None.                                                                                                                  |
| New files > 500 LOC                  | 0      | The new migration is 9 LOC.                                                                                            |
| `supabase db reset`                  | PASS   | Five migrations applied cleanly in order; new GRANTs migration is the fifth.                                           |

## Findings

### F1 (HIGH) — SPEC.md cites `_known-non-issues.md` NI-007 and NI-008, which do not exist in the registry

- Severity: HIGH
- Source: P1 + P4 (same root cause; merged)
- File:line: `SPEC.md:286` and `SPEC.md:316`
- Finding: Inline notes added in the prior fix-followup commit (4ad6d06)
  reference registry entries `NI-007` and `NI-008` to anchor the
  multi-board UNIQUE issue (Q1) and the no-tenant-filter RLS issue (Q4)
  respectively. The registry currently contains `NI-001` through
  `NI-006` only. Either the references should resolve to actual
  registry entries (which is what an unambiguous `_known-non-issues.md`
  pointer asserts), or the references should not point at registry IDs
  at all. The user's own re-audit prompt mistakenly expected NI-007/008/009
  to exist — corroborating evidence that the dangling references mislead
  readers.
- Evidence:
  ```
  $ grep -n "NI-00[7-9]" SPEC.md
  286:  > constraint when board #2 is added. See `_known-non-issues.md` NI-007
  316:  > `_known-non-issues.md` NI-008.

  $ grep -n "^## NI-" docs/audits/_known-non-issues.md
  18:## NI-NNN: <short title>
  40:## NI-001: ...
  48:## NI-002: ...
  56:## NI-003: ...
  64:## NI-004: ...
  72:## NI-005: ...
  80:## NI-006: ...
  ```
- Verification reasoning: Confirmed both directions — SPEC.md cites
  the IDs; the registry stops at NI-006. The audit-fix workflow
  (`promote-to-non-issue` skill) is the documented path to register
  Q1/Q4 as wont-fix entries; that step never ran. Speculative IDs
  embedded in SPEC.md before the registry was updated is a process
  inversion. Confidence 95 post-verification.
- Confidence: 95

### F2 (HIGH) — `apps/worker-cron/package.json` dev script lacks `--env-file=.env.local`; same fix applied to `apps/worker` was forgotten

- Severity: HIGH
- Source: P4
- File:line: `apps/worker-cron/package.json:9`
- Finding: Commit `c29271a` updated `apps/worker/package.json` to
  `"dev": "tsx watch --env-file=.env.local src/index.ts"` because tsx
  does not auto-load `.env.local`. The worker-cron dev script remains
  `"dev": "tsx watch src/index.ts"`. Both surfaces have identical Zod
  env validators that throw at startup if env vars are missing. A
  developer invoking `pnpm -F worker-cron dev` locally hits the same
  "env missing" failure that the worker fix was authored to prevent.
- Evidence:
  ```json
  // apps/worker/package.json:9
  "dev": "tsx watch --env-file=.env.local src/index.ts",

  // apps/worker-cron/package.json:9
  "dev": "tsx watch src/index.ts",
  ```
  Both `apps/worker/src/env.ts` and `apps/worker-cron/src/env.ts` use
  the same `createEnvValidator(...)` pattern from `packages/shared`;
  both throw at boot on missing vars. `apps/worker-cron/.env.example`
  exists, indicating local-dev support is intended.
- Verification reasoning: Mechanical defect, no design trade-off. The
  cron is designed for local dev (full `.env.example`, 16 passing
  unit tests, identical script shape to worker). The fix is a one-line
  addition mirroring the worker. Confidence 94.
- Confidence: 94

## Questions for human

None this round. The two flagged findings both verified above the
80-confidence floor; nothing graduated to Questions.

## Reopen candidates

None. NI-001..NI-006 all remain sound under this audit's scope.

## What NOT to fix (this audit)

Items intentional per SPEC.md, CLAUDE.md, or the deliberate Slice 2
shape — confirmed sound by this re-audit and **not** to be touched:

- **`grant select` (read-only) rather than `grant all` for `service_role`
  on `publications`/`towns`/`boards`.** The cron and worker only read
  these scaffold tables (their authoring path is operator-via-Studio),
  so SELECT is the minimum viable verb. Verified by P3: code path scan
  found zero INSERT/UPDATE/DELETE against these three tables from any
  service_role surface.
- **No GRANT for `service_role` on `memberships`.** P3 confirmed no
  service_role code path queries `memberships` yet. When an admin or
  operator-review surface lands that needs `memberships`, a follow-up
  migration adds the grant.
- **`verify_jwt = false` only on `asr-webhook`, not on the whole
  `[functions]` block.** The auth shape is per-function; this is the
  only function that exists, and other future functions (e.g.,
  user-facing RPC proxies) may legitimately want JWT verification on.
  Per-function configuration is the correct surface.
- **`speech_models: ['universal-3-pro']` is a tuple-typed literal in
  TypeScript (`['universal-3-pro']`), not a more permissive `string[]`.**
  The narrowing is intentional — only one valid value at v1, and the
  type captures it. P6 confirmed `universal-3-pro` is a valid AssemblyAI
  identifier.
- **No tightening of the migration's GRANT statements with `IF NOT
  EXISTS`-style guards.** Per `NI-002`/`NI-003`, bare DDL is the
  project convention; `GRANT` is idempotent in Postgres so re-running
  against cloud (where the grants already exist from the manual SQL
  hot-fix) is a no-op.
- **No `[functions.asr-webhook] import_map = "..."` declaration in
  `supabase/config.toml`.** The function imports `createClient` from
  `https://esm.sh/...` directly; this is the deliberate Slice 2
  trade-off documented under "What NOT to fix" in the prior audit.

## Suggested fix order

1. **F2 (HIGH, dev ergonomics)** — Add `--env-file=.env.local` to
   `apps/worker-cron/package.json:9` so its dev script mirrors the
   worker. One-line change, no test impact.

2. **F1 (HIGH, doc integrity)** — Resolve the dangling NI-007/NI-008
   references in `SPEC.md`. Two reasonable shapes — pick one in triage:
   - (a) **Promote**: run `promote-to-non-issue` against the prior
     audit's Q1 and Q4, registering them as `NI-007` and `NI-008`
     with explicit Status/Reasoning/Revisit-when fields. This makes
     SPEC.md's references resolve and locks the wont-fix posture.
   - (b) **Rewrite**: drop the `_known-non-issues.md NI-NNN` citation
     style from those SPEC.md notes and replace with prose like
     "tracked as a Slice-N+1 concern" or "see `docs/audits/2026-05-07-slice-2-ingestion.md` Q1/Q4."
     This keeps the registry minimal and avoids speculative IDs.

   (a) is the lower-effort path and matches the established workflow
   (audit → triage → promote → cite). (b) is appropriate only if Q1/Q4
   are no longer "accepted as wont-fix" but rather "tracked work."

## Audit-checklist gaps surfaced by this re-audit

The user explicitly asked: why did three production-only bugs
(AssemblyAI 400 on missing `speech_models`, cron `permission denied for
table boards`, Edge Function 401 from JWT gate) slip past the
2026-05-07 audit? Each maps to a category the audit checklist underweighted:

1. **Cloud-vs-local environment divergence.** All three bugs surface
   only against cloud Supabase / cloud AssemblyAI; local
   `supabase start` is permissive in ways production isn't.
   - The local Supabase CLI grants `service_role` broadly enough that
     the missing scaffold-table GRANTs were never exercised.
   - The local Edge Function runtime does not enforce `verify_jwt`
     the same way; `supabase functions serve` accepts unauthenticated
     requests by default.
   - The mocked `fetch` in `packages/shared/src/asr.test.ts` and
     `apps/worker/src/pipeline/asr-submit.test.ts` accepts whatever
     body shape the code produces; only AssemblyAI's real validator
     enforces `speech_models`.
   - **Recommendation:** add a "cloud contract" pass to the audit
     checklist that asks, for every external surface (vendor APIs,
     cloud auth gates, cloud-side ACLs), "does anything exercise this
     against a real cloud instance, or only against local mocks/CLI?"
     Findings flagged here graduate to the smoke-test list, not the
     fix list.

2. **Implicit defaults at the deploy layer.** `verify_jwt = true` is
   the cloud Edge Function default; not declaring `verify_jwt = false`
   on a webhook receiver is a silent failure mode. The original audit
   read the Edge Function source and verified the X-DulyNoted-Webhook
   gate was correct; it did not check whether the function was
   *reachable* under the cloud auth defaults.
   - **Recommendation:** for any new Edge Function that's a webhook
     receiver, the audit checklist should explicitly verify
     `[functions.<name>] verify_jwt = false` exists in
     `supabase/config.toml`. Same shape applies to any future
     service-role-only RPC: confirm the deploy-layer auth posture
     matches the in-code auth posture.

3. **GRANT coverage at table granularity, not just RPC granularity.**
   The 2026-05-07 audit verified that the RPC functions
   (`claim_pending_meeting`, `auto_promote_for_board`) had `grant
   execute` to `service_role`. It missed that the cron's direct table
   reads (`from('boards')`) needed table-level `GRANT SELECT`
   independently. The lesson: per CLAUDE.md §6, "Every RLS policy must
   be paired with the corresponding table-level GRANT" — but the
   converse also matters: every direct table query from a service-role
   surface needs a GRANT, regardless of whether the table also has
   RLS or RPC paths.
   - **Recommendation:** P3 (schema integrity) should explicitly walk
     every `from('table')` call in `apps/worker*/src/**` and
     `supabase/functions/**/*.ts`, cross-referencing each against
     `GRANT ... TO service_role` in the migration history.

4. **Forward references in spec amendments.** F1 in this audit shows
   a pattern where SPEC.md was amended to cite registry IDs *before*
   those registry entries existed. This is a workflow ordering bug
   that no compliance pass currently checks for.
   - **Recommendation:** any audit pass that touches SPEC.md should
     resolve every `_known-non-issues.md NI-NNN` reference against
     the actual registry. Trivially mechanical (one grep), no
     judgment required.

These four categories should be added to the audit skill's prompt
template (or to a project-specific checklist consulted by P1/P2/P3)
before the next slice's audit.

## Summary

| Bucket                                       | Count |
| -------------------------------------------- | ----- |
| Findings (post-verification)                 | **2** |
| ↳ BLOCKER                                    | 0     |
| ↳ HIGH                                       | 2     |
| ↳ MEDIUM                                     | 0     |
| ↳ LOW                                        | 0     |
| ↳ NIT                                        | 0     |
| Questions for human                          | 0     |
| Reopen candidates                            | 0     |
| Findings dropped by verification             | 0     |
| Findings filtered by `_known-non-issues.md`  | 0     |

The post-smoke fixes themselves landed correctly: `speech_models`
flows through `buildAssemblyAISubmitBody` and is covered by both
test surfaces; the new GRANTs migration applies cleanly and matches
exactly the surface the cron exercises (no over-grant, no
under-grant); `verify_jwt = false` is correctly scoped to
`asr-webhook` only and the function still verifies
`X-DulyNoted-Webhook` before any side effect. The two findings are
adjacent to the fixes, not in them: a half-applied env-file flag
(F2) and dangling registry references in SPEC.md (F1). Both are
small mechanical fixes; neither blocks Slice 3 work. The
process-gap analysis above is the more durable artifact — it names
four audit-checklist patches that would have caught the three
production-only bugs before they hit cloud.
