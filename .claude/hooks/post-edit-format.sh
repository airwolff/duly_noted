#!/usr/bin/env bash
# post-edit-format.sh — auto-prettier code files after edits
set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

[[ -z "$FILE_PATH" ]] && exit 0
[[ ! -f "$FILE_PATH" ]] && exit 0

# Only format code/config files prettier handles
case "$FILE_PATH" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.json|*.md|*.yaml|*.yml|*.css)
    cd "$CLAUDE_PROJECT_DIR" 2>/dev/null || cd "$(git rev-parse --show-toplevel)"
    npx --no-install prettier --write "$FILE_PATH" 2>/dev/null || true
    ;;
esac

exit 0
