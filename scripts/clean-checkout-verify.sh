#!/bin/bash
# Verify the committed code from a CLEAN checkout (no local node_modules, build, data or untracked files):
#   npm ci  ->  npm run verify (typecheck, unit tests, build)  ->  npm run e2e (the whole browser suite)
# Writes the exit status of each command and the summary lines to docs/qa/verify-<commit>.txt. Full logs stay in the temp folder it prints.
# Usage: scripts/clean-checkout-verify.sh            (verifies HEAD)      E2E=0 scripts/clean-checkout-verify.sh   (skip the browser suite)
set -u
SRC="$(git rev-parse --show-toplevel)"; FULL="$(git -C "$SRC" rev-parse HEAD)"; SHORT="${FULL:0:7}"
OUT="$SRC/docs/qa"; mkdir -p "$OUT"; REPORT="$OUT/verify-$SHORT.txt"
W="$(mktemp -d "/tmp/jarvis clean checkout XXXX")"
{ echo "Clean-checkout verification of $FULL"; echo "Started $(date -u +%FT%TZ) in $W (a path with spaces)"; echo "Node $(node -v), npm $(npm -v)"; echo; } > "$REPORT"
step() { local name="$1"; shift; local log="$W/$name.log"; ( "$@" ) > "$log" 2>&1; local code=$?; echo "$name: exit $code" | tee -a "$REPORT"; return $code; }
git clone -q "$SRC" "$W/repo" && git -C "$W/repo" checkout -q "$FULL" || { echo "clone failed" | tee -a "$REPORT"; exit 1; }
cd "$W/repo" || exit 1
echo "clean tree: $(git status --porcelain | wc -l) uncommitted files" | tee -a "$REPORT"
step "npm-ci" npm ci || { echo "FAILED at npm ci"; exit 1; }
step "verify" npm run verify; V=$?
grep -E "Test Files|Tests " "$W/verify.log" | sed 's/^/  /' >> "$REPORT"
if [ "${E2E:-1}" = "1" ]; then
  step "e2e" npm run e2e; E=$?
  grep -E "checks passed|FAIL|ASSERT" "$W/e2e.log" | sed 's/^/  /' >> "$REPORT"
fi
echo >> "$REPORT"; echo "Finished $(date -u +%FT%TZ). Full logs: $W" >> "$REPORT"
echo "Report: $REPORT"
