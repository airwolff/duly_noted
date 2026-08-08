# 0024. Per-publication public read flag

Date: 2026-08-08
Status: Accepted

## Context

v1 auth is Supabase magic link, and every reader table is gated by
membership-scoped RLS (slice 5). Reading anything requires an account,
and an account requires an invitation.

That is the right shape for the product being built — publications are
expected to pay for access, and the schema is multi-tenant so a second
tenant can be onboarded without a rewrite. It is the wrong shape for
showing the product to a prospective publication. A magic link is a
credential: the prospect has to hand over an email address, wait for
mail, and click a link before seeing anything. For an unsolicited demo
that is enough friction to lose the meeting, and the content in question
— Lincolnville Select Board proceedings — is public record.

The immediate need is to show Midcoast Villager the product. The durable
need is that this must not damage the paid, invitation-only model that
the same tables serve.

## Considered options

- **Per-publication `public_read` flag with mirrored anon policies.**
  One boolean on `publications`, defaulting false. Anon SELECT policies
  mirror the authenticated ones with the membership predicate swapped
  for the flag. Public access becomes a data change, reversible with one
  `UPDATE`.
- **Drop or loosen the membership policies.** Simplest to write and
  destroys exactly the thing the paid model needs. Rejected.
- **Password auth alongside magic link.** Addresses the "I want to type
  a password" complaint but not the underlying one: a prospect still
  needs an account before seeing anything. Also a larger surface
  (signup, reset, rotation) than the demand justifies, and a SPEC-locked
  decision worth more deliberation than a demo deadline allows.
- **Demo mode as a parallel tenant (Backlog B10).** A separate `demo`
  publication with its own seeded content, real publication stays
  private. Preserves the private-tool posture most strictly, but it is a
  full slice of work and it demos a sandbox rather than the real thing.
- **Screen-share the demo.** Zero engineering, but the prospect cannot
  explore on their own time, which is most of the value of sending a
  link.

## Decision

Add `publications.public_read boolean not null default false`. Add anon
SELECT policies on `publications`, `towns`, `boards`, `meetings`, and
`segments` that mirror the slice 5 authenticated policies with the
membership subquery replaced by the flag. Meetings keep the
`status = 'published'` gate. Grant anon EXECUTE on `search_segments`,
which is SECURITY INVOKER, so RLS scopes results with no change to the
function.

Grants to anon are column-scoped where a table carries columns anon has
no business reading: `meetings.audio_url`, `asr_transcript_id`,
`transcript_url`, `last_error`, `failed_at`, and `segments.embedding`.

The default is the load-bearing part of this decision. Private is what
happens if nobody does anything; public is an explicit act on one named
publication.

## Consequences

- Midcoast Villager can be made world-readable with one `UPDATE` and
  made private again the same way. No deploy, no migration.
- A second tenant is private from the instant it is created. The paid
  model is the default path, not a thing to remember to re-enable.
- The membership path is untouched: invitations, admin surfaces, and
  paid access work exactly as before.
- Backlog B10 (demo mode as a parallel tenant) is largely superseded.
  Its stated purpose — letting a prospect explore without coordinating
  with the developer — is met by the flag against real content. B10
  survives only if a reason emerges to demo against insulated content
  rather than the real publication.
- Public reading changes what "private app" means for the configured
  tenant while the flag is on. That is a product posture change, not
  only a technical one, and it should be off again before the Villager
  relationship becomes a paid one.
- Anon traffic is unauthenticated and therefore unmetered per-user. At
  v1 corpus scale on Supabase Pro this is not a cost concern; if a
  public publication ever attracts real traffic, rate limiting at the
  Cloudflare layer is the lever, not RLS.
