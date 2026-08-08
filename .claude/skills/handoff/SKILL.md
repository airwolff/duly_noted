---
name: handoff
description: Use when context is getting tight or the user asks for a session handoff, state export, or continuity brief — writes docs/handoff.md so a fresh Claude instance can pick the work up cold, with the live pipeline and deploy state verified rather than remembered.
---

# Session Handoff

Write `docs/handoff.md` so another Claude instance — with **zero** conversation history — can
continue without asking the user anything already settled.

One handoff file, overwritten each time. It describes the present, not a log of sessions. Anything
worth keeping permanently belongs in `SPEC.md`, an ADR, or `docs/audits/` — not here.

## Before writing, go look

This project has three surfaces that drift apart, and a handoff written from memory will be wrong
about at least one of them. Check all three:

**Repo**

- `git log --oneline -10`, `git status --short`, `git branch --show-current`
- `gh pr list --state open` and `gh run list --branch main --limit 5` — merged is not deployed

**Cloud database** (the real state of the pipeline)

- `set -a; . apps/worker/.env.local; set +a` then query PostgREST with the service-role key
- Meeting status distribution is the single most informative query:
  `/rest/v1/meetings?select=status` — counts of `discovered` / `pending` / `failed` / `published`
- For anything `failed`, read `last_error` verbatim. Do not paraphrase a vendor error.

**Deploys** (each has its own lag and its own failure mode)

- Render worker + cron rebuild on push to `main`. **~18–20 minutes from merge to live code.**
  There is no CLI visibility here; infer from behavior or ask the user to read the dashboard.
- Supabase migrations apply via the Migrate workflow. Verify the schema actually changed by
  querying it — a green workflow is not proof.
- Cloudflare Pages deploys the web app per push.

Verify every path, id, and slug as you write it.

## Structure

```
# Handoff — <branch> — <date>

## ▶ Resume here
The 30-second pick-up. The single next action, the one blocker, the state of the pipeline.
Someone should be able to read only this and start.

## What happened this session
What changed and why. Point at the PRs and ADRs for reasoning; don't restate them.

## What's verified vs assumed
Be honest. On this project "verified" means the row reached the state in the cloud database,
or the command was run and its output read — not that CI passed and the code looks right.

## Live state
Pipeline counts, published meetings by id, what is stuck and why.

## Next steps
Specific. The actual next command or file, in priority order, with costs where money is involved.

## Gotchas
What the next instance would otherwise rediscover the hard way.
```

## Rules

- **Specific over complete.** Meeting UUIDs, migration filenames, exact `curl`. Never "continue
  the work."
- **Verified means observed.** CI green, merged, and deployed are three different things, and on
  this project they are separated by ~20 minutes and a Docker build that no local machine here
  can run. Say which one you mean.
- **Quote errors verbatim.** `summary length 2646 out of bounds [200, 2500]` carries the bound,
  which tells the next instance which deploy was live. A paraphrase loses that.
- **Money is state.** Anything that re-runs ASR or an LLM call costs real money against a tight
  budget. Say what a step costs before proposing it, and say what is already paid for
  (a stored transcript means re-running summarization does not re-pay ASR).
- **Point, don't copy.** Link `SPEC.md`, the ADR, the audit report, the PR. Duplicated status
  goes stale and then lies.
- **Carry the open decisions the user has not made yet**, phrased as decisions, not as tasks.
- Do not commit the handoff unless asked.
