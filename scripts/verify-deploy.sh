#!/usr/bin/env bash
# Post-deploy smoke test. Run after deploying (npm run verify:deploy).
# Catches the exact failure modes from the 2026-06-10 incident:
#   1. App shell unreachable (hosting broken)
#   2. API up but Firestore read failing (quota / outage)  <- a plain "200?" check misses this
#   3. Security rules NOT bound to the DB, or bound but empty/locked (deny-all)
# Exits non-zero if any check fails, so you never declare a deploy "done" while broken.
set -u
PROJ=gen-lang-client-0643641184
DB=pulse
API=https://pulse-api-787616231546.asia-south1.run.app
APP=https://pulse.finvastra.com
fail=0

echo "1) App shell ($APP) ..."
code=$(curl -s -o /dev/null -w "%{http_code}" "$APP/")
if [ "$code" = "200" ]; then echo "   OK ($code)"; else echo "   FAIL ($code)"; fail=1; fi

echo "2) API + DB deep health ($API/api/health/deep) ..."
code=$(curl -s -o /dev/null -w "%{http_code}" "$API/api/health/deep")
if [ "$code" = "200" ]; then echo "   OK ($code) — Firestore read succeeded"; else echo "   FAIL ($code) — API down or Firestore read failing"; fail=1; fi

echo "3) Firestore rules bound to '$DB' with real content ..."
TOKEN=$(gcloud auth print-access-token 2>/dev/null)
RS=$(curl -s -H "Authorization: Bearer $TOKEN" -H "X-Goog-User-Project: $PROJ" \
  "https://firebaserules.googleapis.com/v1/projects/$PROJ/releases?pageSize=50" \
  | grep -A2 "cloud.firestore/$DB\"" | grep -oE 'rulesets/[a-z0-9-]+' | head -1)
if [ -n "$RS" ]; then
  if curl -s -H "Authorization: Bearer $TOKEN" -H "X-Goog-User-Project: $PROJ" \
       "https://firebaserules.googleapis.com/v1/projects/$PROJ/$RS" | grep -q "function isSignedIn"; then
    echo "   OK — real ruleset bound ($RS)"
  else
    echo "   FAIL — a ruleset is bound but missing real rules (likely default/locked)"; fail=1
  fi
else
  echo "   FAIL — NO ruleset bound to '$DB' (default deny-all → every read denied!)"; fail=1
fi

echo "----------------------------------------"
if [ "$fail" = "0" ]; then echo "✅ All deploy checks passed."; else echo "❌ Deploy checks FAILED — investigate before declaring done."; exit 1; fi
