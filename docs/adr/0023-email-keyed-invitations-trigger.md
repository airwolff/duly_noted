# 0023. Email-keyed invitations resolved via auth.users trigger

Date: 2026-05-12
Status: Accepted

## Context

Slice 5 closed the multi-tenant RLS gates: every authenticated user
must have a row in `memberships` for the publication they want to read.
Until Slice 7, the only way a membership row appeared was a manual SQL
`INSERT` keyed by `user_id`, which means the row could not be created
until after the user had completed a magic-link round-trip (at which
point `auth.uid()` resolves to a real `auth.users.id`). This forced an
operational sequence: invite the user → wait for them to sign in →
inspect `auth.users` → SQL-insert the membership with the resolved
`user_id`. The publication operator (Aaron) cannot self-serve through
this sequence because he lacks both `service_role` access and the
mechanical attention required to monitor first sign-ins.

Slice 7 introduces an invitation-based path that removes the
user_id-required coupling. The slice also brings forward enough of
Backlog B4 to give the publication operator self-service admin
ability without an admin chokepoint at the developer.

Three architectural choices needed resolution:

1. **How to record an invitation that resolves at first sign-in.**
2. **Where the privileged `inviteUserByEmail` call executes.**
3. **Whether to leave open signup on the magic-link form, or close it
   to invitation-only entry.**

## Considered options

### For invitation recording

- **Option A: Pending state on the `memberships` table.** Add nullable
  `email` column, nullable `user_id`, CHECK constraint enforcing
  exactly one of the two is set, partial unique indexes scoped on each
  state. Trigger on `auth.users` INSERT updates pending rows in place
  to assign `user_id`.
- **Option B: Separate `invitations` table.** New table with `email`,
  `publication_id`, `role`, `expires_at`, `accepted_at`, `revoked_at`.
  Memberships table unchanged. Trigger reads invitations and writes
  memberships at first sign-in.
- **Option C: Custom Access Token Hook injecting membership into the
  JWT.** No DB resolution at sign-in; membership is a JWT claim. RLS
  reads from `auth.jwt() -> 'app_metadata' -> 'memberships'`.
- **Option D: Callback-handler-side resolution from `/auth/callback`.**
  No trigger. The web app's session-establishment code performs the
  insert into memberships.

### For privileged API execution surface

- **Option E: Server action in `apps/web` holds `SUPABASE_SERVICE_ROLE_KEY`.**
  The Cloudflare Pages env gains the service-role key; server actions
  call `auth.admin.inviteUserByEmail` directly.
- **Option F: Edge Function `invite-user` mediates.** Web layer POSTs
  with the user's JWT; Edge Function holds service-role exposure and
  calls the privileged API.

### For signup posture

- **Option G: Open signup (`shouldCreateUser: true`).** Unmatched
  emails sign up and land at no-membership state.
- **Option H: Closed signup (`shouldCreateUser: false`).** Only emails
  with existing `auth.users` rows can request a magic link.

## Decision

**Option B (separate invitations table) + Option F (Edge Function
intermediation) + Option H (closed signup) + minimal admin UI in the
same slice.**

The combination ships: an `invitations` table with token-free
email-keyed resolution, an `AFTER INSERT ON auth.users` `SECURITY
DEFINER` trigger that resolves matching invitations into memberships,
a `resolve_pending_invitations()` RPC as defense-in-depth for the
"user already existed when invited" edge case, an `invite-user` Edge
Function that re-verifies admin role and calls `inviteUserByEmail`,
and a thin admin route at `/{publication.slug}/admin/members` with an
invite form and a pending-invitations list view.

## Rationale

### Why Option B over Option A

The memberships table remains semantically clean: every row represents
an active grant, no "is this row pending or active?" check on every
query. The Slice 5 RLS policies on memberships do not need to filter
out pending rows — they would have had to under Option A.

A separate invitations table gives natural TTL (`expires_at`),
revocation (`revoked_at`), and audit trail (`accepted_at`,
`invited_by_user_id`). Option A's mutation-in-place pattern destroys
audit history. Forward compatibility with the residual B4 admin
surfaces (revoke UI, resend UI, audit log) is built-in.

The marginal cost is one extra table and ~30 lines of additional
migration SQL. The benefits compound across the lifetime of every
future membership query.

This matches the dominant 2025 Supabase SaaS pattern. Makerkit's
current Next.js Supabase Turbo kit, the Comp AI platform, and the
SaaS Kit reference architecture all use a separate invitations table.
Makerkit's earlier Remix kit used Option A; the migration to Option B
in Makerkit's newer kit is informative.

### Why Option B over Options C and D

**Option C (Custom Access Token Hook injecting JWT claims)** is the
Supabase-recommended pattern for RBAC, but it inherits the documented
JWT-freshness problem: changes to membership do not propagate until
the JWT refreshes (up to 1 hour). For invitation resolution this is
acceptable, but for any future "remove a user from a publication"
operation it creates an authorization-staleness window. Reading
memberships from the database via `auth.uid()` is fresh on every
request. The slice avoids the JWT-claim path entirely and keeps
membership lookups in Postgres.

**Option D (callback-handler-side resolution)** moves the trigger work
into the web app's session-establishment code. This requires service
role access from `apps/web` (rejected per CLAUDE.md §6) or an
unprivileged RPC that the user calls. Option D also opens a race
window between session establishment and membership resolution where
the user briefly lands at no-membership state. The trigger fires
atomically inside the `auth.users` INSERT transaction, eliminating
the race.

### Why Option F over Option E

Option E breaks the cross-surface lock from CLAUDE.md §6:
`SUPABASE_SERVICE_ROLE_KEY` never reaches Cloudflare Pages. The lock
was established to bound blast radius if the web layer is
compromised (XSS, dependency-chain attack, server-action vulnerability,
etc.); breaking it for one admin operation creates pressure to break
it for the next.

Option F preserves the lock. The new `invite-user` Edge Function
matches the existing surface placement of `asr-webhook` (webhook
receiver) and `search` (user-facing privileged operation). The web
layer forwards the user's JWT; the Edge Function re-verifies
admin-role membership server-side before any privileged call. Defense
in depth: the web layer's role check is the first gate, the Edge
Function's recheck is the second.

The marginal cost of the new Edge Function is one TypeScript file,
one route declaration in `supabase/config.toml` (with `verify_jwt =
true`), and one redeploy step in CI.

### Why Option H over Option G

With the admin invite surface shipping in this slice, closed signup
becomes coherent: every user who can reach the system has been
explicitly invited, and the no-membership edge case (Stage 8) is
bounded to invited-then-revoked rather than open-to-anyone-on-the-internet.

Option G's open signup was acceptable when the SPEC said "no auto-grant
on signup; reader pages render empty for unmatched users." That stance
is structurally safe (RLS protects published content from non-members)
but operationally noisy: random visitors can flood `auth.users` with
no recourse short of an admin user-management UI to delete them.
Closing signup at the `signInWithOtp` call eliminates the noise floor.

The cost of Option H is one boolean flip (`shouldCreateUser: false`)
plus an error-copy update on the login page directing unrecognized
emails to contact their administrator.

### Trigger defensiveness

The trigger function `handle_new_auth_user()` MUST wrap its body in
`EXCEPTION WHEN OTHERS THEN RAISE WARNING ...; RETURN NEW;`. A raised
exception in an `auth.users` trigger rolls back the auth subsystem's
INSERT transaction and blocks signup with a misleading "Database
error saving new user" response. This failure mode is reported across
multiple Supabase GitHub issues (most recently `supabase/supabase#37497`
in 2025) and remains a real production hazard. The exception wrapper
makes the failure mode survivable: the user signs in with no
membership, lands at the standard no-membership edge case, and an
admin can resolve manually.

The wrapper's `RAISE WARNING` provides observability without raising.
Failures appear in Supabase Postgres logs.

The decision to use `SECURITY DEFINER` (rather than the explicit
`supabase_auth_admin` grant pattern that Supabase's Auth Hooks docs
recommend) is scoped to triggers specifically: hooks run as
`supabase_auth_admin` natively, but triggers on `auth.users` need
public-schema permissions that `supabase_auth_admin` does not have.
The Supabase troubleshooting page for "errors when creating users"
explicitly documents `SECURITY DEFINER` as the working template for
this trigger surface.

### Bootstrap path uniformity

The initial bootstrap of Aaron's admin membership goes through the
same invitations path as every subsequent invitation. Andy runs one
SQL `INSERT INTO invitations(email='aaron@...', publication_id=midcoast,
role='admin', invited_by_user_id=null)` plus one `inviteUserByEmail`
SDK call from a local script. Aaron clicks his magic link, the trigger
resolves the invitation, Aaron is admin. From that point onward, Aaron
issues all further invitations through the admin form.

No special-case path. No direct membership inserts. The trigger is
the only thing that writes to `memberships.user_id` outside of the
worker's service_role path (which does not touch memberships at v1).

## Consequences

- New surface: `invitations` table, `handle_new_auth_user()` trigger
  function and trigger, `resolve_pending_invitations()` RPC,
  `invite-user` Edge Function, `/{publication.slug}/admin/members`
  route.
- The login form now passes `shouldCreateUser: false`. Random emails
  receive a generic auth error; copy directs them to contact an
  administrator.
- `apps/web/middleware.ts` calls `resolve_pending_invitations()` on
  session establishment. Idempotent; one extra round trip on
  session-refresh transitions, negligible at v1 volume.
- `auth.users` is a Supabase-managed schema. The trigger function
  depends on the stable shape of `auth.users.id` (uuid) and
  `auth.users.email` (lowercase text), plus the existence of an
  INSERT event on row creation. If Supabase changes the auth
  subsystem's transactional semantics or schema, the trigger needs
  revisiting.
- Memberships table shape, Slice 5 RLS policies, and Stage 8 reader
  paths are unchanged. The slice is additive on every surface other
  than the login form's `shouldCreateUser` flag and the new admin
  route.
- The narrowed Backlog B4 covers the residual admin surfaces (member
  list, role change, removal, revoke/resend, audit log, operator
  review). Each is real but none blocks the demo or the pre-launch
  test sweep.

## Revisit triggers

- **Supabase changes `auth.users` schema or auth-subsystem
  transactional semantics.** Trigger and RPC may need rework.
  Subscribe to Supabase changelog entries touching the auth schema.
- **Scale forces tenant-list-in-JWT for performance.** If a future
  scale point (10K+ users per publication, or many publications per
  user) makes the per-request `IN (SELECT publication_id FROM
  memberships WHERE user_id = auth.uid())` subquery costly, migrating
  the membership lookup to a Custom Access Token Hook claim becomes
  the path. The JWT-freshness tradeoff would then need a parallel
  decision about membership-change propagation. Not anticipated at
  v1 scale (single tenant, <50 users).
- **Open signup becomes desirable.** If duly_noted ever opens a
  public reader surface (which is currently locked out), the closed
  signup decision reverts and the invitation-only entry path becomes
  one of several entry paths rather than the only one.
- **Service-role access for admin operations becomes friction.** If
  the Edge Function indirection becomes a development bottleneck for
  the residual B4 admin surfaces (member list, role change, removal),
  the alternative is moving service-role access into a server-only
  Next.js runtime that is not shipped to Cloudflare Pages — distinct
  surface, distinct deployment topology, larger architectural change.
  Until that pressure is real, the Edge Function path holds.

## Related

- SPEC.md §"Slice 7 schema deltas" — schema, trigger, RPC, RLS, grants.
- SPEC.md §"Stage 7 — auth subset" — invitations and admin onboarding
  subsection.
- SPEC.md §"Stage 8 — Reader UI" — URL table addition for
  `/{publication.slug}/admin/members`.
- SPEC.md §Backlog B4 — narrowed scope post-Slice-7.
- CLAUDE.md §6 — defensive `auth.users` triggers rule and Edge
  Function intermediation rule.
- `apps-web-CLAUDE.md` §2/§3/§7 — admin route conventions, admin role
  check, admin scope.
- ADR 0009 — async webhook receiver pattern in Edge Functions
  (precedent for placing privileged operations in Edge Functions
  rather than `apps/web`).
- ADR 0022 — OpenAI `text-embedding-3-small` via Edge Function for
  query embedding (parallel surface-placement decision).
- Multi-tenant Postgres/Supabase KB synthesis (`kb_multitenant-postgres-supabase_2026-04-28_v1_section-D4.xml`)
  — membership-join-table pattern, app_metadata vs database-driven
  membership tradeoffs, JWT-freshness caveat.
- Auth-options KB synthesis (`kb_auth-options-small-newsroom_2026-04-29_v1_section-D5-admin.xml`)
  — `inviteUserByEmail` admin API documentation, Supabase Auth's
  intentional non-coverage of multi-tenant invitation flows.
