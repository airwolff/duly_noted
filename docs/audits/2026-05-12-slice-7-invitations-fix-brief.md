# Fix Brief — Slice 7 invitations

- **Source audit:** `docs/audits/2026-05-12-slice-7-invitations.md`
- **Triage date:** 2026-05-12
- **Triaged by:** Claude project (duly_noted)

## Outcome summary

All 2 findings and 2 questions triaged. 4 fix-now items (all doc/rule
amendments + 1 code fix). 0 deferred. 0 accepted as wont-fix.
No wont-fix promotions required; no `promote-to-non-issue` skill run needed.

---

## Fix-now items

### Work stream A — Code

#### A1 — Gate `resolve_pending_invitations()` on cookie refresh (F2)

**File:** `apps/web/middleware.ts:29-41`

**What the audit found:** The middleware fires `resolve_pending_invitations()`
on every authenticated non-asset request. SPEC, ADR 0023, and
apps/web/CLAUDE.md §3 all describe the call as occurring on "session
establishment" / "session-cookie-refresh transitions." At <50 users the
absolute cost is negligible (the RPC is a fast idempotent SELECT that
early-returns 0 with no open invitations), but the cadence is ~50×
what the docs imply and will mislead future audits.

**Decision:** Fix (option a from audit) — gate on cookie having actually
refreshed.

**CC instructions:**

Detect whether the Supabase SSR helper wrote a new `Set-Cookie` header
during `getUser()` and fire `resolve_pending_invitations()` only when
it did. Concrete approach:

1. Before calling `supabase.auth.getUser()`, capture the current
   response cookie string for the Supabase session key.
2. After `getUser()` returns, compare the response cookie to the
   captured value. The `@supabase/ssr` `createServerClient` callback
   writes a new cookie value when the token rotates.
3. Fire `supabase.rpc('resolve_pending_invitations')` only if the
   cookie value changed (token actually refreshed) AND `data.user`
   is truthy.
4. Keep the existing `console.warn` on RPC error and the
   never-blocks-request posture.

After the fix, the RPC fires at most once per token rotation interval
(default 1 hour in Supabase), matching the doc-described cadence.

Verify: a user browsing multiple pages in a session should produce
exactly one `resolve_pending_invitations` call at token rotation, not
one per page load. A fresh session (first request) should also fire
once.

---

### Work stream B — Documentation / spec amendments

All four items below can land in a single commit. Suggested edit order
matches the audit's recommended fix order.

#### B1 — CLAUDE.md §6: add SECURITY DEFINER carve-out (Q1)

**File:** `CLAUDE.md` §6

**What the audit found:** The hard rule ("RPCs called from authenticated
user surfaces must NOT use SECURITY DEFINER ... this is the only safe
place for that escalation") is in direct textual conflict with the
ratified design of `resolve_pending_invitations()`, which is SECURITY
DEFINER, granted to `authenticated`, and called from middleware. SPEC
§"Slice 7 schema deltas" and ADR 0023 pre-ratify the design. The rule
needs a bounded carve-out.

**Decision:** Amend CLAUDE.md §6. Rule stays hard for the general case;
add explicit carve-out for self-scoped SECURITY DEFINER RPCs.

**CC instructions:**

In CLAUDE.md §6, after the existing "must NOT use SECURITY DEFINER"
prohibition and before or after the worker-only exception sentence, add
a carve-out paragraph along these lines:

> **Exception — self-scoped SECURITY DEFINER RPCs.** A SECURITY
> DEFINER RPC may be granted `EXECUTE TO authenticated` when all three
> conditions hold: (1) the function takes no input parameters that
> could expand the scope of its reads or writes beyond the calling
> user's own data; (2) all reads and writes inside the function are
> bounded to `auth.uid()` (the authenticated caller's identity); and
> (3) the function returns no row data to the caller (integer count or
> void only). `public.resolve_pending_invitations()` is the canonical
> example: it reads `auth.users.email` (inaccessible to `authenticated`
> directly) and writes `memberships` (blocked by RLS under
> `authenticated`), but both operations are scoped exclusively to the
> caller's own record and the function returns only an integer count.
> Any future RPC that does not meet all three conditions must use the
> Edge Function path.

Preserve the existing worker-only carve-out sentence; the new
paragraph is additive.

#### B2 — SPEC §"Slice 7 schema deltas": enumerate `check_invite_conflicts` (F1)

**File:** `SPEC.md` §"Slice 7 schema deltas" — preamble and function list

**What the audit found:** SPEC's preamble enumerates three new additive
items; the migration ships four new functions. `check_invite_conflicts`
(SECURITY DEFINER, service_role-only EXECUTE grant) is present in the
migration but absent from SPEC. The Edge Function spec at step 4
describes the conflict check as inline queries rather than an RPC.

**Decision:** Update SPEC to enumerate all four new functions.

**CC instructions:**

1. In the preamble sentence of §"Slice 7 schema deltas" (currently:
   "Additive: new `invitations` table, new trigger function and trigger
   on `auth.users`, new `resolve_pending_invitations()` RPC"), extend
   the enumeration to include `check_invite_conflicts(p_email text,
   p_publication_id uuid)` and note the test-only `exec_sql_unsafe`
   helper in `seed.sql` is also additive (seed-only, not in a
   migration).

2. Add a short prose block after the `resolve_pending_invitations`
   description documenting `check_invite_conflicts`: purpose (conflict
   pre-check before the Edge Function calls `inviteUserByEmail`),
   return type (`text`: `'ok'`, `'already_member'`,
   `'invitation_pending'`), SECURITY DEFINER rationale (needs to join
   `auth.users` which is inaccessible to PostgREST queries from
   `authenticated` or `service_role` via the REST API), grant
   (`service_role` only — called only from the Edge Function, never
   from an authenticated user surface).

3. In §"Edge Function `invite-user`" step 4, replace the inline-query
   description with a reference to the `check_invite_conflicts` RPC.

#### B3 — SPEC §"Stored procedure `public.resolve_pending_invitations()`": update email-source (Q2)

**File:** `SPEC.md` §"Stored procedure `public.resolve_pending_invitations()`" line 655

**What the audit found:** SPEC prescribes "Reads `auth.uid()` and
`auth.jwt() ->> 'email'`." The migration reads from `auth.users`
directly (`SELECT email FROM auth.users WHERE id = caller_uid`) with
an inline comment citing JWT-staleness as the rationale. The impl is
more correct than SPEC — consistent with the JWT-freshness concern that
drove ADR 0023's B-over-C decision.

**Decision:** Update SPEC to match impl.

**CC instructions:**

At SPEC.md line 655, change:

> Reads `auth.uid()` and `auth.jwt() ->> 'email'`.

to:

> Reads `auth.uid()` and resolves the caller's email from `auth.users`
> directly (`SELECT email FROM auth.users WHERE id = auth.uid()`),
> not from `auth.jwt() ->> 'email'`. JWT claims are a point-in-time
> snapshot (up to 1-hour TTL); reading from `auth.users` ensures the
> current authoritative email is used even if the JWT has not yet
> refreshed after an email change. Consistent with ADR 0023 §"Why
> Option B over Options C and D."

---

## Wont-fix items

None. No entries to promote to `_known-non-issues.md`.
