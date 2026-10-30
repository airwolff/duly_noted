# Handoff — `main` — 2026-08-20

Read `CLAUDE.md` and `SPEC.md` first, then this file. `docs/sprint.md` holds the ordering of
remaining work; this file holds the state.

The project is **paused, not stalled.** Nothing is half-finished, nothing is mid-deploy, and the
production system keeps running on its own while nobody watches it. This file is written for a
cold restart weeks later.

---

## ▶ Resume here

**The build is feature-complete and the pipeline runs unattended.** All seven slices shipped.
On 2026-08-10 the cron discovered the Aug 10 Select Board meeting and it reached `published` at
01:52 UTC on 2026-08-11 with **no human involvement** — extraction through proxy, ASR, 38 segments,
3-paragraph summary. The cron was last observed alive **2026-08-19T15:01Z**, still scanning.
**5 meetings are published**, exactly the 5-meeting cap the user set.

**Exactly one action is outstanding, and only the user can perform it:**

```sql
update publications set public_read = true where slug = 'midcoast-villager';
```

Run it in the Supabase SQL editor:
<https://supabase.com/dashboard/project/bnyjoynsmjdurcpbnycn/sql/new>

**An assistant cannot do this.** `service_role` has SELECT but not UPDATE on `publications` —
PostgREST returns `42501 permission denied for table publications`. That is the schema being
correct; do **not** add an UPDATE grant to widen a permanent privilege for a one-row change.

Flipping it is what makes the demo link shareable, and it is the **first time the anonymous RLS
policies will ever have served a request** — they were written in #11 (2026-08-08) and have sat
behind a `false` flag ever since. After the flip, load
`https://duly-noted.pages.dev/midcoast-villager/lincolnville/select-board` signed out, and check a
**meeting page** too, not just the list: the anon policy on `segments` is the likeliest to be wrong.

Everything else is optional, ordered in `docs/sprint.md`. Nothing is broken, nothing is waiting on
a build, and no decision is blocking anyone.

Reset command shape, kept for future manual recoveries (service-role, PostgREST):

```bash
set -a; . apps/worker/.env.local; set +a
curl -s -X PATCH "$SUPABASE_URL/rest/v1/meetings?id=eq.<UUID>" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" -H "Prefer: return=minimal" \
  -d '{"status":"summarizing","last_error":null,"failed_at":null}'
```

Then poll `/rest/v1/meetings?select=status,last_error,summary&id=eq.<UUID>` every 30s. Terminal
states are `published` and `failed`. Reset to the stage that failed, never to `pending` —
`pending` re-runs extraction and re-pays ASR.

---

## What happened last

Three PRs about one file, and the second only became visible once the first was written. All are
merged; `main` is `a2dfee4`.

**#13 — `fix(web): gate middleware on admin routes only` (`0a5aa8c`, merged).** The middleware's
`PUBLIC_PATHS` allowlist held only `/login` and `/auth/callback`, so it was written to redirect
_every_ unauthenticated request to `/login`. ADR 0024 says reader routes fall through to RLS and
only `/{publication}/admin/*` is gated. Replaced the allowlist with an `ADMIN_PATH` regex anchored
to exactly the second path segment, so a town or board slug of `admin` stays a reader route.

**#14 — `fix(web): move middleware into src/` (`a2dfee4`, merged).** While verifying #13 against
production, an anonymous request to `/{publication}/admin/members` returned **404 from the page's
own `notFound()`** — not a 307 to `/login` — with `x-edge-runtime: 1` and `x-matched-path` set.
The Worker ran and the route server-rendered, but nothing intercepted. Cause: this app uses a
`src/` directory, and **Next.js only discovers middleware at `src/middleware.ts` in that layout.**
At the project root it is silently ignored — no warning at build or dev. The file had sat at
`apps/web/middleware.ts` since the initial scaffold (`9c3f521`), so **the middleware had never run
in production, ever.**

The PR is a `git mv` of `middleware.ts` and `middleware.test.ts` into `src/`, plus a tsconfig
`include` cleanup and the web `lint` script path (`eslint src middleware.ts` → `eslint src`). The
`@/*` → `./src/*` alias means **no imports changed**. The constraint is now documented in
`apps/web/CLAUDE.md` §3 with a verifiable build check rather than a claim: `pnpm -F web build`
output must contain a `ƒ Middleware` line, and `.next/server/middleware-manifest.json` must have a
non-empty `middleware` key. `middleware: {}` means it is not wired up.

**Ordering was load-bearing.** #13 had to land first. Moving the file while `PUBLIC_PATHS` still
held only `/login` would have activated a middleware that redirected every anonymous reader
request to `/login` — breaking the reader surface entirely. Narrowing the gate before waking the
middleware is what makes #14 safe.

**#15 / #16 — docs.** `#15` (`eefd644`) refreshed this file and added `docs/sprint.md`. `#16`
reordered the sprint to put the audit last. Neither touches code or schema.

### Correction to the 2026-08-09 handoff

That file carried a boxed "Correction" asserting that signed-in sessions do **not** expire after
an hour and that `resolve_pending_invitations()` **is** called. **Both are false.** They were
inferred from reading the middleware source, which was correct code in a file Next never loaded.
The 2026-08-08 claim they were correcting was wrong for a different reason. Neither behavior has
ever existed in production. This is the second time in three sessions that a claim about this file
was wrong; it is why #14 shipped a build check instead of prose.

---

## What's verified vs assumed

**Verified — observed in the cloud database or in command output**

- **The full pipeline runs unattended in production.** Meeting `8e31c6df-c776-4776-b390-c4889fbb9e71`
  (`5pu26qX5Ddg`, "Select Board - August 10, 2026", 3664 s) was created `2026-08-10T22:01:09Z` and
  reached `published` with `summary_generated_at 2026-08-11T01:52:43Z`, 38 segments, 3-paragraph
  summary. No manual reset, no intervention. This retires the "the worker image built and
  deployed" assumption from the last handoff — the ADR 0019 proxy, the yt-dlp bump, and the Deno
  install are all provably live.
- **The middleware is live and gating admin routes.** Probed anonymously against production on
  2026-08-12 and again on 2026-08-20: `/midcoast-villager/admin/members` returns **307** to
  `/login?redirectTo=%2Fmidcoast-villager%2Fadmin%2Fmembers`. Before #14 the same request returned
  404 from the page's own `notFound()`. This is the first time in the project's history that the
  middleware has run in production, and it retires the "#14's behavior in production" assumption.
- **Reader routes pass through the gate.** `/midcoast-villager/lincolnville/select-board` returns
  **404 with no redirect** — through the middleware untouched, refused by RLS because
  `public_read` is `false`. Exactly the ADR 0024 design.
- **The cron is still alive at rest.** Newest `meetings` row created `2026-08-19T15:01:23Z` (a
  Harbor Cam livestream, correctly left at `discovered`) — eight days after the last human touched
  the repo.
- 5 meetings `published`, 26 `failed`, 32 `discovered`, 63 total (queried 2026-08-20).
- `publications.public_read` is still `false` for `midcoast-villager` (queried directly).
- **PRs #14 and #15 merged** to `main` 2026-08-12T19:01Z as `a2dfee4` and `eefd644`; CI, Migrate,
  and Deploy Edge Functions all green on both. Working tree clean.
- `service_role` genuinely cannot read `memberships` (`42501 permission denied`). This is
  **correct, not a gap** — the only `from('memberships')` in a function
  (`supabase/functions/invite-user/index.ts:91`) runs on a **user-scoped** client with the caller's
  JWT, so the root `CLAUDE.md` §6 service-role GRANT rule does not apply. Re-verified this session
  rather than trusted.

**Assumed — not observed**

- **The anon RLS policies work.** Still never exercised: `public_read` is `false`, so no anonymous
  request has ever reached them. First real exercise is the flag flip. This is now the **only**
  large unverified surface in the system.
- **Session refresh and `resolve_pending_invitations()`.** Both went live with #14 and neither has
  been observed. The admin redirect was the observable third of that change; these two need a real
  signed-in session over an hour, and an invited user clicking a magic link, respectively.
- **No Select Board meeting has been missed since Aug 10.** The board meets roughly fortnightly, so
  the next one is due around Aug 24 and the gap looks normal — but nobody has cross-checked the
  YouTube channel against the `meetings` table to confirm the cron isn't silently skipping.

---

## Live state

Cloud database, queried 2026-08-20. 63 rows total.

| Status       | Count | Meaning                                                                                                                                                 |
| ------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `published`  | 5     | see below                                                                                                                                               |
| `failed`     | 26    | 25 old yt-dlp bot-detection failures + 1 storage-upload failure                                                                                         |
| `discovered` | 32    | Correctly parked — Harbor Cam livestreams (`duration 0`), Planning Board, Budget Committee, and short items all fail `title_pattern` or the 600 s floor |

The only change since 2026-08-12 is one new `discovered` Harbor Cam row (2026-08-19T15:01Z), which
is the cron proving it still runs.

**Published (5):**

| id          | youtube_id    | title                                | segs |
| ----------- | ------------- | ------------------------------------ | ---- |
| `8e31c6df…` | `5pu26qX5Ddg` | Select Board - August 10, 2026       | 38   |
| `16c73397…` | `6gqT74zC2O8` | Select Board Meeting - July 13, 2026 | 27   |
| `6796cf74…` | `tUtQp_-CsuU` | Select Board - June 22, 2026         | 29   |
| `3b7a0e53…` | `kgLGz6rxD8A` | Select Board - May 11, 2026          | 40   |
| `a669dadb…` | `vWsJcTssN9s` | Lincolnville Select Board Meeting    | 6    |

**Failed (26)** — 25 share one verbatim error, newest `failed_at 2026-08-07T23:00:57Z`, oldest
`2026-05-09T01:00:35Z`:

```
ERROR: [youtube] <id>: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies
```

These all predate the proxy fix going live. They are real Select Board meetings back to May 2025,
**33.1 hours total**, and would very likely succeed now. Draining all 25 is **~$43 (~$1.70 each)**.
**The user capped the demo at 5 meetings** — do not drain the backlog without asking.

The 26th is `17ca2eb0-174a-4b02-9483-8875f7f6be59` (`aUOt_cjYKpk`, Apr 13 2026),
`storage upload failed for meetings/17ca2eb0-.../audio.opus: The ob…` — a different failure mode,
never diagnosed. Cheap to retry (extraction already paid nothing durable; ASR not yet paid).

**Tenant:** publication `midcoast-villager` (`eaad9df3-6404-4372-a238-6321704405f5`,
`public_read = false`) → town `lincolnville` (`7e5471aa-…`) → board `select-board`
(`f1e36030-7a8b-4277-acd8-18ff0753cea3`, channel `UC1QHI-zQvIIkptXJsupfTZg`, playlist
`UU1QHI-zQvIIkptXJsupfTZg`, `title_pattern` `select board`, `min_duration_seconds` 600,
`ingest_since_days` 365). 140 segments total.

---

## Next steps

Ordering and rationale live in **`docs/sprint.md`** — do not duplicate them here. In short:

1. **Flip `public_read`** (Resume here) and exercise the anon path signed out.
2. **Retry `17ca2eb0…`**, the one failure whose mode was never diagnosed.
3. **B9** — fold the search Edge Function's inline embedding schema and constants back into
   `packages/shared`. Closes NI-009 and NI-020.
4. **B7 — pre-launch test sweep.** The largest remaining piece and a slice in its own right.
5. **`/code-audit` with Fable 5, last.** Moved to the end by the user's decision on 2026-08-12:
   it is the gate on "done," not a checkpoint partway through, and running it before B7 and B9
   would review code those items are about to change.

**Open decisions the user has not made**

- **Flip `public_read`?** The only outstanding action, and only the user can run it (see
  Resume here for why).
- **Drain more of the 25-meeting backlog** (~$1.70 each, ~$43 for all)? 5 meetings demos the
  pipeline; a year of archive demos the product, and search is thin at 5. This would take the demo
  set past the user's own 5-meeting cap, which is theirs to change.
- **Add a second town for the demo?** Asked and costed 2026-08-09, still undecided.
  ~$1.10–1.55/meeting, so ~$4.40–6.20 for four, ~$5.50–7.75 for five — budget $8. Unlike the
  backlog drain these pay ASR, since a new town's meetings have never been transcribed. Rates from
  `SPEC.md`: ASR $0.21/hr, segmentation ~$1.20/meeting at 2 h, summarization $0.06, embeddings
  negligible; observed Lincolnville meetings run 1.0–1.2 h, so the real per-meeting figure sits
  below SPEC's estimate. Three caveats: (a) it is config only — a `towns` row plus a `boards` row
  with a channel ID, `title_pattern`, and `min_duration_seconds`; no migration, no deploy; (b) a
  second **town** under `midcoast-villager` is not a second tenant, so it does not hit the root
  `CLAUDE.md` §7 multi-publication prohibition; (c) every pipeline fix so far is proven against
  exactly one channel — expect `title_pattern` tuning and possibly another livestream-duration
  surprise.
- **Whether `public_read` stays on** after the Villager conversation. ADR 0024 says it should go
  off when the relationship becomes paid.

---

## Gotchas

- **Verify this file's claims against the tree before acting on them.** Two consecutive versions of
  this handoff were wrong about `apps/web/middleware.ts` — first that it did not exist, then that
  its behavior was live. Both were repaired by one command against reality. The Live state counts
  and the verified/assumed split are queried; anything phrased as a status is a lead to check.
- **A 404 on a reader route is RLS, not auth.** Confirmed by probe on 2026-08-20: the reader route
  returns 404 with no redirect, so it reached RLS and was refused for `public_read = false`. If you
  see a **307 to `/login`** on a reader route instead, that is a different bug — the `ADMIN_PATH`
  regex in `apps/web/src/middleware.ts` has stopped being anchored to the second path segment.
- **Middleware must live at `apps/web/src/middleware.ts`** and a wrong location fails **silently**.
  Check the build: `ƒ Middleware` line present, `middleware-manifest.json` `middleware` key
  non-empty. `apps/web/CLAUDE.md` §3.
- **This repo is on Cloudflare Pages, not Vercel.** `apps/web/.vercel/` is a local build artifact —
  `@cloudflare/next-on-pages` builds through Vercel's output format as an intermediate step. (OBP
  is a different project; the only link is commit `3ee18ec`, where the handoff skill was adapted
  from railyard/obp.)
- **Render takes ~18–20 minutes from merge to live code.** Measured twice. A 9-minute wait once
  produced a false failure that cost an LLM call and an hour of wrong conclusions. No CLI for this.
- **`pnpm -r test` can pass locally while CI fails.** The worker resolves `@duly-noted/shared` to
  its built `dist`. Run **`pnpm -r build` first** or you are testing stale constants.
- **Never run `supabase db push --linked`** (root `CLAUDE.md` §6). Migrations reach cloud only via
  the Migrate workflow. Backlog B12 is the open investigation.
- **No Docker daemon on this machine.** The worker image cannot be built or tested locally; Render
  is the first build. Ask the user to start Docker Desktop if a local build matters.
- **`packages/db/src/types.ts` is hand-maintained.** New columns get added by hand until
  `supabase gen types` is wired up.
- **`service_role` cannot read `memberships`** — by design, no grant. To check whether an email has
  a membership, call `check_invite_conflicts(p_email, p_publication_id)` → `already_member` /
  `invitation_pending` / `ok`.
- **Failed meetings are never retried automatically** (root `CLAUDE.md` §7). Recovery is a manual
  status reset, to the stage that failed — never to `pending`, which re-runs extraction and
  re-pays ASR. A stored transcript means re-running summarization does **not** re-pay ASR.
- **The user's account** (`andyjwolff@gmail.com`) is already a member of `midcoast-villager`.
- **Commits here carry no `Co-Authored-By: Claude` trailer** — the user asked for it to be removed.
