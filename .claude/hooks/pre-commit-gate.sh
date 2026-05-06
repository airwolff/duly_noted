#!/usr/bin/env bash
# pre-commit-gate.sh — block commits/pushes if lint or typecheck fail
set -euo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Only fire on commit or push
if ! echo "$COMMAND" | grep -qE 'git\s+(commit|push)'; then
  exit 0
fi

# Skip for amend-only commits (assume already gated)
if echo "$COMMAND" | grep -qE 'git\s+commit\s+--amend\s+--no-edit'; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR" 2>/dev/null || cd "$(git rev-parse --show-toplevel)"

if ! pnpm -s lint > /tmp/duly-lint.log 2>&1; then
  echo "Blocked: pnpm lint failed. See /tmp/duly-lint.log" >&2
  exit 2
fi

if ! pnpm -s typecheck > /tmp/duly-typecheck.log 2>&1; then
  echo "Blocked: pnpm typecheck failed. See /tmp/duly-typecheck.log" >&2
  exit 2
fi

exit 0
