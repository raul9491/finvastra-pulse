#!/usr/bin/env bash
# Phase P — functional use-case QA against the Firebase emulators.
# Creates a test super admin (REAL hardcoded UID) + a plain employee, then
# exercises every new rules surface with their actual ID tokens.
set -u
PROJ=gen-lang-client-0643641184
AUTH="http://localhost:9099/identitytoolkit.googleapis.com/v1"
FS="http://localhost:8080/v1/projects/$PROJ/databases/(default)/documents"
FSQ="http://localhost:8080/v1/projects/$PROJ/databases/(default)/documents:runQuery"
SA_UID="5lAbJ4CZ5uM0LbU4gUYItNRAlEn2"   # hardcoded SA (Rahul) — emulator-only test account
PASS=0; FAIL=0

check () { # name expected actual
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ✓ $1"; else FAIL=$((FAIL+1)); echo "  ✗ $1  (expected $2, got $3)"; fi
}
code () { curl -s -o /tmp/qa_body.json -w "%{http_code}" "$@"; }

echo "── setup: accounts ─────────────────────────────────────"
# SA with the real hardcoded UID (privileged emulator signUp)
curl -s -X POST -H "Authorization: Bearer owner" -H "Content-Type: application/json" \
  "$AUTH/accounts:signUp?key=fake" \
  -d "{\"localId\":\"$SA_UID\",\"email\":\"qa-sa@finvastra.com\",\"password\":\"QaTest@123\"}" >/dev/null
# Plain employee (random uid)
EMP_RESP=$(curl -s -X POST -H "Content-Type: application/json" \
  "$AUTH/accounts:signUp?key=fake" \
  -d '{"email":"qa-emp@finvastra.com","password":"QaTest@123","returnSecureToken":true}')
EMP_UID=$(echo "$EMP_RESP" | grep -oE '"localId": ?"[^"]+"' | head -1 | sed 's/.*: *"//; s/"//')
EMP_TOKEN=$(echo "$EMP_RESP" | grep -oE '"idToken": ?"[^"]+"' | head -1 | sed 's/.*: *"//; s/"//')
SA_TOKEN=$(curl -s -X POST -H "Content-Type: application/json" \
  "$AUTH/accounts:signInWithPassword?key=fake" \
  -d '{"email":"qa-sa@finvastra.com","password":"QaTest@123","returnSecureToken":true}' \
  | grep -oE '"idToken": ?"[^"]+"' | head -1 | sed 's/.*: *"//; s/"//')
[ -n "$SA_TOKEN" ] && [ -n "$EMP_TOKEN" ] && echo "  tokens acquired (emp=$EMP_UID)" || { echo "  TOKEN FAILURE"; exit 1; }

# Seed /users docs via owner bypass (bootstrap — not under test)
curl -s -X PATCH -H "Authorization: Bearer owner" -H "Content-Type: application/json" \
  "$FS/users/$SA_UID" -d '{"fields":{"userId":{"stringValue":"'$SA_UID'"},"email":{"stringValue":"qa-sa@finvastra.com"},"displayName":{"stringValue":"QA Super Admin"},"role":{"stringValue":"admin"},"photoURL":{"stringValue":""},"hrmsAccess":{"booleanValue":true},"crmAccess":{"booleanValue":true}}}' >/dev/null
curl -s -X PATCH -H "Authorization: Bearer owner" -H "Content-Type: application/json" \
  "$FS/users/$EMP_UID" -d '{"fields":{"userId":{"stringValue":"'$EMP_UID'"},"email":{"stringValue":"qa-emp@finvastra.com"},"displayName":{"stringValue":"QA Employee"},"role":{"stringValue":"employee"},"photoURL":{"stringValue":""},"hrmsAccess":{"booleanValue":true},"crmAccess":{"booleanValue":false}}}' >/dev/null
# A CRM doc to read (hasCrmAccess-gated)
curl -s -X PATCH -H "Authorization: Bearer owner" -H "Content-Type: application/json" \
  "$FS/opportunity_types/qa_type" -d '{"fields":{"name":{"stringValue":"QA Loan"},"businessLine":{"stringValue":"loan"},"active":{"booleanValue":true}}}' >/dev/null

echo "── P1: page sharing ────────────────────────────────────"
c=$(code "$FS/opportunity_types/qa_type" -H "Authorization: Bearer $EMP_TOKEN")
check "employee WITHOUT share cannot read CRM data" 403 "$c"
c=$(code -X POST -H "Authorization: Bearer $EMP_TOKEN" -H "Content-Type: application/json" \
  "$FS/page_shares" -d '{"fields":{"grantedTo":{"stringValue":"'$EMP_UID'"},"active":{"booleanValue":true}}}')
check "employee cannot CREATE a share" 403 "$c"
c=$(code -X PATCH -H "Authorization: Bearer $SA_TOKEN" -H "Content-Type: application/json" \
  "$FS/page_shares/qa_share1" -d '{"fields":{"grantedTo":{"stringValue":"'$EMP_UID'"},"grantedToName":{"stringValue":"QA Employee"},"grantedToEmail":{"stringValue":"qa-emp@finvastra.com"},"grantedBy":{"stringValue":"'$SA_UID'"},"grantedByName":{"stringValue":"QA Super Admin"},"pageKey":{"stringValue":"crm.dashboard"},"pageTitle":{"stringValue":"CRM Dashboard"},"pageRoute":{"stringValue":"/crm/dashboard"},"module":{"stringValue":"crm"},"icon":{"stringValue":"LayoutDashboard"},"active":{"booleanValue":true},"grantedAt":{"timestampValue":"2026-06-11T10:00:00Z"},"revokedAt":{"nullValue":null},"revokedBy":{"nullValue":null},"revokedByName":{"nullValue":null},"note":{"nullValue":null}}}')
check "SA CAN create a share" 200 "$c"
c=$(code -X PATCH -H "Authorization: Bearer $SA_TOKEN" -H "Content-Type: application/json" \
  "$FS/users/$EMP_UID?updateMask.fieldPaths=sharedModules" -d '{"fields":{"sharedModules":{"arrayValue":{"values":[{"stringValue":"crm"}]}}}}')
check "SA can set sharedModules on the user" 200 "$c"
c=$(code "$FS/opportunity_types/qa_type" -H "Authorization: Bearer $EMP_TOKEN")
check "employee WITH crm share CAN read CRM data (sharedModules fallback)" 200 "$c"
c=$(code "$FS/page_shares/qa_share1" -H "Authorization: Bearer $EMP_TOKEN")
check "employee can read their OWN share doc" 200 "$c"
c=$(code -X PATCH -H "Authorization: Bearer $EMP_TOKEN" -H "Content-Type: application/json" \
  "$FS/page_shares/qa_share1?updateMask.fieldPaths=active" -d '{"fields":{"active":{"booleanValue":true}}}')
check "employee cannot UPDATE a share" 403 "$c"
c=$(code -X PATCH -H "Authorization: Bearer $SA_TOKEN" -H "Content-Type: application/json" \
  "$FS/page_shares/qa_share1?updateMask.fieldPaths=pageRoute" -d '{"fields":{"pageRoute":{"stringValue":"/hacked"}}}')
check "even SA cannot change non-revoke fields on a share" 403 "$c"
c=$(code -X DELETE -H "Authorization: Bearer $SA_TOKEN" "$FS/page_shares/qa_share1")
check "shares can never be deleted" 403 "$c"
# revoke + remove module
curl -s -X PATCH -H "Authorization: Bearer $SA_TOKEN" -H "Content-Type: application/json" \
  "$FS/page_shares/qa_share1?updateMask.fieldPaths=active&updateMask.fieldPaths=revokedAt&updateMask.fieldPaths=revokedBy&updateMask.fieldPaths=revokedByName" \
  -d '{"fields":{"active":{"booleanValue":false},"revokedAt":{"timestampValue":"2026-06-11T11:00:00Z"},"revokedBy":{"stringValue":"'$SA_UID'"},"revokedByName":{"stringValue":"QA Super Admin"}}}' >/dev/null
curl -s -X PATCH -H "Authorization: Bearer $SA_TOKEN" -H "Content-Type: application/json" \
  "$FS/users/$EMP_UID?updateMask.fieldPaths=sharedModules" -d '{"fields":{"sharedModules":{"arrayValue":{}}}}' >/dev/null
c=$(code "$FS/opportunity_types/qa_type" -H "Authorization: Bearer $EMP_TOKEN")
check "after revoke, employee loses CRM data access again" 403 "$c"

echo "── P2: superAdmin flag + log ───────────────────────────"
c=$(code -X PATCH -H "Authorization: Bearer $SA_TOKEN" -H "Content-Type: application/json" \
  "$FS/super_admin_log/qa_log1" -d '{"fields":{"promotedUid":{"stringValue":"x"},"promotedName":{"stringValue":"X"},"promotedBy":{"stringValue":"'$SA_UID'"},"promotedByName":{"stringValue":"QA Super Admin"},"action":{"stringValue":"promote"},"reason":{"nullValue":null},"promotedAt":{"timestampValue":"2026-06-11T10:00:00Z"}}}')
check "SA can write super_admin_log" 200 "$c"
c=$(code "$FS/super_admin_log/qa_log1" -H "Authorization: Bearer $EMP_TOKEN")
check "employee cannot read super_admin_log" 403 "$c"

echo "── P4: presence ────────────────────────────────────────"
c=$(code -X PATCH -H "Authorization: Bearer $EMP_TOKEN" -H "Content-Type: application/json" \
  "$FS/presence/lead:qa1/viewers/$EMP_UID" -d '{"fields":{"uid":{"stringValue":"'$EMP_UID'"},"displayName":{"stringValue":"QA Employee"},"avatarInitials":{"stringValue":"QE"},"lastSeen":{"timestampValue":"2026-06-11T10:00:00Z"},"pageKey":{"stringValue":"lead:qa1"}}}')
check "user can write own presence doc" 200 "$c"
c=$(code -X PATCH -H "Authorization: Bearer $EMP_TOKEN" -H "Content-Type: application/json" \
  "$FS/presence/lead:qa1/viewers/$SA_UID" -d '{"fields":{"uid":{"stringValue":"'$SA_UID'"}}}')
check "user cannot write someone else's presence doc" 403 "$c"
c=$(code "$FS/presence/lead:qa1/viewers/$EMP_UID" -H "Authorization: Bearer $SA_TOKEN")
check "any signed-in user can read presence" 200 "$c"

echo "── P5: commission disputes ─────────────────────────────"
c=$(code -X PATCH -H "Authorization: Bearer $SA_TOKEN" -H "Content-Type: application/json" \
  "$FS/commission_disputes/qa_d1" -d '{"fields":{"commissionRecordId":{"stringValue":"r1"},"statementLineId":{"stringValue":"l1"},"providerId":{"stringValue":"p1"},"providerName":{"stringValue":"QA Bank"},"opportunityId":{"stringValue":"o1"},"leadName":{"stringValue":"QA Lead"},"expectedAmount":{"integerValue":"10000"},"receivedAmount":{"integerValue":"8000"},"variance":{"integerValue":"-2000"},"variancePct":{"doubleValue":20},"status":{"stringValue":"open"},"priority":{"stringValue":"medium"},"assignedTo":{"nullValue":null},"notes":{"arrayValue":{}},"createdAt":{"timestampValue":"2026-06-11T10:00:00Z"},"createdBy":{"stringValue":"system"}}}')
check "admin can create a dispute" 200 "$c"
c=$(code "$FS/commission_disputes/qa_d1" -H "Authorization: Bearer $EMP_TOKEN")
check "employee without misAccess cannot read disputes" 403 "$c"
c=$(code -X DELETE -H "Authorization: Bearer $SA_TOKEN" "$FS/commission_disputes/qa_d1")
check "disputes can never be deleted" 403 "$c"

echo "── P6: lead-level activities + edit window ─────────────"
# Lead owned by employee (owner bypass bootstrap); give employee crm share again for hasCrmAccess
curl -s -X PATCH -H "Authorization: Bearer $SA_TOKEN" -H "Content-Type: application/json" \
  "$FS/users/$EMP_UID?updateMask.fieldPaths=sharedModules" -d '{"fields":{"sharedModules":{"arrayValue":{"values":[{"stringValue":"crm"}]}}}}' >/dev/null
curl -s -X PATCH -H "Authorization: Bearer owner" -H "Content-Type: application/json" \
  "$FS/leads/qa_lead1" -d '{"fields":{"displayName":{"stringValue":"QA Lead"},"phone":{"stringValue":"9876543210"},"source":{"stringValue":"walkin"},"primaryOwnerId":{"stringValue":"'$EMP_UID'"},"consentGiven":{"booleanValue":true},"consentMethod":{"stringValue":"verbal"},"tags":{"arrayValue":{}},"deleted":{"booleanValue":false},"createdBy":{"stringValue":"'$EMP_UID'"}}}' >/dev/null
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
c=$(code -X PATCH -H "Authorization: Bearer $EMP_TOKEN" -H "Content-Type: application/json" \
  "$FS/leads/qa_lead1/activities/qa_act1" -d '{"fields":{"type":{"stringValue":"call"},"content":{"stringValue":"Spoke to customer about loan"},"by":{"stringValue":"'$EMP_UID'"},"byName":{"stringValue":"QA Employee"},"at":{"timestampValue":"'$NOW'"},"opportunityId":{"nullValue":null}}}')
check "QuickLogBar write (with byName/opportunityId) passes validator" 200 "$c"
c=$(code -X PATCH -H "Authorization: Bearer $EMP_TOKEN" -H "Content-Type: application/json" \
  "$FS/leads/qa_lead1/activities/qa_act1?updateMask.fieldPaths=content" -d '{"fields":{"content":{"stringValue":"Edited within 5 minutes"}}}')
check "author can edit own content within 5 min" 200 "$c"
c=$(code -X PATCH -H "Authorization: Bearer $EMP_TOKEN" -H "Content-Type: application/json" \
  "$FS/leads/qa_lead1/activities/qa_act1?updateMask.fieldPaths=type" -d '{"fields":{"type":{"stringValue":"note"}}}')
check "author cannot change fields other than content" 403 "$c"
c=$(code -X PATCH -H "Authorization: Bearer $EMP_TOKEN" -H "Content-Type: application/json" \
  "$FS/leads/qa_lead1/activities/qa_act2" -d '{"fields":{"type":{"stringValue":"call"},"content":{"stringValue":"with bogus key"},"by":{"stringValue":"'$EMP_UID'"},"at":{"timestampValue":"'$NOW'"},"bogusField":{"stringValue":"x"}}}')
check "validator rejects unknown keys" 403 "$c"

echo "── P7: field_history ───────────────────────────────────"
c=$(code -X PATCH -H "Authorization: Bearer $EMP_TOKEN" -H "Content-Type: application/json" \
  "$FS/leads/qa_lead1/field_history/leadStatus/changes/qa_fh1" -d '{"fields":{"field":{"stringValue":"leadStatus"},"oldValue":{"nullValue":null},"newValue":{"stringValue":"interested"},"changedBy":{"stringValue":"'$EMP_UID'"},"changedByName":{"stringValue":"QA Employee"},"changedAt":{"timestampValue":"'$NOW'"},"context":{"stringValue":"disposition"}}}')
check "self-attributed field_history create allowed" 200 "$c"
c=$(code -X PATCH -H "Authorization: Bearer $EMP_TOKEN" -H "Content-Type: application/json" \
  "$FS/leads/qa_lead1/field_history/leadStatus/changes/qa_fh2" -d '{"fields":{"field":{"stringValue":"leadStatus"},"changedBy":{"stringValue":"SOMEONE_ELSE"},"changedAt":{"timestampValue":"'$NOW'"}}}')
check "spoofed-attribution field_history create denied" 403 "$c"
c=$(code "$FS/leads/qa_lead1/field_history/leadStatus/changes/qa_fh1" -H "Authorization: Bearer $EMP_TOKEN")
check "non-admin/manager cannot read field_history" 403 "$c"
c=$(code "$FS/leads/qa_lead1/field_history/leadStatus/changes/qa_fh1" -H "Authorization: Bearer $SA_TOKEN")
check "admin can read field_history" 200 "$c"
c=$(code -X DELETE -H "Authorization: Bearer $SA_TOKEN" "$FS/leads/qa_lead1/field_history/leadStatus/changes/qa_fh1")
check "field_history is immutable (no delete)" 403 "$c"

echo "────────────────────────────────────────────────────────"
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" = "0" ]
