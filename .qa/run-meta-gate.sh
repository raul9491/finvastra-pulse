#!/usr/bin/env bash
# Turnkey runner for the Meta webhook emulator gate — boots auth+firestore
# emulators, starts the dev server pointed at an in-process mock Graph API, runs
# .qa/crm2-meta-gate.mjs, then tears everything down. Offline / CI-safe (no real
# Meta token or network). Exits non-zero if the gate fails.
#
#   npm run qa:meta
set -euo pipefail
cd "$(dirname "$0")/.."

# Test-only secrets (never real) — shared by the server and the gate via env.
export GCLOUD_PROJECT="${GCLOUD_PROJECT:-demo-pulse}"
export VITE_USE_EMULATOR=true
export PORT=8090
export API_BASE="http://127.0.0.1:8090"
export META_APP_SECRET="gate_secret"
export META_VERIFY_TOKEN="gate_verify_token"
export META_PAGE_ACCESS_TOKEN="gate_page_token"
export META_GRAPH_VERSION="v23.0"
export META_GRAPH_MOCK_PORT=8099
export META_GRAPH_BASE="http://127.0.0.1:8099"

# emulators:exec starts auth+firestore (fresh, no import), injects
# FIRESTORE_EMULATOR_HOST + FIREBASE_AUTH_EMULATOR_HOST, runs the inner script,
# and propagates its exit code.
npx firebase emulators:exec --only auth,firestore --project "$GCLOUD_PROJECT" \
  "bash .qa/_meta-gate-inner.sh"
