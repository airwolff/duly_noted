#!/usr/bin/env bash
# pre-edit-protect-audits.sh — block direct edits to audit files
set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

[[ -z "$FILE_PATH" ]] && exit 0

# Strip any leading project dir to normalize
REL_PATH="${FILE_PATH#$CLAUDE_PROJECT_DIR/}"

# Allow brand-new files through — only block edits to existing audit history
[[ ! -e "$FILE_PATH" ]] && exit 0

# Block edits to dated audit files (anything in docs/audits/ NOT starting with _ or named README.md)
if echo "$REL_PATH" | grep -qE '^docs/audits/[^_/][^/]*\.md$' && \
   ! echo "$REL_PATH" | grep -qE '^docs/audits/README\.md$'; then
  echo "Blocked: dated audit files are append-only and written by the code-audit skill only." >&2
  echo "If you need to correct an audit, write a new dated audit instead." >&2
  exit 2
fi

# Block direct edits to the registry — must go through promote-to-non-issue skill
if [[ "$REL_PATH" == "docs/audits/_known-non-issues.md" ]]; then
  echo "Blocked: _known-non-issues.md is written via the promote-to-non-issue skill only." >&2
  echo "To accept a finding as wont-fix, invoke that skill from a triaged audit." >&2
  exit 2
fi

exit 0
