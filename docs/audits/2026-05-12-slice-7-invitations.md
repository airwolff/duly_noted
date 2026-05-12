---
date: 2026-05-12
scope: Slice 7 — email-keyed invitations + admin members UI
commit_range: de5b62f..304d75c
head_sha: 304d75c66ede5d76d65807bd631e20c803dfea1b
prior_audit: 2026-05-11-slice-6-hybrid-search.md
known_non_issues_consulted: true
audit_method: parallel-subagents-with-verification
passes_run: P1, P2, P3, P4, P5, P6
findings_count: 2
questions_count: 2
findings_dropped_by_verification: 4
findings_filtered_by_known_non_issues: 0
---

# Audit — Slice 7 invitations

Cold-reviewer audit of Slice 7 work since Slice 6 closed. Range
covers 9 commits on the `slice-7-invitations` branch (stacked on
`slice-6-hybrid-search`): spec lock (SPEC.md, CLAUDE.md, apps/web
CLAUDE.md, ADR 0023), invitations migration (table, partial unique
index, trigger function with mandatory exception wrapper, three
SECURITY DEFINER functions, RLS, GRANTs), `invite-user` Edge
Function, login closed-signup flip, middleware RPC integration,
`/{publication.slug}/admin/members` server-component page +
client-component invite form + server action, seven invitations
tests, and a test-only `exec_sql_unsafe` helper in `seed.sql`.

## Mechanical pass results

| Pass | Result | Notes |
| ---- | ------ | ----- |
| `pnpm -r typecheck` | PASS | All 5 workspaces clean. |
| `pnpm -r test` | PASS | 158 tests passed across 27 files (web 37, worker 28, worker-cron 26, shared 56, db 11). New `packages/db/src/invitations.test.ts` adds 7 tests; one (trigger-exception wrapper) gracefully skips if `exec_sql_unsafe` helper absent in seed. |
| `pnpm -r lint` | PASS | All 5 workspaces clean. |
| `pnpm format:check` | PASS | Repo-wide Prettier clean. |
| `git diff --shortstat de5b62f..HEAD` | 15 files, 1404 / -15 | 9 added (3 admin route files, Edge Function, migration, seed helper, test, ADR), 6 modified (SPEC, root CLAUDE.md, web CLAUDE.md, login page, middleware, types.ts, config.toml). |
| TODO/FIXME/XXX grep (changed files) | clean | none. |
| `console.*` grep (non-worker, non-edge) | expected | `apps/web/middleware.ts:38` (`console.warn` for RPC failure — doc'd posture) and `apps/web/src/app/[publication]/admin/members/actions.ts:49` (`console.error` for fetch failure). Both are server-side log lines, not client-bundled. |
| Hardcoded URL grep | expected | Only `https://esm.sh/zod@3.23.8` and `https://esm.sh/@supabase/supabase-js@2.105.3` in the new Edge Function — exact-match with `search/index.ts` and `asr-webhook/index.ts` import style. |
| Secret-shaped strings | clean | none. |
| File size | clean | Largest new source file is the migration at 196 LOC (mostly SQL). Largest new TS file is `invitations.test.ts` at 272 LOC. No new source file > 500 LOC. types.ts grew from 345 → 389 LOC (+44 for invitations Row/Insert/Update + 2 RPC types). |
| Test ratio | balanced | 6 new/modified source files; 1 new test file (`invitations.test.ts`, 7 scenarios). The Edge Function `invite-user/index.ts` has no unit tests — consistent with the `asr-webhook` and `search` Edge Function precedent (no Edge Function test harness exists). The admin page + form + server action are exercised end-to-end via the manual sweep documented in the slice's plan; no unit tests added. |

## Findings

### F1 — `check_invite_conflicts` RPC ships in the migration but is not enumerated in SPEC §"Slice 7 schema deltas"

- **Severity:** LOW
- **Source:** P1 (SPEC compliance)
- **File:line:** `supabase/migrations/20260512155552_slice_7_invitations_schema.sql:155-196`
- **Finding:** The Slice 7 migration declares a third SECURITY DEFINER function, `public.check_invite_conflicts(p_email text, p_publication_id uuid)`, with a service_role-only EXECUTE grant. SPEC §"Slice 7 schema deltas" preamble (line 584) enumerates the additive surface as "new `invitations` table, new trigger function and trigger on `auth.users`, new `resolve_pending_invitations()` RPC" — three items. SPEC §"Edge Function `invite-user`" step 4 (line 757) describes the conflict check inline ("existing membership for (email, publication_id) → return 409 ...; existing open invitation ...") without naming or alluding to a database RPC. ADR 0023 also makes no mention. The implementation is sound (revokes from PUBLIC, grants only to service_role, security definer with pinned `search_path = public, auth`, encapsulates the otherwise-PostgREST-inaccessible `auth.users` lookup), and the slice plan flagged this as a deliberate deviation, but the schema-level surface is undocumented in SPEC.
- **Evidence:**
  ```sql
  -- migration lines 155-183
  create or replace function public.check_invite_conflicts(
    p_email text,
    p_publication_id uuid
  )
  returns text
  language sql
  security definer
  set search_path = public, auth
  as $$
    select case
      when exists (
        select 1
          from public.memberships m
          join auth.users u on u.id = m.user_id
         where lower(u.email) = lower(p_email)
           and m.publication_id = p_publication_id
      ) then 'already_member'
      when exists (
        select 1
          from public.invitations
         where email = lower(p_email)
           and publication_id = p_publication_id
           and accepted_at is null
           and revoked_at is null
           and expires_at > now()
      ) then 'invitation_pending'
      else 'ok'
    end;
  $$;
  ```
  Plus the grant block at lines 195-196 (`grant execute on function public.check_invite_conflicts(text, uuid) to service_role;`).
- **Verification reasoning:** Verifier confirmed `check_invite_conflicts` returns zero hits on `grep` of SPEC.md and ADR 0023. SPEC's preamble enumeration is framed as the complete list of additive functions, not "including but not limited to." The Edge Function spec at step 4 reads as if the conflict check is two PostgREST queries inline, not an RPC. Verifier dropped confidence from 90 to 85 on the basis that "preamble enumeration as 'highlights' rather than 'exhaustive'" is a strained but available reading.
- **Confidence:** 85
- **Fix shape:** Either (a) update SPEC §"Slice 7 schema deltas" to enumerate the four new functions (trigger, resolve_pending_invitations, check_invite_conflicts, plus the test-only `exec_sql_unsafe` in seed) and the grant block to match the migration; or (b) refactor the Edge Function to do the conflict check via two inline queries (would require exposing `auth.users` to PostgREST or using `auth.admin.listUsers()` + JS filter, both worse than the current RPC). Option (a) is the operationally cheap path.

### F2 — Middleware calls `resolve_pending_invitations()` on every authenticated request, not on session establishment as documented

- **Severity:** LOW
- **Source:** P1+P3 (SPEC compliance + schema integrity, dedup'd)
- **File:line:** `apps/web/middleware.ts:29-41`
- **Finding:** The middleware fires `resolve_pending_invitations()` for every authenticated non-asset request, but SPEC §"Stage 7 — auth subset" (line 729), SPEC §"Slice 7 schema deltas" (line 657), apps/web/CLAUDE.md §3 (lines 39-43), and ADR 0023 §Consequences (lines 216-218) consistently describe the call as occurring on "session establishment" / "session-cookie-refresh transitions" — distinct from "every non-asset request" (which CLAUDE.md §3 reserves as the phrasing for the cookie refresh in the immediately preceding bullet). The call site gates only on `data.user` being truthy and does not detect "new session" vs "reused session" nor "token-refresh transition." Practical amplification: a user browsing 100 pages generates ~100 RPC round trips instead of the doc-implied ~1-2. The RPC is a single idempotent SELECT (early-returns 0 for users with no open invitations), so absolute cost remains low at v1 volume of <50 users — which is why severity is LOW — but the doc-vs-code gap will mislead future audits and SECURITY DEFINER exposure-surface analysis.
- **Evidence:**
  ```ts
  // apps/web/middleware.ts:29-41
  const { data } = await supabase.auth.getUser();
  if (data.user) {
    // Slice 7: defense-in-depth for the case where the user already
    // existed in auth.users when an admin invited them (no INSERT
    // event for the trigger to fire on). Idempotent; no-op for users
    // with no open invitations. Logged but never blocks the request —
    // same posture as the trigger's RAISE WARNING wrapper.
    const { error: resolveError } = await supabase.rpc('resolve_pending_invitations');
    if (resolveError) {
      console.warn('middleware: resolve_pending_invitations failed', resolveError);
    }
    return response;
  }
  ```
  ```
  # SPEC.md §Slice 7 schema deltas line 657
  Called from `apps/web/middleware.ts` on session establishment
  (idempotent; no-op for users with no matching open invitations).

  # apps/web/CLAUDE.md §3 lines 39-43
  Middleware additionally calls `resolve_pending_invitations()` on
  session establishment (Slice 7+). The RPC is idempotent and no-ops
  for users with no matching open invitations; the call adds one
  round-trip on session-cookie-refresh transitions and is acceptable
  at v1 volume.

  # ADR 0023 §Consequences
  `apps/web/middleware.ts` calls `resolve_pending_invitations()` on
  session establishment. Idempotent; one extra round trip on
  session-refresh transitions, negligible at v1 volume.
  ```
  Middleware matcher (line 53) excludes only Next.js statics/images, so the middleware runs on every page navigation, server action, and API hit.
- **Verification reasoning:** Verifier confirmed via direct file reads of all four cited locations and the matcher regex. CLAUDE.md §3 explicitly contrasts "session establishment" with the cookie-refresh-on-every-request behavior in the immediately preceding bullet, so "every request" is clearly outside the doc's scope by construction. The implementation gap is real, not phrasing ambiguity. Confidence raised from 85 (initial) to 88 after verifier read all four reference points and the matcher.
- **Confidence:** 88
- **Fix shape:** Either (a) gate the RPC call to fire only when the cookie was actually refreshed by the middleware (e.g., compare cookie `value` before/after `getUser()` and only fire if changed), which preserves the doc-described cadence; or (b) use a request-scoped cookie/header flag set at first call to short-circuit subsequent calls within the same session; or (c) update SPEC, ADR 0023, and apps/web/CLAUDE.md §3 to acknowledge the per-request cadence and re-do the cost framing. Option (a) matches the spec text's intent and avoids ~50× DB amplification per active user; option (c) is the doc-side-only fix.

## Questions for human

### Q1 — Should CLAUDE.md §6's SECURITY-DEFINER-from-authenticated rule carve out a documented exception for self-scoped, count-only RPCs?

- **Question:** `public.resolve_pending_invitations()` is declared `SECURITY DEFINER` and granted `EXECUTE TO authenticated`, then invoked from `apps/web/middleware.ts` (an authenticated user surface). The literal text of CLAUDE.md §6's hard rule says "RPCs called from authenticated user surfaces ... must NOT use `SECURITY DEFINER`. ... Worker-only RPCs (claim/complete/abandon trios) may use `SECURITY DEFINER` because the worker is service-role and the policy boundary is irrelevant; this is the only safe place for that escalation." The function structurally *needs* SECURITY DEFINER (it reads `auth.users.email` which `authenticated` cannot SELECT, and writes `public.memberships` which the Slice 5 RLS would block under `authenticated` role), it is structurally self-scoped via `auth.uid()` (no input parameter can escalate scope), and it returns only an integer count — none of the membership-aware-RLS-on-tables concern the rule's stated rationale cites applies. SPEC §"Slice 7 schema deltas" (lines 645-655) explicitly specifies this RPC as `security definer` with grant to `authenticated`, and ADR 0023 documents the design as accepted. The literal rule and the ratified spec are in tension. Should the rule be amended to carve out the "self-scoped via `auth.uid()` with no row data returned" case (and if so, with what guardrails), or should the spec/migration be redesigned to move the privileged work into the `invite-user` Edge Function (matching the rest of the admin-API pattern)?
- **Evidence:**
  - Migration: `create or replace function public.resolve_pending_invitations() returns int language plpgsql security definer set search_path = public, auth ... grant execute on function public.resolve_pending_invitations() to authenticated;`
  - Caller: `apps/web/middleware.ts:36` `const { error: resolveError } = await supabase.rpc('resolve_pending_invitations');`
  - SPEC §"Slice 7 schema deltas" lines 645-691 ratify SECURITY DEFINER + authenticated grant.
  - ADR 0023 §Decision lists the RPC as part of the chosen design.
  - CLAUDE.md §6 rule is unconditional ("must NOT", "the only safe place").
- **Why this needs human input:** The rule is a ratified hard rule; the spec is also ratified; both can't be right without an explicit carve-out. The decision is whether to amend CLAUDE.md (cheap; documents an exception with bounded preconditions: identity-bound via auth.uid(), no input-parameter scope escalation, no row data returned, only writes scoped to caller's auth.uid()) or to rebuild the resolve flow as an Edge Function (more work, removes the rule violation, but adds another Edge Function deployment surface and rewires the middleware to make a fetch call instead of a DB RPC). Verifier's read: the SPEC + ADR pre-ratify the design, so this is documentation-gap-not-defect, but the surface-text contradiction is real and should be resolved.
- **Verification confidence:** 18 (verifier disproved the "violation" framing on the basis that SPEC and ADR pre-ratify; routes to Questions because verifier set `should_be_question_not_finding: true`).

### Q2 — `resolve_pending_invitations()` reads caller email from `auth.users` (safer); SPEC prescribes `auth.jwt() ->> 'email'`. Update SPEC to match impl, or impl to match SPEC?

- **Question:** SPEC §"Stored procedure `public.resolve_pending_invitations()`" line 655 explicitly prescribes: "Reads `auth.uid()` and `auth.jwt() ->> 'email'`." The implementation at lines 119-124 instead reads from `auth.users` directly with an inline comment justifying the deviation: `-- Read email from auth.users (not from JWT app_metadata) so a stale JWT cannot misidentify the caller's email. select email into caller_email from auth.users where id = caller_uid;`. The implementation choice is technically safer — JWT claims are a point-in-time snapshot (up to 1-hour TTL by default), while `auth.users.email` is the current authoritative value, mutable via Supabase's email-change flow within that window. ADR 0023's "Why Option B over Options C and D" section (lines 110-118) cites the same JWT-freshness concern as a key architectural driver. Should SPEC be updated to ratify the safer impl, or should the impl be changed to match SPEC's literal prescription?
- **Evidence:**
  - SPEC.md line 655: "Reads `auth.uid()` and `auth.jwt() ->> 'email'`."
  - Migration lines 119-124: `select email into caller_email from auth.users where id = caller_uid;`
  - ADR 0023 lines 110-118 cite JWT-freshness as the architectural concern that drove the broader Option B over Option C decision (membership lookup in DB rather than JWT claims).
- **Why this needs human input:** The deviation is intentional and defensible; the question is whether SPEC should be updated to encode the safer pattern or whether the impl should match the literal prescription. There's no security or user-visible impact either way at v1 (no email-change UI ships at v1, so the JWT-freshness gap is effectively zero). Verifier's read: impl is arguably more correct than SPEC; the right resolution is operator-decided.
- **Verification confidence:** 70 (verified=true, but verifier flagged should-be-question because the impl is defensibly more correct than SPEC; and confidence dropped below 80 floor → routes to Questions).

## Reopen candidates

None. NI-009 (packages/shared schemas not yet imported by Edge Functions) remained the established pattern for this slice — the new `invite-user` Edge Function inlines its own Zod schema like `asr-webhook` and `search` before it. NI-009 is already flagged as Triggered with a separate resolution slice queued; this audit does not raise it again.

## What NOT to fix (this audit)

Items intentional per SPEC, CLAUDE.md, or ADR — and findings dropped by verification — with citation. These are recorded as "verified as intentional" so they are not re-raised in future audits:

- **`handle_new_auth_user` and `resolve_pending_invitations` compare emails case-sensitively** without `lower()` on the right-hand side. Verified intentional: SPEC.md line 602 explicitly notes `auth.users.email` has been gotrue-normalized lowercase since gotrue PR #110 (2021); SPEC line 630 specifies exact-equality (no `lower()`); SPEC line 775 documents the dependency with a revisit trigger ("any Supabase changelog entry touching the schema of `auth.users.id`, `auth.users.email`, or modifying the auth subsystem's transactional INSERT semantics"). Adding defensive `lower()` would diverge from the documented design.
- **No FK-side index on `invitations.invited_by_user_id`.** Verified intentional: SPEC §"Slice 7 schema deltas" lines 608-622 enumerate exactly two indexes for `invitations` (the partial unique on (email, publication_id) WHERE open, and the FK-side index on publication_id). SPEC.md line 580 explicitly acknowledges the codebase convention is "index load-bearing FKs; defer the rest" — `towns.publication_id`, `boards.town_id`, `memberships.user_id`, and `memberships.publication_id` are all un-indexed by the same convention. `invited_by_user_id` is touched only on a rare ON DELETE SET NULL cascade when an admin is removed from auth.users; not load-bearing at v1 volume.
- **`accepted_at` is set on every matched invitation, including those whose membership INSERT was suppressed by `ON CONFLICT DO NOTHING`.** Verified intentional: SPEC §"Slice 7 schema deltas" point 2 (line 631) explicitly anticipates this case ("The ON CONFLICT clause is idempotent across re-runs and tolerates the case where a user already has a membership for that publication (e.g., previously invited via a different path)"); point 3 prescribes the literal SQL the migration uses verbatim. ADR 0023 frames `accepted_at` as audit-trail ("invitation consumed/processed"), not as "produced new membership row." The pending-list page query treats `accepted_at IS NOT NULL` as "no longer pending," which the conflict-skip case satisfies (the user has the access the invitation would have granted).
- **Trigger function exception wrapper uses an extended format string** (`'handle_new_auth_user: failed for user_id=%, email=%, error=%'`) instead of the CLAUDE.md §6 template's exact `'function-name: failed, error: %'`. Verified intentional/equivalent: the rule's stated rationale targets two invariants — signup safety (RAISE WARNING not EXCEPTION; RETURN NEW) and observability (function-name prefix + SQLERRM in Postgres logs). Both are preserved; the extra positional args (NEW.id, NEW.email) strictly enrich the log line. Treating extra debug context as a deviation is over-reading the template.

Items intentional per spec/CLAUDE/ADR (load-bearing convention recognition, not finding-derived):

- **Bare CREATE-side DDL (no `IF NOT EXISTS` on table/index/policy)** — accepted via NI-003. Migration follows convention.
- **No `revoke all on table public.invitations from public`** before grants — convention does not require it; per-table privileges to public are not enabled by default in Postgres 15/16.
- **Edge Function inlines its own Zod schema** rather than importing from `packages/shared` — accepted via NI-009 (Triggered for resolution in a separate slice).
- **`InviteResult` exported from `actions.ts` but only consumed within the same module pair** — accepts the speculative-export pattern per NI-018, NI-019, NI-020, NI-021.

## Suggested fix order

1. **Q1 first** (SECURITY DEFINER carve-out decision). The decision shape — amend CLAUDE.md vs. redesign as Edge Function — bounds the exposure surface analysis for F2 (per-request RPC cadence). If the redesign path is chosen, F2 changes meaning (the per-request cost moves to the Edge Function and the SECURITY DEFINER question dissolves).
2. **F2** (middleware cadence) — fix the cadence (option a/b) or update the docs (option c). Either direction restores the docs ↔ code coherence.
3. **F1** (SPEC enumeration of `check_invite_conflicts`) — pure docs amendment. Could land in the same SPEC update as Q1's CLAUDE.md amendment if Q1 routes to the doc-amendment path.
4. **Q2** (email-source SPEC text) — pure SPEC update or pure migration follow-up; small, low-risk either way; sequence after Q1 because the same SPEC §Slice-7 section is touched.

## Summary

| Bucket | Count |
| ------ | ----- |
| Findings (BLOCKER) | 0 |
| Findings (HIGH) | 0 |
| Findings (MEDIUM) | 0 |
| Findings (LOW) | 2 |
| Findings (NIT) | 0 |
| Questions | 2 |
| Reopen candidates | 0 |
| Findings dropped by verification | 4 |
| Findings filtered by NI registry | 0 |

Slice 7 is structurally clean: all gates pass (typecheck, 158 tests, lint, format), no BLOCKER/HIGH/MEDIUM defects survive verification, the migration is purely additive and backwards-compatible, the trigger wrapper preserves signup safety, GRANTs match RLS policies on the new surface, and 7 new tests cover the happy path, four adversarial cases, the trigger-exception wrapper, and `resolve_pending_invitations` idempotency. The two Findings and two Questions are all spec-vs-impl coherence issues — none are runtime defects.
