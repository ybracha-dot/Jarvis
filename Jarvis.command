#!/bin/bash
# Double-click in Finder (or run ./Jarvis.command): starts Jarvis and its worker and opens private Today.
# Works from any folder name, including ones with spaces. If macOS says it cannot be opened, right-click it, choose Open, then Open.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then echo "Node is not installed. Install Node 22 from https://nodejs.org (or: brew install node), then double-click this again."; read -r -p "Press Return to close."; exit 1; fi
node scripts/jarvis.mjs "$@"
code=$?
if [ $code -ne 0 ]; then echo; echo "Jarvis did not start. The lines above say why."; read -r -p "Press Return to close."; fi
exit $code
