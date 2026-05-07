# Fix session — Slice 2 post-audit
# Audit: docs/audits/2026-05-07-slice-2-ingestion.md
# Triage date: 2026-05-07

You are implementing fixes from the Slice 2 audit triage. Read
`docs/audits/2026-05-07-slice-2-ingestion.md` and
`docs/audits/_known-non-issues.md` before starting.

Plan mode first. Show the plan, wait for approval, then implement.

---

## Fixes to implement

### F1 + F12 — Combined follow-up migration

Create a single new migration via `supabase migration new slice_2_followup`.
The migration must:

1. `ALTER TABLE public.meetings ALTER COLUMN youtube_id SET NOT NULL;`
2. `CREATE OR REPLACE FUNCTION public.claim_pending_meeting()` — reissue the
   full function body from the Slice 2 migration, removing the explicit
   `updated_at = now()` from the UPDATE clause. The BEFORE UPDATE trigger
   already handles it; the explicit assignment is dead and invites drift.
3. `CREATE OR REPLACE FUNCTION public.auto_promote_for_board(p_board_id uuid)`
   — same: reissue full body, remove explicit `updated_at = now()` from both
   UPDATE clauses inside the function.

After the migration is written:
- Hand-edit `packages/db/src/types.ts`: change `youtube_id: string | null` to
  `youtube_id: string` on the `meetings` row type (and any Insert/Update
  variants that carry it).
- Delete the defensive null-throw guard at
  `apps/worker/src/pipeline/claim.ts:28-29` (the `if (!row || row.youtube_id
  === null)` block). The NOT NULL column makes this unreachable; the worker
  should throw on a falsy `row` (no claimed row) but the `youtube_id === null`
  branch is dead.

Verify: `supabase db reset` applies cleanly. `pnpm -r typecheck` passes.
`pnpm -r test` passes (the claim module tests should still cover the no-row
path).

### F7 — Edge Function deploy workflow

Create `.github/workflows/deploy-functions.yml`:

```yaml
name: Deploy Edge Functions

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
        with:
          version: latest
      - run: supabase functions deploy asr-webhook --project-ref ${{ secrets.SUPABASE_PROJECT_REF }}
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
```

`SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF` are already in GitHub
Secrets from `migrate.yml`. No new secrets needed.

### F8 — Dead export in apps/web

Delete `_resetEnvCacheForTests` from `apps/web/src/lib/env.ts`:
- Remove the function body
- Remove the export

No caller exists anywhere in the workspace. Verify with
`grep -rn "_resetEnvCacheForTests" apps packages` — should return zero
matches after deletion.

### F11 — Unexported helper

In `apps/worker/src/pipeline/upload.ts:8`: remove the `export` keyword from
`audioStoragePath`. The function is only called at line 23 of the same file.
No behavioral change.

Verify with `grep -rn "audioStoragePath" apps packages` — should show
declaration and single call site, both in `upload.ts`.

---

## Gates before declaring done

- `supabase db reset` — migrations + seed apply cleanly
- `pnpm -r typecheck` — all workspaces clean
- `pnpm -r test` — 35+ tests pass (claim module tests must still pass)
- `pnpm -r lint` — clean
- `pnpm format:check` — clean
- `grep -rn "_resetEnvCacheForTests" apps packages` — zero matches
- `grep -rn "audioStoragePath" apps packages` — only upload.ts lines
- `grep -rn "youtube_id.*null" packages/db/src/types.ts` — zero matches
- Migration file name follows `YYYYMMDDHHMMSS_slice_2_followup.sql` convention

Commit with: `fix: promote youtube_id not null, remove trigger-redundant updated_at, add EF deploy workflow, dead code cleanup`
