---
name: promote-to-non-issue
description: Appends accepted audit findings to docs/audits/_known-non-issues.md as wont-fix registry entries with stable NI-NNN IDs, reasoning, revisit triggers, and citations back to the originating audit. Append-only by design (the registry is protected from Write/Edit by a pre-edit hook; this skill writes via Bash heredoc). Use when the user wants to promote, accept, register, or mark audit findings as wont-fix or known non-issues — trigger on phrases like "promote findings", "accept as wont-fix", "add to known non-issues", "register these findings", "mark these as accepted", or any reference to an audit file paired with intent to record items as wont-fix. Accepts pre-baked transient wont-fix lists from the duly_noted Claude project triage workflow (entries with reasoning + revisit trigger already structured) and short-circuits per-entry interrogation when input is structured. Never edits existing registry entries — status changes like NI-NNN → Promoted are manual CC edits, out of this skill's scope.
---

# promote-to-non-issue

Append accepted audit findings to `docs/audits/_known-non-issues.md`
as durable wont-fix entries. The registry is append-only — each
entry gets a stable `NI-NNN` ID, today's date, the user's
reasoning, a revisit trigger, and a citation back to the
originating audit.

This skill walks three logical steps: identify the audit, capture
or confirm reasoning, append via Bash. Pre-baked structured input
from the duly_noted Claude project triage workflow short-circuits
the reasoning-capture loop.

## Why Bash heredoc, not Write or Edit

The `pre-edit-protect-audits.sh` hook blocks Write, Edit, and
MultiEdit on `_known-non-issues.md` to prevent arbitrary
modification of the registry. This skill writes via Bash heredoc
(`cat >> file <<'SENTINEL'`), which doesn't match the hook's
matcher and is allowed through.

This is deliberate. Write and Edit are blocked because the
registry is append-only and its value depends on entries being
durable. Do not attempt Write or Edit on the registry — that
path is intentionally closed.

## When to use

After triaging an audit (typically in the duly_noted Claude
project) and deciding which findings to record as accepted
wont-fixes. Triggers: "promote these findings", "accept F-NIT-1
and F-NIT-2 as wont-fix", "add these to the registry", "register
these as known non-issues".

## When NOT to use

- Triage itself — that happens in the Claude project, not here.
- Fixing audit findings — separate workflow against the audit's
  fix-brief.
- Marking an entry `Withdrawn` — manual edit outside any Claude
  surface.
- Promoting an entry's `Status` line (e.g. `NI-NNN → Promoted
  (see SPEC.md#section)` or `Promoted (see ADR-NNNN)`) — a
  manual CC edit, because the registry is append-only via this
  skill and status changes touch existing entries.

## Hard rules

- **Bash-append only.** Use `cat >> _known-non-issues.md
  <<'SENTINEL'` to append. Never use Write or Edit on the
  registry.
- **Never modify other files.** No source edits, no audit-file
  edits, no skill mutations.
- **Never modify existing registry entries.** Append-only.
- **Never invent reasoning.** If user input is vague, push back.
- **Never accept a finding the user did not explicitly select.**
- **Never write until the user explicitly confirms.**
- **Stop on missing files.** If the audit or the registry is
  missing, stop and report — do not create either.

## Workflow

Copy this checklist and check items as you progress:

```
- [ ] Step 1: Identify the audit file
- [ ] Step 2: Read audit + registry; note highest existing NI-NNN
- [ ] Step 3: Detect input shape; if interactive, list eligible findings
- [ ] Step 4: Capture reasoning per finding (interactive only)
- [ ] Step 5: Show proposed markdown
- [ ] Step 6: Confirm and append via Bash
- [ ] Step 7: Verify the append
```

### Step 1: Identify the audit

Ask which audit file the findings come from. Expect a path like
`docs/audits/2026-05-10-slice-5-reader-ui.md`.

If not provided, list dated audit files in `docs/audits/` (skip
`README.md` and `_known-non-issues.md`) and ask.

### Step 2: Read the audit and the registry

Read the chosen audit file. Extract every finding (ID, severity,
one-sentence summary, file:line). Skip "Questions for human",
"Reopen candidates", mechanical pass results, and "What NOT to
fix" sections — those aren't promotion candidates.

Audit findings use IDs like `F1`, `F2`, `F-NIT-1`, `Q1`. Preserve
these IDs in citations rather than re-numbering.

Read `docs/audits/_known-non-issues.md` and note the highest
existing `NI-NNN`. Continue from there. If the registry contains
only the `_None yet._` placeholder from scaffold, start at
`NI-001` and follow the placeholder-removal guidance in Edge
cases below.

### Step 3: Detect input shape

Two paths.

**Pre-baked input.** The user supplies (or has pasted from
upstream triage) structured entries already containing reasoning
+ revisit trigger per finding. Each block looks like:

```
Entry N
Title: <short title>
Reasoning: <prose>
Revisit trigger: <prose>
Originating audit: <path> — <finding ID>
```

If the input matches this shape, skip Step 4. Move to Step 5
with the pre-baked content. Re-interrogating the user when the
data is already structured wastes their time and risks drift.

**Interactive input.** The user supplied only a list of audit
finding IDs (or an open "promote these") with no pre-baked
reasoning. Print eligible findings as a numbered list:

```
Findings in 2026-05-10-slice-5-reader-ui.md:
  [1] F1     (MEDIUM) — Meeting list rows omit segment count
  [2] F2     (LOW)    — service_role policies without GRANTs
  [3] F-NIT-1 (NIT)    — resolveBoard exported, no consumer
  [4] F-NIT-2 (NIT)    — SortableSegment exported, no consumer
  ...
```

Ask which to accept as wont-fix. Accept replies as numbers,
finding IDs, severity groups, or natural language. Then proceed
to Step 4 per-finding reasoning capture.

### Step 4: Capture reasoning (interactive path only)

For each selected finding, ask in one message:

```
Finding F-NIT-1 — resolveBoard + Ref interfaces exported without
external consumer

  Reasoning: why is this acceptable now?
  Revisit trigger: what condition should reopen it, or "permanent"?
```

Wait for the reply before moving to the next finding. One at a
time. The serial walk forces specificity; a batch ask invites
hand-waving.

If the reasoning is vague ("it's fine for now"), push back: ask
what specifically makes it fine and what would change that. The
registry's value depends on the durable specificity of each
entry — vague entries erode it.

### Step 5: Show the proposed markdown

Once every selected finding has reasoning + revisit trigger,
print the exact markdown that will be appended:

```markdown
## NI-NNN: <short title from finding summary>

- Status: Accepted
- Source: docs/audits/<filename> — <finding ID>
- Date accepted: YYYY-MM-DD
- Scope: <files or component this applies to>
- Reasoning: <user's reasoning, lightly cleaned>
- Revisit when: <user's trigger, or "permanent">
```

`NI-NNN` continues monotonically from the highest existing ID.
Date is today's date in `YYYY-MM-DD` from the session context.

### Step 6: Confirm and append via Bash

Ask: "Append these N entries to `_known-non-issues.md`?"

Only `yes`, `append`, `go`, `confirm`, or equivalent explicit
affirmation triggers the write. Ambiguous replies do not.

On confirmation, append via heredoc. Example for the Slice 5
triage output (NI-018 and NI-019 derived from F-NIT-1 and F-NIT-2):

```bash
cat >> docs/audits/_known-non-issues.md <<'NEW_ENTRIES'

## NI-018: Speculative exports retained in apps/web/src/lib/resolvers.ts
- Status: Accepted
- Source: docs/audits/2026-05-10-slice-5-reader-ui.md — F-NIT-1
- Date accepted: 2026-05-10
- Scope: apps/web/src/lib/resolvers.ts
- Reasoning: resolveBoard is called only from resolveBoardChain
  in the same file; PubRef/TownRef/BoardRef are used only as
  internal parameter types. Dead-export cost is one line per
  symbol; trim-now risk is removing a public-surface signal a
  future board page or admin surface would consume. Same shape
  as NI-014.
- Revisit when: Next consumer of apps/web/src/lib/resolvers.ts
  outside the file itself ships — audit actual consumed surface
  and trim what didn't materialize.

## NI-019: Speculative export retained in apps/web/src/lib/sort-segments.ts
- Status: Accepted
- Source: docs/audits/2026-05-10-slice-5-reader-ui.md — F-NIT-2
- Date accepted: 2026-05-10
- Scope: apps/web/src/lib/sort-segments.ts
- Reasoning: SortableSegment is used only as the generic
  constraint of sortSegments in the same file. Shape
  ({sequence_order, id}) is generically useful for any code
  sorting or paginating segments. Same shape as NI-014 and
  F-NIT-1.
- Revisit when: Next consumer of apps/web/src/lib/sort-segments.ts
  outside the file itself ships.

NEW_ENTRIES
```

Heredoc details that matter:

- **Sentinel name.** Use a distinctive token like `NEW_ENTRIES`.
  Do **not** use `EOF` — user reasoning prose can legitimately
  contain that string and prematurely terminate the heredoc.
- **Quote the sentinel.** `<<'NEW_ENTRIES'` (single quotes)
  prevents shell variable interpolation. Reasoning text
  containing `$`, backticks, or `\` then survives unmodified.
- **Leading blank line.** Preserves visual separation from the
  prior entry already in the file.
- **Run from repo root** (or use `$CLAUDE_PROJECT_DIR/`).

### Step 7: Verify the append

After the bash command exits 0, read the tail of the registry
and confirm the new entries match what Step 5 proposed. Print
the new IDs and exit.

If the verification reveals a mismatch (truncation, sentinel
collision, encoding issue), stop and report. Do not append a
correction — the registry is now in a state the user needs to
inspect.

## Edge cases

**Audit has zero findings.** Stop and report. Nothing to promote.

**User selects a finding already covered by an existing entry.**
Before proposing the new entry in Step 5, scan the registry for
entries whose `Source:` line cites the same audit + finding ID,
or whose reasoning substantially overlaps. If a match is found,
warn: "NI-NNN already covers this — append a new entry, update
the existing one (manual edit, out of skill scope), or skip?"
Defer to the user.

**Registry file missing.** Stop and direct the user to
scaffold it per `docs/audits/README.md`. Do not create the
registry from this skill — file creation is a project-bootstrap
concern, not a promotion concern.

**Registry contains the `_None yet._` placeholder.** This is
the empty-state marker from scaffold. The Bash append would
leave it above the new entries, which is wrong. Before the
append, remove it:

```bash
# BSD sed (macOS) requires '' after -i; GNU sed (Linux) does not.
# The period is escaped so the pattern doesn't match arbitrary chars.
if [[ "$OSTYPE" == "darwin"* ]]; then
  sed -i '' '/^_None yet\._$/d' docs/audits/_known-non-issues.md
else
  sed -i '/^_None yet\._$/d' docs/audits/_known-non-issues.md
fi
```

Then run the heredoc append.

**Bash append fails.** Stop and report the error verbatim. Do
not retry with a different mechanism — the protect-audits hook
is in place by design, and a workaround that succeeds by
accident is worse than a failure that surfaces correctly.

**Pre-baked input mixes accepted and rejected items.** The
transient wont-fix list from Claude-project triage should
contain only accepted items. If the user pastes raw audit
content or a mixed list, ask which finding IDs to append before
proceeding — do not infer.

**Audit IDs use unfamiliar prefixes.** Some audits use `F1`/`F2`,
others use `F-NIT-1`/`F-NIT-2`, others use `Q1` for questions.
Preserve whatever the audit uses verbatim. Don't normalize.
`Q1`-style IDs typically aren't promotion candidates (they're
questions for human, not findings), but if the user explicitly
selects one as wont-fix material, accept the selection.

## What this skill is not

- Not a triage tool. Triage happens in the duly_noted Claude
  project.
- Not a fix tool. Fixes use a separate workflow against the
  audit's fix-brief artifact.
- Not a withdrawal tool. Marking `Withdrawn` is a manual edit
  outside Claude Code.
- Not a promotion tool. Updating a single entry's `Status:` line
  to `Promoted (see SPEC.md#section)` or `Promoted (see ADR-NNNN)`
  is a manual CC edit — the registry is append-only via this
  skill, and status changes touch existing entries.
- Not a registry-creation tool. The registry's existence is a
  bootstrap concern; this skill assumes it exists.
