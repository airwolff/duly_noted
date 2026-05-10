---
date: 2026-05-10
audit: 2026-05-10-slice-5-reader-ui.md
triage_session: claude-project, 2026-05-10
findings_triaged: 7 (F1, F2, F3, F6, F11, F-NIT-1, F-NIT-2)
questions_triaged: 1 (Q1)
reopen_candidates_triaged: 1 (NI-014)
fix_now: 5 findings + 3 workflow/SPEC amendments
defer: 1 (Q1, absorbed into SPEC.md §Backlog B-NN)
wont_fix: 2 (F-NIT-1, F-NIT-2 → promoted to NI-018, NI-019 — IDs assumed sequential, promote skill assigns actual values)
registry_updates: 2 (NI-008 promotion, NI-014 revisit-trigger update)
---

# Fix-brief — Slice 5 reader UI audit (2026-05-10)

Triage outcome for `docs/audits/2026-05-10-slice-5-reader-ui.md`.
Fix-now items below have CC-ready instructions with file:line refs.
Doc edits route per the amended `docs/workflows/build-cycle.md`
policy ("default by edit size, not by file type"): small targeted →
CC, substantial revision → manual paste.

## Fix-now items

### Code

#### F1 — Add segment count to meeting list rows

- **File:** `apps/web/src/app/[publication]/[town]/[board]/page.tsx`
- **Lines:** :21-24 (select), :39-51 (render)
- **CC instruction:**
  - Extend the meetings select from
    `select('id, title, meeting_date')` to
    `select('id, title, meeting_date, segments(count)')`.
  - In the row render block (:39-51), surface the count beside
    the title and date. Pull from `meeting.segments[0]?.count`
    (Supabase aggregate shape). Coerce nullish/zero cases to a
    `0 segments` string for stability. Match the existing
    typography pattern of surrounding row content.
- **Rationale:** Closes the SPEC.md:573 row-shape gap. Reader-UI
  slice was the implementation surface; not a deferred concern.

#### F2 — Drop unmatched `service_role FOR ALL` policies

- **File:** new migration —
  `supabase/migrations/NNNN_slice_5_drop_service_role_policies.sql`
- **CC instruction:**
  - Create a new migration via
    `supabase migration new slice_5_drop_service_role_policies`.
  - In the new migration, drop the four service_role policies
    added by `20260510191756_slice_5_reader_ui_rls.sql:20-31`:

    ```sql
    drop policy "service_role full access on publications"
      on public.publications;
    drop policy "service_role full access on towns"
      on public.towns;
    drop policy "service_role full access on boards"
      on public.boards;
    drop policy "service_role full access on memberships"
      on public.memberships;
    ```

    Match the policy names exactly to the originals.
  - No GRANT changes. service_role bypasses RLS and the original
    intent of these policies was "audit symmetry" per the source
    migration's own comment. service_role retains the table-touch
    permissions it needs from earlier migrations; functional
    access is unchanged.
- **Rationale:** Closes the root CLAUDE.md §6 hard-rule violation
  (policy without paired GRANT) and the SPEC §Slice 5
  schema-deltas scope-creep finding simultaneously, via removal
  rather than addition. service_role retains full functional
  access — RLS bypass is intrinsic to the role, not granted by
  policy.

#### F11 — Remove unused `@testing-library/user-event` devDependency

- **File:** `apps/web/package.json`
- **Line:** :29
- **CC instruction:**
  - Remove the
    `"@testing-library/user-event": "^14.6.1",`
    line from `apps/web/package.json` devDependencies.
  - Run `pnpm install` to update `pnpm-lock.yaml`.
- **Rationale:** Zero import sites across `apps/web/src`,
  `apps/web/middleware.test.ts`, `apps/web/vitest.setup.ts`, or
  anywhere in the repo (audit F11 evidence verified by grep).
  Not slated for imminent interaction tests.

### Documentation

#### F3 — Replace phantom `createServerComponentClient` references

- **Files:** `SPEC.md`, `apps/web/CLAUDE.md`
- **Routing:** CC (small targeted, named-symbol replacement)
- **CC instruction:**
  - `SPEC.md:585`: replace the token
    `createServerComponentClient` with `createServerClient`.
    Surrounding sentence is unchanged; only the symbol name
    changes.
  - `apps/web/CLAUDE.md:10-13`: same single-symbol replacement
    (`createServerComponentClient` → `createServerClient`).
- **Rationale:** `createServerComponentClient` is not an export
  of `@supabase/ssr@0.10.2`; it's the legacy export from the
  deprecated `@supabase/auth-helpers-nextjs`. Implementation
  already uses `createServerClient` via the `@duly-noted/db`
  factory (`packages/db/src/server-client.ts`). Doc-drift only;
  no code changes.

#### F6 — Defuse Prettier semantic-corruption risk

- **File:** `apps/web/CLAUDE.md`
- **Line:** :77-79
- **Routing:** CC (small targeted)
- **CC instruction:**
  - In the §7 list item starting with "Client-side state
    management libraries (Redux, Zustand). React state…",
    replace the indented continuation line
    `    + URL state are sufficient at the v1 page surface.`
    with
    `    and URL state are sufficient at the v1 page surface.`
    (eliminate the `+` glyph).
  - Verify with `pnpm exec prettier --check apps/web/CLAUDE.md`
    after the edit; should return clean.
- **Rationale:** Prettier interprets the indented `+` as a
  sibling list bullet under the parent `-` and normalizes to
  `-`, inverting the sentence's meaning. Rewording the prose
  eliminates the glyph that Prettier mis-parses; no
  `<!-- prettier-ignore -->` markup needed.

### Workflow / SPEC amendments

#### Add `pnpm -r format:check` to root CLAUDE.md §5 PR gate

- **File:** `CLAUDE.md` (root)
- **Section:** §5 PR gate
- **Routing:** CC (small targeted, single-line addition)
- **CC instruction:**
  - Locate the PR-gate command line that currently reads
    `pnpm -r typecheck && pnpm -r test && pnpm -r lint`.
  - Append ` && pnpm -r format:check` so the final form is
    `pnpm -r typecheck && pnpm -r test && pnpm -r lint && pnpm -r format:check`.
- **Rationale:** F6's failure mode (silent semantic corruption
  via the documented `pnpm format` command) is exactly the class
  of bug a format check exists to catch before merge. Cost of
  the addition is one command per CI run; benefit is closing
  the silent-corruption attack surface.

#### Add B-NN (Pre-launch test sweep) to SPEC.md §Backlog

- **File:** `SPEC.md`
- **Section:** §Backlog
- **Routing:** CC (small targeted, additive paragraph)
- **CC instruction:**
  - Append the following entry to the §Backlog section. Assign
    the next sequential `B-NN` id by reading the highest
    existing `B-N` entry in the section and incrementing.

    ```
    ## B-NN — Pre-launch test sweep

    - **What:** Dedicated slice reviewing test coverage across
      the deployed system before v1 launch. Targets: end-to-end
      pipeline integration test (ingest → ASR → segment →
      summarize → render), cross-publication RLS isolation
      (closes deferred coverage from Slice 5 Q1 —
      towns/boards/meetings/segments policies untested in
      `packages/db/src/rls.test.ts`), smoke-test pack against
      production after deploy, manual QA checklist for the
      reader surface (login flow, all four list pages, meeting
      page with segments, YouTube iframe error paths).
    - **Why:** Per-slice audits enforce coverage ratio at the
      slice scope. Cross-cutting integration paths and deferred
      coverage decisions accumulate across slices and need a
      sweep before users see the product. The end-to-end
      integration test is the single artifact that catches "all
      the pieces line up" — no individual slice owns it.
    - **Trigger:** Slice 6 (search) ships and pre-launch
      readiness becomes the next planning concern; or any
      cross-slice regression surfaces in operational
      verification.
    ```

- **Rationale:** Absorbs Q1 (RLS integration test scope) without
  a separate wont-fix entry. Captures the broader cross-slice
  and pre-deploy verification need surfaced during this triage.

#### Update `docs/workflows/build-cycle.md` §"How updates flow back to the repo"

- **File:** `docs/workflows/build-cycle.md`
- **Routing:** Manual paste (substantial section rewrite; the
  workflow doc change is itself a substantial revision and not
  CC-eligible under its own new policy)
- **Action:** Replace the existing two-paragraph
  "Manual paste / Claude Code mediated" subsection and the
  trailing "When in doubt…" sentence with the rewritten version
  below. Defaults edit routing by size, not by file type.

  ```
  Two paths:

  **Manual paste** — copy updated content from this conversation,
  save to the appropriate file, commit. Use for substantial
  revisions where reading the diff yourself matters before
  committing. Fix-briefs land via downloadable artifacts saved to
  `docs/audits/`.

  **Claude Code mediated** — ask Claude Code to apply specific
  edits ("update SPEC.md section X to read: …"). Use for small
  targeted edits (single-line replacements, named-symbol
  substitutions, additive single paragraphs). CC's `str_replace`
  is more precise than human copy-paste at this scale; manual
  whitespace and adjacent-line errors are the dominant failure
  mode for one-line edits, regardless of file type.

  Default by edit size, not by file type. Small targeted → CC;
  substantial revision → manual paste. Always use Claude Code for
  code changes.
  ```

- **Rationale:** Manual paste of single-line edits (the prior
  default for SPEC.md/CLAUDE.md changes) introduces whitespace
  and adjacent-line errors that CC's `str_replace` eliminates.
  Surfaced during F3/F6 triage; new policy applies to all
  subsequent slices.

## Wont-fix items (promoted to NI-018 through NI-019)

The following audit findings were accepted as wont-fix and
promoted to `docs/audits/_known-non-issues.md` via the
promote-to-non-issue skill in Claude Code (transient wont-fix
list provided in the triage session as skill input):

- **F-NIT-1** → NI-018 (`resolveBoard` + `PubRef`/`TownRef`/
  `BoardRef` exports retained as public-surface signal; revisit
  when next external consumer of `apps/web/src/lib/resolvers.ts`
  ships)
- **F-NIT-2** → NI-019 (`SortableSegment` interface retained as
  public-surface signal; revisit when next external consumer of
  `apps/web/src/lib/sort-segments.ts` ships)

Assigned IDs assume next available is NI-018; the promote skill
assigns actual sequential IDs at run time.

## Registry updates (manual CC edits)

Manual CC edits to `docs/audits/_known-non-issues.md`, outside
the promote-to-non-issue skill (which is append-only and does
not edit existing entries).

### NI-008 promotion

- **Action:** Update NI-008's `Status:` field to
  `Promoted (see SPEC.md §Stage 5 schema deltas, §Stage 8)`.
- **Reason:** Slice 5's RLS migration
  (`20260510191756_slice_5_reader_ui_rls.sql`) closed the
  membership-aware tenant-boundary hole on `meetings` and
  `segments` per SPEC.md §Slice 5 schema deltas and §Stage 8.
  The deferral the entry recorded is no longer in effect.
- **CC instruction:** Open `docs/audits/_known-non-issues.md`,
  locate the NI-008 entry, change only its `Status:` line.
  Leave the reasoning prose and originating-audit citation
  unchanged. Per the registry's no-edits-to-past-entries rule,
  only the Status field is touched; reasoning prose remains
  immutable.

### NI-014 revisit-trigger update

- **Action:** Update NI-014's revisit-trigger text to point at
  Slice 6 (search) rather than the now-shipped reader-UI slice.
- **Reason:** Slice 5 audit surfaced (in the "Reopen
  candidates" section) that NI-014's predicted "imminent
  reader-UI consumers" pathway did not materialize —
  `segment-card.tsx` uses a local display-string lookup
  (`MARKER_LABEL`), and no reader file imports `TITLE_MAX_LEN`,
  `DESCRIPTION_MAX_LEN`, `lookupTToken`, or any `Step*Output`
  type. Same NI shape stands; the next plausibly-imminent
  consumer is the search slice (`MARKER_TYPES` for filter
  chips, length constants for results-page truncation, possibly
  `Step*Output` types if search introduces structured query
  output).
- **CC instruction:** Open `docs/audits/_known-non-issues.md`,
  locate the NI-014 entry, replace the revisit-trigger text
  with a Slice-6-pointed version (e.g., "when the search slice
  (Slice 6) ships and the actual consumed surface from
  `packages/shared/segmentation/index.ts` is known"). Note in
  the registry's amendment line (or equivalent convention) that
  the update was triggered by the Slice 5 reader-UI audit's
  reopen flag, citing the source audit
  `2026-05-10-slice-5-reader-ui.md`. Per the registry's
  no-edits-to-past-reasoning rule, only the revisit-trigger
  field is touched; the original reasoning prose remains
  immutable.

## Suggested CC execution order

By dependency and risk profile, not severity:

1. **F6 + F3 docs cluster** — small targeted CC edits. Fix F6
   first (eliminates the silent-corruption risk before any
   subsequent doc edit triggers `pnpm format`). Then F3 in
   SPEC.md and apps/web/CLAUDE.md.
2. **build-cycle.md manual paste** — user-side, before CC
   executes any other doc-routing-sensitive work.
3. **CLAUDE.md §5 PR gate** — CC small targeted; add
   `pnpm -r format:check`.
4. **F2** — new migration to drop service_role policies.
5. **F1** — segment-count code change.
6. **F11** — devDependency removal + lockfile refresh.
7. **B-NN backlog entry** — CC additive paragraph in SPEC.md.
8. **Registry updates** — NI-008 promotion + NI-014 trigger
   update (manual CC edits on `_known-non-issues.md`).
9. **Promote-to-non-issue skill** — run with the transient
   wont-fix list to create NI-018 and NI-019.
10. **Re-audit** — recommended for the RLS migration touch
    (F2) and the workflow-policy amendment, per build-cycle.md
    step 8 guidance ("Mandatory for foundational work [schema,
    auth, ingestion]; optional for smaller slices"). The F2
    migration is RLS-adjacent and crosses a hard-rule
    boundary, which clears the spine threshold.
