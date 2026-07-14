#!/usr/bin/env bash
# Turnkey runner for the partner-intake emulator gate. Offline/CI-safe.
#   npm run qa:partner
set -euo pipefail
cd "$(dirname "$0")/.."
export GCLOUD_PROJECT="${GCLOUD_PROJECT:-demo-pulse}"
export VITE_USE_EMULATOR=true
export PORT=8090
export API_BASE="http://127.0.0.1:8090"
# Test-only key so PAN-encryption paths are exercised in the emulator gate.
export PAN_ENCRYPTION_KEY="${PAN_ENCRYPTION_KEY:-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef}"
npx firebase emulators:exec --only auth,firestore --project "$GCLOUD_PROJECT" \
  "bash .qa/_gate-inner.sh partner-gate.mjs"
