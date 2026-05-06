---
name: promote-to-non-issue
description: Append accepted audit findings to docs/audits/_known-non-issues.md as wont-fix registry entries. Appends via Bash heredoc (the protect-audits hook blocks Write/Edit on the registry by design). Use when the user wants to promote, accept, register, or mark audit findings as wont-fix or known non-issues. Trigger on phrases like "promote findings", "accept as wont-fix", "add to known non-issues", "register these findings", "mark as accepted", or any reference to an audit file paired with intent to record items as wont-fix. Walks the user through finding selection, reasoning capture, and confirmation before any write. Append-only on _known-non-issues.md; reads but does not modify audit files; never edits existing registry entries.
---

# promote-to-non-issue

Take accepted findings from a dated audit report and append them
to `docs/audits/_known-non-issues.md` as durable wont-fix entries.
The registry is append-only — entries get a stable `NI-NNN` ID,
today's date, the user's reasoning, a revisit trigger, and a
citation back to the originating audit.

## Hook interaction

The `pre-edit-protect-audits.sh` hook blocks Write/Edit/MultiEdit
on `_known-non-issues.md` to prevent arbitrary modification of the
registry. This skill writes via **Bash heredoc** (`cat >> file <<'EOF'`),
which doesn't match the hook's matcher and is allowed through.

This is deliberate. Do not attempt to use the Write or Edit tool
on the registry — that path is intentionally blocked.

## When to use

After triaging an audit (typically in the duly_noted Claude
Project) and deciding which findings to record as accepted
wont-fixes. Triggers: "promote these findings", "accept #6 and #9
as wont-fix", "add these to the registry".

## Hard rules

- **Bash-append only.** Use `cat >> _known-non-issues.md <<'EOF'`
  to append. Do not use Write or Edit on the registry.
- **Never modify other files.** No source edits, no audit-file
  edits, no skill mutations.
- **Never modify existing registry entries.** Append-only.
- **Never invent reasoning.** If user input is vague, push back.
- **Never accept a finding the user did not explicitly select.**
- **Never write until the user explicitly confirms.**
- **Stop on missing files.** If audit or registry is missing,
  stop and report.

## Workflow

### 1. Identify the audit

Ask which audit file. Expect a path like
`docs/audits/2026-05-06-spine-scaffold.md`.

If not provided, list dated audit files in `docs/audits/` (skip
`README.md` and `_known-non-issues.md`) and ask.

### 2. Read the audit and the registry

Read the chosen audit file. Extract every Finding (ID, severity,
one-sentence summary, file:line). Skip Questions for human,
Reopen candidates, mechanical pass results, and "What NOT to fix"
sections.

Read `docs/audits/_known-non-issues.md` and note the highest
existing `NI-NNN` ID. Continue from there. If empty, start at
`NI-001`.

### 3. Show eligible findings

Print a numbered checklist:

```
Findings in 2026-05-06-spine-scaffold.md:
  [1] Finding 1 (BLOCKER) — Worker will crash on Render…
  [2] Finding 2 (HIGH)    — Open redirect on /auth/callback
  [3] Finding 3 (MEDIUM)  — Worker holds an env var it never reads
  ...
```

Ask which to accept as wont-fix. Accept replies as numbers, severity
groups, or natural language.

### 4. Capture reasoning per finding

For each selected finding, ask in one message:

```
Finding 6 — Webhook secret compared with non-constant-time !==

  Reasoning: why is this acceptable now?
  Revisit trigger: what condition should reopen it, or "permanent"?
```

Wait for reply before next finding. One at a time.

If vague ("it's fine for now"), push back: ask what specifically
makes it fine, what would make it not fine. No vague entries.

### 5. Show the proposed markdown

Once all selected findings have reasoning and revisit triggers,
show the exact markdown:

```markdown
## NI-NNN: <short title from finding summary>

- Status: Accepted
- Source: docs/audits/<filename>#finding-N
- Date accepted: YYYY-MM-DD
- Scope: <files or component this applies to>
- Reasoning: <user's reasoning, lightly cleaned>
- Revisit when: <user's trigger, or "permanent">
```

`NI-NNN` continues monotonically. Date in `YYYY-MM-DD`.

### 6. Confirm and append via Bash

Ask: "Append these N entries to `_known-non-issues.md`?"

Only "yes", "append", "go", "confirm", or equivalent triggers the
write.

On confirmation, use Bash to append. Construct the heredoc with
all approved entries:

```bash
cat >> docs/audits/_known-non-issues.md <<'NEW_ENTRIES'

## NI-001: Webhook secret compared with non-constant-time !==
- Status: Accepted
- Source: docs/audits/2026-05-06-spine-scaffold.md#finding-6
- Date accepted: 2026-05-07
- Scope: apps/web/src/app/api/webhooks/asr/route.ts
- Reasoning: 501 stub handler — comparison logic isn't on a hot path until Slice 3.
- Revisit when: Webhook handler ships and starts processing real ASR callbacks.

## NI-002: loadEnv caching divergence
- Status: Accepted
- Source: docs/audits/2026-05-06-spine-scaffold.md#finding-9
- Date accepted: 2026-05-07
- Scope: apps/web/env.ts, apps/worker/src/env.ts, apps/worker-cron/src/env.ts
- Reasoning: Workers call loadEnv once at boot — functionally identical to caching.
- Revisit when: Any worker calls loadEnv inside a hot path.

NEW_ENTRIES
```

Important details for the heredoc:

- Use a unique sentinel like `NEW_ENTRIES` (avoids collision with
  any `EOF` content in user reasoning)
- Quote the sentinel (`<<'NEW_ENTRIES'`) to prevent variable
  interpolation in entry text
- Leading blank line in the heredoc preserves separation from the
  previous entry
- Run from the repo root (or use `$CLAUDE_PROJECT_DIR/`)

After running the bash command, verify the append by reading the
last N entries and confirming they match what you proposed.

Print the new IDs and exit.

## Edge cases

**Audit has zero Findings.** Stop and report.

**User selects a finding already in the registry.** Check by
file:line and finding wording. Warn: "NI-NNN already covers this
— update or skip?"

**Registry file missing.** Stop and direct the user to run the
scaffold prompt.

**Registry contains the placeholder `_None yet._`.** This is the
empty-state marker from the scaffold. The Bash append will leave
it in place above the new entries, which is wrong. Before
appending, use Bash to remove the placeholder:

```bash
sed -i '' '/^_None yet._$/d' docs/audits/_known-non-issues.md
```

(Use `sed -i ''` on macOS, `sed -i` on Linux. Detect platform if
needed.) Then run the heredoc append.

**Bash append fails.** If the heredoc fails for any reason
(permissions, disk full, syntax error in entry text), stop and
report. Do not retry with a different mechanism — the protect-audits
hook is in place for a reason.

## What this skill is not

- Not a triage tool. Triage happens in the Claude Project.
- Not a fix tool. Fixes use `apply-audit-fixes`.
- Not a withdrawal tool. Marking Withdrawn is a manual edit done
  outside Claude Code.
