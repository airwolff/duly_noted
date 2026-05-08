# Audit fix brief — duly_noted Slice 2 re-audit

**Audit backing this brief:** `docs/audits/2026-05-08-slice-2-reaudit.md`
**Triage decisions:** completed in the duly_noted Claude Project on 2026-05-08.
**Code-only fixes in this brief:** 1 (F2). F1's resolution is a registry
append handled by `wont-fix-promotion-brief.md`, not a code change.

## How to use this brief

Paste this file (or its path) into a fresh Claude Code session and trigger
the `apply-audit-fixes` skill. The skill walks each fix one at a time,
confirms scope before edits, and stops at the verification step.

The brief is small (one fix). Cold-context fresh session is still preferred
per CLAUDE.md §5; the apply-audit-fixes skill should not share context
with the audit session that produced 2026-05-08-slice-2-reaudit.md.

## Pre-conditions

Before starting fixes, confirm the following landed in repo:

- [ ] `wont-fix-promotion-brief.md` ran. Three entries (NI-007, NI-008,
  NI-009) appear in `docs/audits/_known-non-issues.md`.
- [ ] Updated `CLAUDE.md` with two new §6 bullets (verify_jwt rule;
  direct-query GRANT coverage rule) is committed. Replace from the
  triage output bundle's `CLAUDE.md`.

The `code-audit` skill is intentionally NOT updated by this triage. The
four process-gap recommendations (G1–G4) in the re-audit route through
CLAUDE.md (G2, G3 — picked up automatically by P2 in the skill) or are
too premature/trivial to codify on one audit's evidence (G1, G4).
Revisit skill codification after the Slice 3 audit if the same gap
categories surface again.

If any pre-condition is missing, stop and surface — proceeding without
them produces an inconsistent state where SPEC.md cites NI-007/NI-008 but
the registry is empty, which the next audit will re-flag.

## Fixes

### Fix 1 — apps/worker-cron dev script env-file flag (F2)

- **Audit reference:** `docs/audits/2026-05-08-slice-2-reaudit.md#finding-2`
- **Severity:** HIGH (dev ergonomics; cron unrunnable locally without it).
- **Scope:** `apps/worker-cron/package.json:9`
- **Change:** Update the `dev` script from

  ```json
  "dev": "tsx watch src/index.ts"
  ```

  to

  ```json
  "dev": "tsx watch --env-file=.env.local src/index.ts"
  ```

  Mirror the `apps/worker/package.json:9` change made in `c29271a`.

- **Rationale:** `tsx` does not auto-load `.env` files; the cron's Zod
  env validator (`createEnvValidator` from `packages/shared`) throws at
  boot on missing vars, identical to the worker's failure mode.
  `apps/worker-cron/.env.example` exists, confirming local dev is
  intended.

- **Verification:**
  - `pnpm -F worker-cron dev` boots without the "env missing" error
    that bare `tsx watch` produces.
  - `pnpm -r typecheck && pnpm -r test && pnpm -r lint` all green.
  - No code-side changes; no test impact expected.

- **Notes:** No interaction with any other surface. Cron schedule on
  Render is unaffected (production uses `pnpm -F worker-cron start`,
  not `dev`).

## Suggested commit message

```
fix(worker-cron): load .env.local in dev script (mirror worker fix)

Closes 2026-05-08-slice-2-reaudit F2. tsx does not auto-load .env;
without --env-file the cron's Zod env validator throws at boot
locally. Identical fix shape to apps/worker (c29271a).
```

## Do NOT touch in this session

The fix surface is one line in one file. Anything else is out of scope
for this session. In particular, do not touch:

- `SPEC.md` — no amendments came out of this triage. The dangling NI
  citations resolve once the registry catches up via the wont-fix
  promotion brief; SPEC.md needs no edit.
- `CLAUDE.md` — replaced via the triage output bundle's full-file
  replacement, not edited in this session.
- `apps/worker/package.json` — already correct from `c29271a`.
- `supabase/config.toml` — already correct from `472ba0d`.
- `supabase/migrations/` — no migration changes from this triage.
- `docs/audits/2026-05-08-slice-2-reaudit.md` — read-only; the audit
  file is append-only history.
- `docs/audits/_known-non-issues.md` — append handled separately by the
  promote-to-non-issue skill (or hand-append, per the wont-fix brief).

If any of those surfaces need changes that weren't surfaced in triage,
stop and ask before making them.

## After fixes land

- Verify the next Render `duly-noted-worker-cron` tick runs green
  (post-GRANT-fix from `c29271a`; this brief does not affect it).
- Plan Slice 3 in the duly_noted Claude Project. Open scoping questions
  documented in the prior conversation's handoff:
  1. Slice 3 = segmentation only vs. segmentation + summarization
  2. Chapter storage shape — table vs. Storage artifact
  3. Method — Oberoi's three-stage pipeline vs. single-pass
  4. Hallucination controls — `[T{integer}]` token approach vs. trust diarized timestamps
  5. Operator review checkpoint — keep automatic, defer review-gate to Slice 5
- Slice 3 also picks up the deferred Slice 3 planning work from initial
  audit Q2: commit-msg hook for Conventional Commits enforcement.
