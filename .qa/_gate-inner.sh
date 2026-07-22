#!/usr/bin/env bash
# Runs INSIDE `firebase emulators:exec`. Starts a fresh dev server for THIS gate,
# waits for health, runs the gate(s) passed as args, tears down.
set -uo pipefail
cd "$(dirname "$0")/.."
source .qa/_server-lifecycle.sh
start_gate_server || exit 1
RC=0
for g in "$@"; do
  echo "═══════════ $g ═══════════"
  node ".qa/$g" || RC=1
done
exit $RC
