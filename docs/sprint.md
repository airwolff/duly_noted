# Sprint — Finish to v1 — opened 2026-08-12

One sprint file, overwritten when the next one opens. It holds ordering and rationale only.
Backlog entries stay in `SPEC.md`; live pipeline state stays in `docs/handoff.md`. If this file
disagrees with either, they win.

**Goal:** carry the build to v1-done — demo link shareable, remaining finish-work closed, then one
full audit as the last gate before calling it finished.

**Not the goal:** new features. Slice 7 was the last one. Everything below is finish-work.

**Ordering decision (2026-08-12, user):** the audit moves to **last**. It is the gate on "done,"
not a checkpoint along the way. Nothing below waits on it.

---

## 1. ~~Land what's already green~~ — done 2026-08-12

[#15](https://github.com/airwolff/duly_noted/pull/15) (docs) and
[#14](https://github.com/airwolff/duly_noted/pull/14) (middleware into `src/`) both squash-merged
to `main` at 19:01 UTC as `eefd644` and `a2dfee4`.

**Three behaviors now live in production for the first time ever** — none has been observed yet:
signed-in sessions stop expiring at ~1 h, `resolve_pending_invitations()` fires on session
establishment, and admin routes redirect anonymous visitors to `/login` instead of 404ing. Reader
routes are unaffected. Cost: every anonymous reader request now makes a `supabase.auth.getUser()`
round-trip.

Confirm the middleware actually loaded before trusting any of that — see the build check in
`apps/web/CLAUDE.md` §3.

## 2. Flip `public_read` and exercise the anon path

```sql
UPDATE publications SET public_read = true WHERE slug = 'midcoast-villager';
```

Then load `https://duly-noted.pages.dev/midcoast-villager/lincolnville/select-board` **signed
out**. This is the **first time the anon RLS policies have ever been exercised** — they were
written in #11 and have sat behind a `false` flag since. Check the meeting page too, not just the
list: `select('*, segments(*)')` was narrowed in #11 and the anon policy on `segments` is the one
most likely to be wrong.

**Size:** one row plus ten minutes of clicking. **Blocked on:** a decision about whether the demo
goes public at all.

## 3. Retry the one uncharacterized failure

Meeting `17ca2eb0-174a-4b02-9483-8875f7f6be59` (`aUOt_cjYKpk`, Select Board - April 13 2026) is the
only `failed` row that isn't a pre-proxy yt-dlp bot-detection error:

```
storage upload failed for meetings/17ca2eb0-174a-4b02-9483-8875f7f6be59/audio.opus: The ob…
```

The message is truncated in `last_error` and the failure mode was never diagnosed. It is the one
failure that could recur on a meeting that matters, so it is worth knowing about before launch.
Reset it to the stage that failed and watch — it has not paid ASR, so a retry costs ~$1.70 if it
runs the whole way, less if it fails again at upload.

**Size:** one command plus a poll. **Blocked on:** nothing.

## 4. B9 — unify the Edge Function embedding surface

`SPEC.md` § B9. `supabase/functions/search/index.ts` redefines the OpenAI embeddings-response Zod
schema (lines 43–55) and the `EMBEDDING_MODEL` / `EMBEDDING_DIMENSIONS` constants (21–22) inline
instead of importing from `packages/shared/src/embedding/`. The `npm:` specifier path is already
proven in that same file (line 15), so NI-009's original "Deno imports are non-trivial" reasoning
has eroded. Closes NI-009 and NI-020.

Sequenced **before** item 5 so the pre-launch sweep exercises the unified surface.

**Size:** one session. No SPEC change beyond deleting the backlog entry.

## 5. B7 — pre-launch test sweep

`SPEC.md` § B7. End-to-end pipeline integration test, cross-publication RLS isolation coverage (the
deferred Slice 5 gap in `packages/db/src/rls.test.ts` — towns / boards / meetings / segments
policies are untested), production smoke pack, manual QA checklist for the reader surface.

This is a slice in its own right, not an afternoon. It is the largest remaining piece of work
before v1 is defensible.

**Size:** a full slice. **Blocked on:** item 4.

## 6. `/code-audit` with Fable 5 — the gate on "done"

Runs **last**, against the finished system, and covers everything since the last audit
(`2026-05-12-slice-7-invitations`) — PRs #5 through the end of item 5. That arc has never been
audited.

The case for it, from this arc alone: ADR 0019 was accepted 2026-05-09 and went unimplemented for
three months; `apps/web/CLAUDE.md` contradicted ADR 0024; and `apps/web/middleware.ts` sat in a
location Next.js silently ignores since the initial scaffold, with two consecutive handoffs
asserting false things about its live behavior. Each is a doc/code/ADR drift that no test catches
and no CI job checks — which is exactly the audit's target and exactly why it belongs at the end,
where it can see the whole thing at once.

Then the normal route: triage → `docs/audits/<stem>-fix-brief.md` → `/apply-audit-fixes` →
`/promote-to-non-issue` for anything accepted as wont-fix. Budget a session for the audit and one
to two for the fixes.

**Size:** two to three sessions. **Blocked on:** everything above being done.

---

## Costed, undecided — the user's call, not the sprint's

Neither is scheduled. Both are recorded with numbers so the decision can be made without
re-deriving them.

- **Drain the yt-dlp backlog.** 25 real Select Board meetings back to May 2025, 33.1 hours,
  **~$1.70 each / ~$43 for all**. They failed only because the ADR 0019 proxy wasn't live; they
  would very likely succeed now. 5 published meetings demos the pipeline — a year of archive demos
  the product, and search is thin at 5. Exceeds the user's own 5-meeting cap.
- **Add a second town.** ~$1.10–1.55/meeting → **~$4.40–6.20 for four, ~$5.50–7.75 for five**
  against a $8 budget. Config only: a `towns` row plus a `boards` row with a channel ID,
  `title_pattern`, and `min_duration_seconds` — no migration, no deploy. A second _town_ under
  `midcoast-villager` is not a second tenant, so root `CLAUDE.md` §7 doesn't bar it. Expect
  `title_pattern` tuning: every pipeline fix so far is proven against exactly one channel.

## Explicitly out of scope this sprint

- **B10 — demo mode.** Largely superseded by ADR 0024's `public_read` flag. Survives only if a
  reason emerges to demo against insulated content.
- **B4a / B4b — operator review gate and residual admin surfaces.** No trigger has fired. B4b waits
  until Aaron asks; SQL-correcting an edge case is cheaper than the UI until then.
- **B5 / B6 — transcript-aware summarization, speaker identification.** Both need an eval or an
  audit finding first. Summaries currently look good enough that neither trigger has fired.
- **B1 / B2 / B8** — no trigger fired.
- **B12 — `db push --linked` desync.** Cannot be worked on deliberately; it needs the next CI
  Migrate failure to produce diagnostic data. The precautionary rule in root `CLAUDE.md` §6 bounds
  the surface in the meantime.
- Anything in root `CLAUDE.md` §7.

---

## Verification gate

Nothing in this sprint is done until `pnpm -r build && pnpm -r typecheck && pnpm -r test && pnpm -r lint && pnpm format:check`
passes — **`build` first**, or the worker tests resolve `@duly-noted/shared` to a stale `dist`. And
CI green, merged, and deployed are three different things separated by ~18–20 minutes of Render
build; see `docs/handoff.md` § Gotchas.
