#!/usr/bin/env bash
# Turnkey runner for the two-stage lead-SLA emulator gate — boots auth+firestore
# emulators + the dev server, runs .qa/crm2-sla-gate.mjs, tears down. Offline/CI-safe.
#   npm run qa:sla
set -euo pipefail
cd "$(dirname "$0")/.."

export GCLOUD_PROJECT="${GCLOUD_PROJECT:-demo-pulse}"
export VITE_USE_EMULATOR=true
export PORT=8090
export API_BASE="http://127.0.0.1:8090"

npx firebase emulators:exec --only auth,firestore --project "$GCLOUD_PROJECT" \
  "bash .qa/_sla-gate-inner.sh"
