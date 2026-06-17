#!/usr/bin/env bash
# Runs INSIDE `firebase emulators:exec` (emulator hosts already in env). Starts the
# dev server, waits for health, runs the SLA gate, tears down. Not called directly.
set -uo pipefail
cd "$(dirname "$0")/.."

npx tsx server.ts &
SERVER_PID=$!
cleanup() { kill "$SERVER_PID" 2>/dev/null || true; }
trap cleanup EXIT

for _ in $(seq 1 60); do
  if curl -sf "${API_BASE:-http://127.0.0.1:8090}/api/health" >/dev/null 2>&1; then break; fi
  sleep 0.5
done

node .qa/crm2-sla-gate.mjs
exit $?
