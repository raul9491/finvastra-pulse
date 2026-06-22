#!/usr/bin/env bash
# Runs INSIDE `firebase emulators:exec`. Starts dev server, waits, runs the gate(s) passed as args.
set -uo pipefail
cd "$(dirname "$0")/.."
npx tsx server.ts >/tmp/gate-server.log 2>&1 &
SERVER_PID=$!
cleanup() { kill "$SERVER_PID" 2>/dev/null || true; }
trap cleanup EXIT
for _ in $(seq 1 80); do
  if curl -sf "${API_BASE:-http://127.0.0.1:8090}/api/health" >/dev/null 2>&1; then break; fi
  sleep 0.5
done
RC=0
for g in "$@"; do
  echo "═══════════ $g ═══════════"
  node ".qa/$g" || RC=1
done
exit $RC
