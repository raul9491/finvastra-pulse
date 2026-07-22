#!/usr/bin/env bash
# Runs INSIDE `firebase emulators:exec` (emulator hosts already in env). Starts a
# fresh dev server for THIS gate (its own env), waits for health, runs the Meta
# gate, tears down. Not called directly.
set -uo pipefail
cd "$(dirname "$0")/.."
source .qa/_server-lifecycle.sh
start_gate_server || exit 1
node .qa/crm2-meta-gate.mjs
exit $?
