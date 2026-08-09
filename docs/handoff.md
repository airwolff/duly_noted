# Handoff — `main` — 2026-08-09

Read `CLAUDE.md` and `SPEC.md` first, then this file.

---

## ▶ Resume here

**The recovery is done. All four demo meetings are published**, each with a 3-paragraph summary.
The pipeline is alive and the summarization length bug is confirmed fixed.

**What remains, in this order:**

1. **Merge PR #13** — `fix/middleware-admin-only-gate`. Opened, CI not yet observed green.
   Without it, the flag flip in step 2 does nothing visible. See Next steps §2.
2. **Wait for Cloudflare Pages to deploy the merge**, then **flip the flag**:
   `UPDATE publications SET public_read = true WHERE slug = 'midcoast-villager'` — a deliberate
   one-row change, not part of any migration. This is what makes the demo link shareable.
   Flipping it _before_ #13 is live reproduces the login bounce and reads as "the flag is broken."
3. **Load the reader signed out** at
   `https://duly-noted.pages.dev/midcoast-villager/lincolnville/select-board` to confirm the anon
   RLS policies work end to end. This is their first real exercise.
4. **Then the audit.** `/code-audit` with Fable 5. Run it after the above.

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

## What happened this session

Nine PRs, #5–#12, all merged to `main`. Reasoning lives in the PR bodies and ADR 0024; this is the
index.

**The two bugs that killed the pipeline**

- **#6 — ADR 0019 was accepted 2026-05-09 and never implemented.** yt-dlp ran without the
  residential proxy, so every extraction from Render's datacenter IP got HTTP 429 +
  "Sign in to confirm you're not a bot." 25 meetings failed this way. PR adds `--proxy`, bumps
  yt-dlp `2026.03.17` → `2026.07.04`, installs Deno 2.9.5 (yt-dlp's extractor now needs a JS
  runtime). `YT_DLP_PROXY_URL` is set on the Render `duly-noted-worker` env group by the user.
- **#7 — live-streamed meetings could never be promoted.** YouTube reports `PT0S` while a video
  is streaming; the cron caught each meeting mid-stream, wrote `duration_seconds = 0`, and
  `upsert(..., ignoreDuplicates: true)` meant it never looked again. `auto_promote_for_board`
  requires `>= 600`, so those rows parked at `discovered` forever. Now re-checks duration on
  `discovered` rows. Also fixed a latent bug: `videos.list` caps `id` at 50 and the call was
  unbatched, so a first scan of a channel with >50 videos in the horizon would have thrown.

**The third bug, found only once the first two were fixed**

Anthropic honors neither `minLength`/`maxLength` in the JSON schema nor the length stated in the
prompt. Three PRs, because the first two theories were wrong:

- **#8** — added one corrective retry on a length violation. Necessary, insufficient.
- **#9** — split the prompt target from the enforced cap (1200–1800 chars, cap 2500). **Wrong.**
  The next summary came back at **2646** — _longer_ than the 2075/2268/2315/2352 produced when the
  prompt asked for 2000. A lower character target produced longer output.
- **#12** — the actual fix: **ask in words, enforce in characters.** A model cannot count its own
  characters, so a character target is not an instruction it can follow. Prompt now asks for
  **220–280 words**; cap raised to **3000**.

**Product changes**

- **#10 + #12** — summaries render as paragraphs. Prompt asks for 2–3 blank-line-separated
  paragraphs with a stated shape (headline outcome → substantive items in order → what's next);
  reader splits on blank lines. Typography: `max-w-prose`, `leading-relaxed`, 17px.
- **#11 — ADR 0024, per-publication public read.** `publications.public_read` (default `false`)
  with anon SELECT policies mirroring the slice 5 authenticated ones. Reason: the user is showing
  the product to Midcoast Villager, and magic-link auth means a prospect must hand over an email
  and click a link before seeing anything. The default is load-bearing — the paid, invitation-only
  model is what happens when nobody does anything, and going public is one `UPDATE` on one row.
  **Largely supersedes Backlog B10** (demo mode as a parallel tenant); SPEC records this.
- **#5 — B11 closed.** CI job `functions-deploy-coverage` fails the build if a
  `supabase/functions/<name>/` has no deploy step in `deploy-functions.yml`.

**Two live bugs fixed incidentally**

- The meeting page did `select('*, segments(*)')`, shipping a **1536-float embedding per segment**
  to every browser. Now names its columns (#11).
- `apps/web/CLAUDE.md` §7 listed "public unauthenticated reader surface" as a locked do-not-build
  and §3 described middleware redirecting all anonymous traffic to `/login`. Both contradicted
  ADR 0024 and are updated, with a comment recording the reversal (#11).

---

## What's verified vs assumed

**Verified — observed in the cloud database or in command output**

- The proxy works. Jul 13 went extraction → upload → AssemblyAI → segmentation with no 429.
- #7 works. The cron ran 14:01 UTC, refreshed three durations (3889 / 3703 / 4358), promoted them.
- #8's retry is live and works. Jul 13 published at **1997 chars** against the then-2000 cap.
- The `public_read` column exists in cloud and is `false` for `midcoast-villager` (queried directly,
  not inferred from the green Migrate workflow).
- All CI green on every merge; `main` clean.

**Assumed — not observed**

- **The worker image built and deployed.** No Docker daemon on this machine, so the Dockerfile
  changes in #6 (yt-dlp bump, Deno install) were never built locally. Asset URLs return 200 and
  the layer ends with `yt-dlp --version && deno --version`, so a bad pin fails the build loudly.
  Behavior since suggests it deployed, but nobody has read a Render log.
- **The anon RLS policies work.** They mirror shapes already working for `authenticated`, but no
  anonymous request has been made against them — the flag is still `false`. First real exercise
  is the flag flip, and that now also requires PR #13 to be live.

**Promoted from assumed to verified on 2026-08-09**

- **#12's word-target prompt shortens output. Confirmed on four meetings.** Asked 220–280 words,
  enforced 200–3000 chars. Results: 252 / 282 / 286 / 293 words → 1539 / 1827 / 1800 / 1972 chars,
  all 3 paragraphs. The model overshoots the word ceiling by ~5% consistently but lands ~1000
  chars under the cap, so the margin is real rather than lucky. Note Jun 22 previously failed at
  **2646** chars and re-ran at **1827** — under the _old_ 2500 cap too, so it did not merely pass
  because the cap moved to 3000. The word target did the work.
- **Segmentation's description-length fix holds.** May 11 previously died at
  `description length 506 out of bounds [1, 500]`. It re-ran clean across **40** segments. Two
  defenses are in play: the prompt targets 350 chars against an enforced 500 (~150 slack), and
  `apps/worker/src/pipeline/segment.ts:266` wraps step 3 in `parseWithLengthRetry`.

---

## Live state

Cloud database, 2026-08-09 11:45 UTC (counts queried directly):

| Status       | Count | Meaning                                                                                                                                                                                                                        |
| ------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `published`  | 4     | `a669dadb…` (May 10, 6 segs), `16c73397…` (Jul 13, 27 segs), `6796cf74…` (Jun 22, 29 segs), `3b7a0e53…` (May 11, 40 segs) — all four re-summarized under the #12 prompt, all 3 paragraphs                                      |
| `failed`     | 26    | 25 old yt-dlp 429s + Jul 27                                                                                                                                                                                                    |
| `discovered` | 31    | Mostly correct: Harbor Cam (permanent livestream, `duration 0`), Planning Board, Budget Committee — all fail `title_pattern` or `min_duration_seconds`. Jun 8 is a genuine 471-second meeting, correctly under the 600s floor. |

The 25 old yt-dlp failures are real Select Board meetings back to May 2025, **33.1 hours total**.
They would very likely succeed now that the proxy works. Draining all of them is ~$43
(~$1.70/meeting). **The user explicitly capped this at 5 meetings** — do not drain the backlog
without asking.

Tenant: publication `midcoast-villager` → town `lincolnville` → board `select-board`
(`f1e36030-7a8b-4277-acd8-18ff0753cea3`, `title_pattern` `select board`, `min_duration_seconds` 600).

---

## Next steps

1. ~~Run the recovery~~ — **done 2026-08-09.** All four meetings published. See Live state.
2. **`apps/web/middleware.ts` — PR #13 open, awaiting merge.**

   > **Correction.** The 2026-08-08 version of this file said the middleware "does not exist"
   > and was "not started." **Both were wrong.** The file has existed since the initial scaffold
   > (`9c3f521`) and was last touched in PR #2. Two consequences claimed here were also wrong and
   > should not be acted on: signed-in sessions do **not** die after an hour (the middleware
   > refreshes the cookie), and `resolve_pending_invitations()` **is** called, gated on
   > session-cookie rotation. `SPEC.md:744` and `apps/web/CLAUDE.md` §3 describing it as existing
   > were accurate.

   The **real** defect: the middleware redirected _every_ unauthenticated request to `/login` —
   its `PUBLIC_PATHS` allowlist held only `/login` and `/auth/callback`. ADR 0024 and
   `apps/web/CLAUDE.md` §3 say reader routes fall through to RLS and only
   `/{publication}/admin/*` is gated. The docs were rewritten in #11; the code was not.
   So the work was **narrowing an existing gate, not writing one**.

   PR #13 replaces the allowlist with an `ADMIN_PATH` regex anchored to the second path segment
   (a town or board slug of `admin` stays a reader route). Session refresh and the invitations
   RPC are untouched.

   **Load-bearing for the flag flip:** until #13 is merged and deployed, setting
   `public_read = true` changes nothing a visitor can see — they are bounced to `/login` before
   RLS is consulted. Flipping first will look like the flag is broken.

3. **Flip `public_read`** for `midcoast-villager` — only after #13 is live — then load
   `https://duly-noted.pages.dev/midcoast-villager/lincolnville/select-board` **signed out** to
   confirm anon RLS works end to end.
4. **Then the audit.** The user wants a top-to-bottom `/code-audit` with Fable 5 once this is
   stable. Run it _after_ the above, not before — recent sessions produced two conventions
   conflicts, an accepted-but-unimplemented ADR, and a doc/code drift that went unnoticed for
   three months, which is exactly what the audit hunts.

**Open decisions the user has not made**

- Whether to drain more of the 25-meeting backlog (~$1.70 each) for a richer demo. Four meetings
  demos the pipeline; a year of archive demos the product, and search is thin with four.
- **Whether to add a second town for the demo.** Asked and costed 2026-08-09, not decided.
  ~$1.10–1.55/meeting, so **~$4.40–6.20 for four, ~$5.50–7.75 for five** — budget $8. Unlike the
  backlog drain these pay ASR, since a new town's meetings have never been transcribed. Rates from
  `SPEC.md`: ASR $0.21/hr, segmentation ~$1.20/meeting at 2 hr, summarization $0.06, embeddings
  negligible. Observed Lincolnville meetings run 1.0–1.2 hr, not the 2 hr SPEC assumed, so the
  per-meeting figure sits below SPEC's estimate. Three caveats: (a) it is config only — a `towns`
  row plus a `boards` row with a YouTube channel ID, `title_pattern`, and `min_duration_seconds`;
  no migration, no deploy; (b) a second **town** under `midcoast-villager` is not a second tenant,
  so it does not hit the root `CLAUDE.md` §7 multi-publication prohibition — the Villager is a
  regional newsroom and towns are the schema's intended axis; (c) every pipeline fix so far is
  proven against exactly one channel, so expect `title_pattern` tuning and possibly another
  livestream-duration surprise. This would also take the demo set past the user's stated 5-meeting
  cap, which is theirs to change.
- Whether `public_read` stays on after the Villager conversation. ADR 0024 says it should go off
  when the relationship becomes paid.

---

## Gotchas

- **Verify this file's claims against the tree before acting on them.** The 2026-08-08 version
  asserted `apps/web/middleware.ts` did not exist and prescribed writing it. It had existed for
  three months. A single `ls` would have caught it. Existence, status, and "not started" claims
  here are the author's memory of a long session, not observations — treat them as leads to check,
  not facts. The Live state counts and the verified/assumed split are the parts that were queried.
- **Render takes ~18–20 minutes from merge to live code.** Measured twice. A 9-minute wait
  produced a false failure that cost a wasted LLM call and an hour of wrong conclusions. Wait
  the full window before concluding a fix does not work. There is no CLI to check this.
- **`pnpm -r test` can pass locally while CI fails.** The worker resolves `@duly-noted/shared` to
  its built `dist`. Run **`pnpm -r build` first** or you are testing stale constants. This
  actually happened on #9.
- **Never run `supabase db push --linked`** (CLAUDE.md §6). Migrations reach cloud only through
  the Migrate workflow. Backlog B12 is the open investigation.
- **No Docker daemon on this machine.** The worker image cannot be built or tested locally; Render
  is the first build. Ask the user to start Docker Desktop if a local build matters.
- **`packages/db/src/types.ts` is hand-maintained** — its header says so. New columns are added by
  hand until `supabase gen types` is wired up.
- **`service_role` cannot read `memberships`** (no grant; slice 5 dropped the service-role
  policies). This is correct, not a bug. To check whether an email has a membership, call
  `check_invite_conflicts(p_email, p_publication_id)` — returns `already_member` /
  `invitation_pending` / `ok`.
- **Failed meetings are never retried automatically** (CLAUDE.md §7). Recovery is always a manual
  status reset. Reset to the stage that failed, not to `pending` — `pending` re-runs extraction
  and re-pays ASR.
- **The user's account** (`andyjwolff@gmail.com`) is already a member of `midcoast-villager`.
- **Commits in this repo do not carry a `Co-Authored-By: Claude` trailer** — the user asked for it
  to be removed.
