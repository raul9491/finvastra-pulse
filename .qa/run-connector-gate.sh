#!/usr/bin/env bash
# Turnkey runner for the connector-isolation emulator gate. Offline/CI-safe.
#   npm run qa:connector
#
# This gate reads Firestore DIRECTLY with each principal's ID token (not via the
# API), so it exercises firestore.rules — the only real boundary between one
# connector and another.
set -euo pipefail
cd "$(dirname "$0")/.."
export GCLOUD_PROJECT="${GCLOUD_PROJECT:-demo-pulse}"
export VITE_USE_EMULATOR=true
export PORT=8090
export API_BASE="http://127.0.0.1:8090"
export PAN_ENCRYPTION_KEY="${PAN_ENCRYPTION_KEY:-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef}"
npx firebase emulators:exec --only auth,firestore --project "$GCLOUD_PROJECT" \
  "bash .qa/_gate-inner.sh connector-isolation-gate.mjs"
