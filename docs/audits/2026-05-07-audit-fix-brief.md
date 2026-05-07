# Audit fix brief — 2026-05-06 spine scaffold (third pass)

Source audit: docs/audits/2026-05-06-spine-scaffold-3.md

## Fixes

### F1 — Remove orphaned pre-slice-scaffold-spec.md
- File: pre-slice-scaffold-spec.md (repo root)
- Action: git rm pre-slice-scaffold-spec.md
- Rationale: One-shot bootstrap input. Has no live reference in README,
  SPEC.md, or CLAUDE.md. Stated function ended when the scaffold shipped.
  Git history preserves the content for any future archaeology. Removing
  prevents new contributors from treating it as a live second source of
  truth alongside SPEC.md.
- Validation:
  - `grep -rn "pre-slice-scaffold-spec" .` returns zero matches
  - `pnpm -r typecheck && pnpm -r lint && pnpm -r test` still pass

## Doc changes (apply manually, not via this brief)

- SPEC.md CI/CD migrations bullet — see triage output for replacement text
- CLAUDE.md §6 hard rules — optional addition for backwards-compat migrations

## Out of scope

- Q1 (Conventional Commits) — accepted as wont-fix; promotion brief separate
- Q2 code-side enforcement — deferred to Slice 2; SPEC.md amendment only

## Commit

```
chore: remove orphaned pre-slice-scaffold-spec.md (audit F1)
```
