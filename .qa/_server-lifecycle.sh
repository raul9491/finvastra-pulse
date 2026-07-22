#!/usr/bin/env bash
# Shared dev-server lifecycle for the emulator gates. Sourced by the _*-gate-inner.sh
# scripts — not run directly.
#
# WHY THIS EXISTS (bug fixed 2026-07-22): every gate must run against a server started
# with ITS OWN env — only run-partner-gate.sh sets PAN_ENCRYPTION_KEY, only
# run-meta-gate.sh sets META_*. The old scripts did:
#
#     npx tsx server.ts &        # npx spawns a CHILD node process
#     SERVER_PID=$!
#     cleanup() { kill "$SERVER_PID"; }
#
# which kills the npx wrapper but NOT the node child holding the port, so the server
# LEAKED. The health check then broke on the first server that answered — i.e. the
# leaked one from the previous gate. In CI all four gates run back-to-back in one job,
# so: meta started a server (META_* env) and leaked it; sla + queue silently reused it
# (they need no special env, so they passed); partner reused it too, but that server
# had NO PAN_ENCRYPTION_KEY, so its PAN-encryption assertions failed. Result: CI red on
# `qa:partner` for every push while each gate passed in isolation locally.
#
# The fix: free the port BEFORE starting (never inherit another gate's server), kill the
# whole process tree on exit, and FAIL LOUDLY if the server never becomes healthy instead
# of silently testing against the wrong one.
API="${API_BASE:-http://127.0.0.1:8090}"

_server_health() { curl -sf "$API/api/health" >/dev/null 2>&1; }

# Kill any gate server (ours or a leftover) and wait until the port stops answering.
free_gate_port() {
  if [ -n "${SERVER_PID:-}" ]; then kill "$SERVER_PID" 2>/dev/null || true; fi
  if command -v pkill >/dev/null 2>&1; then pkill -f "tsx server.ts" 2>/dev/null || true; fi
  for _ in $(seq 1 40); do
    _server_health || return 0
    sleep 0.5
  done
  return 0
}

# Start a fresh server for THIS gate and block until it is genuinely healthy.
start_gate_server() {
  free_gate_port                       # never inherit a previous gate's server
  npx tsx server.ts >/tmp/gate-server.log 2>&1 &
  SERVER_PID=$!
  trap free_gate_port EXIT
  for _ in $(seq 1 120); do            # up to ~60s — CI runners are slower than dev machines
    if _server_health; then return 0; fi
    sleep 0.5
  done
  echo "gate: dev server never became healthy on $API" >&2
  tail -n 30 /tmp/gate-server.log >&2 2>/dev/null || true
  return 1
}
