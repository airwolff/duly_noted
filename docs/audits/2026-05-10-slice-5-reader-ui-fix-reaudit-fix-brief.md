---
date: 2026-05-10
audit: 2026-05-10-slice-5-reader-ui-fix-reaudit.md
triage_session: claude-project, 2026-05-10
findings_triaged: 1 (F1)
questions_triaged: 1 (Q1)
reopen_candidates_triaged: 0
fix_now: 2 items (F1 + Q1)
defer: 0
wont_fix: 0
registry_updates: 0
---

# Fix-brief — Slice 5 fix-reaudit (2026-05-10)

Triage outcome for `docs/audits/2026-05-10-slice-5-reader-ui-fix-reaudit.md`.
Both items are small targeted CC-mediated edits under the
`docs/workflows/build-cycle.md` routing policy. No registry
updates and no wont-fix promotions this round, so no
promote-to-non-issue step is needed.

## Fix-now items

### F1 — Drop `-r` flag from `format:check` references in audit-skill files

The skills currently prescribe `pnpm -r format:check` as the
verification command and cite root CLAUDE.md §5. But §5 uses
`pnpm format:check` (no `-r`) because the script is defined only
in the root `package.json`; `pnpm -r` excludes the root and
errors with `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT`. This is a
drafting bug introduced by the same commit that updated the
skills during the source-audit cycle. The corrected command
matches the gate, the audit's own mechanical pass, and the
actual `package.json` definition.

Three call sites. All edits are identical-shape string
replacements: `pnpm -r format:check` → `pnpm format:check`.

#### Site 1

- **File:** `.claude/skills/code-audit/SKILL.md`
- **Line:** :72
- **Routing:** CC (small targeted, named-symbol substitution)
- **CC instruction:**
  - In §"Step 3: Run mechanical passes", replace the bullet
    text `` `pnpm -r format:check` `` (per root CLAUDE.md §5 PR gate)
    with `` `pnpm format:check` `` (per root CLAUDE.md §5 PR gate)
  - Single token removal; surrounding text and citation are
    unchanged.

#### Site 2

- **File:** `.claude/skills/apply-audit-fixes/SKILL.md`
- **Line:** :105 (example fix-queue listing)
- **Routing:** CC (small targeted)
- **CC instruction:**
  - In the §"Step 3: Confirm the queue" example, replace
    `[6] Root CLAUDE.md §5 PR gate — add pnpm -r format:check`
    with
    `[6] Root CLAUDE.md §5 PR gate — add pnpm format:check`

#### Site 3

- **File:** `.claude/skills/apply-audit-fixes/SKILL.md`
- **Line:** :157 (verification commands)
- **Routing:** CC (small targeted)
- **CC instruction:**
  - In §"Step 4 · e. Verify", replace the bullet
    `` - `pnpm -r format:check` (per root CLAUDE.md §5 PR gate) ``
    with
    `` - `pnpm format:check` (per root CLAUDE.md §5 PR gate) ``

#### Verification

After all three edits, run `pnpm format:check` once at the
repo root. Should report no Prettier violations — the changes
are inside backticks in markdown and don't affect formatting.

### Q1 — Add `IF EXISTS` to F2 migration's drops and codify in CLAUDE.md §6

The new migration `20260510223016_slice_5_drop_service_role_policies.sql`
(F2 from the source audit) uses bare `drop policy "..." on
public.<table>` for four drops. The sibling slice-5 migration
`20260510191756_slice_5_reader_ui_rls.sql` uses
`drop policy if exists ...` with an inline comment defending
the choice (cloud-drift defense from manual SQL Editor edits).
Both migrations drop policies created earlier in the migration
history; the defensive form applies identically. Match sibling
in the new migration, and codify the rule so future migrations
face no ambiguity. The fix-brief from the source audit
authored the bare-drop form verbatim, but that was a drafting
miss — the sibling pattern predated the brief and was
deliberate.

F2 migration is uncommitted in the working tree, so the edit is
direct on the source file (no follow-up migration needed).

#### Q1.1 — Migration edit

- **File:** `supabase/migrations/20260510223016_slice_5_drop_service_role_policies.sql`
- **Lines:** :12-19 (the four drop statements)
- **Routing:** CC (small targeted, identical-shape edits)
- **CC instruction:**
  - For each of the four `drop policy "..." on public.<table>;`
    statements at the cited lines, insert ` if exists` between
    `drop policy` and the policy-name string:

    ```sql
    drop policy if exists "service_role full access on publications"
      on public.publications;
    drop policy if exists "service_role full access on towns"
      on public.towns;
    drop policy if exists "service_role full access on boards"
      on public.boards;
    drop policy if exists "service_role full access on memberships"
      on public.memberships;
    ```

    Policy-name strings and `on public.<table>` clauses are
    unchanged.
  - Optionally add an inline comment above the block mirroring
    the sibling migration's wording for consistency. Suggested
    wording: `-- Policy name strings match the originals
    byte-for-byte. IF EXISTS guards against drift if a manual
    SQL Editor edit ever renamed a policy in the cloud.`

#### Q1.2 — Root CLAUDE.md §6 codification

- **File:** `CLAUDE.md` (root)
- **Section:** §6 DDL conventions
- **Routing:** CC (small targeted, additive line under existing section)
- **CC instruction:**
  - Append a new bullet under §6 (after the existing
    GRANT-pairing rule). Suggested wording:

    `- **DROP-side DDL uses \`IF EXISTS\`.** \`drop policy\`,
    \`drop table\`, and \`drop index\` statements include
    \`if exists\` to tolerate cloud drift from manual SQL Editor
    edits in the Supabase web UI. CREATE-side DDL remains bare
    per NI-003 (Supabase CLI applies migrations transactionally,
    so partial-apply recovery isn't a CREATE-side concern). The
    asymmetry is intentional: DROP-side \`IF EXISTS\` is
    one-way-ratchet defensive and never causes harm; CREATE-side
    \`IF NOT EXISTS\` would mask schema-state drift the CLI is
    supposed to surface.`

  - The NI-003 cross-reference is load-bearing — without it,
    future readers will question the CREATE/DROP asymmetry.

#### Verification

After both edits, run from repo root:

- `pnpm format:check` — Prettier check on the CLAUDE.md edit
- Optionally `pnpm exec supabase db reset` if the user has a
  local Supabase running; the migration's behavior is
  unchanged (still drops four policies), so this is a sanity
  check, not a correctness gate.
- `pnpm -r typecheck && pnpm -r lint && pnpm -r test` — full
  PR gate before commit.

## Suggested CC execution order

All three items are independent and CC-mediated. Natural reading
order:

1. **F1 site 1** — `code-audit/SKILL.md:72`
2. **F1 site 2** — `apply-audit-fixes/SKILL.md:105`
3. **F1 site 3** — `apply-audit-fixes/SKILL.md:157`
4. **Q1.1** — migration edit (four drop statements + optional
   inline comment)
5. **Q1.2** — root CLAUDE.md §6 codification line
6. **Verification gate** — `pnpm format:check` first (verifies
   F1 fix), then `pnpm -r typecheck && pnpm -r lint && pnpm -r test`
7. **Commit** — single commit covering all five edits and the
   uncommitted Slice 5 fix-brief application that was in the
   working tree at re-audit time. Per build-cycle.md, no
   re-audit needed — F1 + Q1 are small surgical edits well
   below the "foundational work" threshold that makes re-audit
   mandatory.

## What this fix-brief closes

- F1's three drafting sites — same root cause flagged in the
  apply-fixes turn ("Note for the next CLAUDE-project amendment
  cycle, not blocking now"). Now closed.
- Q1's IF EXISTS asymmetry — formal codification in CLAUDE.md §6
  means the next migration that drops a policy faces no
  ambiguity, and no future audit will re-raise this.
- The Slice 5 audit cycle as a whole. After this brief lands,
  Slice 5 is done end-to-end (source audit → triage → fix-brief
  → application → re-audit → re-audit fix-brief → application).
  Next planning concern is Slice 6.
