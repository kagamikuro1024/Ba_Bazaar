#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
API="$BASE_URL/api"
STAMP="$(date +%s)"
TMP_DIR="${TMPDIR:-/tmp}/ba-bazaar-ci-e2e-$STAMP"
mkdir -p "$TMP_DIR"

MANAGER_TOKEN=""
PM_TOKEN=""
BA_TOKEN=""
ADMIN_TOKEN=""

request_raw() {
  local method="$1"
  local path="$2"
  local token="${3:-}"
  local out="$TMP_DIR/response.json"
  local code
  if [[ -n "$token" ]]; then
    code=$(curl -sS -o "$out" -w '%{http_code}' -X "$method" \
      -H "Authorization: Bearer $token" "$BASE_URL$path")
  else
    code=$(curl -sS -o "$out" -w '%{http_code}' -X "$method" "$BASE_URL$path")
  fi
  printf '%s' "$code" > "$TMP_DIR/status"
  cat "$out"
}

request() {
  local method="$1"
  local path="$2"
  local token="${3:-}"
  local body="${4:-}"
  local out="$TMP_DIR/response.json"
  local code
  if [[ -n "$body" ]]; then
    if [[ -n "$token" ]]; then
      code=$(curl -sS -o "$out" -w '%{http_code}' -X "$method" \
        -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
        --data "$body" "$API$path")
    else
      code=$(curl -sS -o "$out" -w '%{http_code}' -X "$method" \
        -H 'Content-Type: application/json' --data "$body" "$API$path")
    fi
  else
    if [[ -n "$token" ]]; then
      code=$(curl -sS -o "$out" -w '%{http_code}' -X "$method" \
        -H "Authorization: Bearer $token" "$API$path")
    else
      code=$(curl -sS -o "$out" -w '%{http_code}' -X "$method" "$API$path")
    fi
  fi
  printf '%s' "$code" > "$TMP_DIR/status"
  cat "$out"
}

login() {
  local email="$1"
  local password="$2"
  request POST /auth/login "" "{\"email\":\"$email\",\"password\":\"$password\"}" >/dev/null
  assert_status 201
  json_get "data.access_token"
}

assert_status() {
  local expected="$1"
  local actual
  actual="$(cat "$TMP_DIR/status")"
  if [[ "$actual" != "$expected" ]]; then
    echo "Expected HTTP $expected, got $actual" >&2
    cat "$TMP_DIR/response.json" >&2
    exit 1
  fi
}

assert_status_in() {
  local actual
  actual="$(cat "$TMP_DIR/status")"
  for expected in "$@"; do
    if [[ "$actual" == "$expected" ]]; then
      return 0
    fi
  done
  echo "Expected HTTP one of [$*], got $actual" >&2
  cat "$TMP_DIR/response.json" >&2
  exit 1
}

json_get() {
  node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync('$TMP_DIR/response.json','utf8')); console.log($1);"
}

json_assert() {
  local expression="$1"
  EXPR="$expression" RESPONSE_FILE="$TMP_DIR/response.json" node <<'NODE'
const fs = require('fs');
const data = JSON.parse(fs.readFileSync(process.env.RESPONSE_FILE, 'utf8'));
if (!eval(process.env.EXPR)) {
  console.error(`Assertion failed: ${process.env.EXPR}`);
  console.error(JSON.stringify(data, null, 2));
  process.exit(1);
}
NODE
}

echo "[e2e] health"
request_raw GET /health >/dev/null
assert_status 200
json_assert "data.status === 'ok'"

echo "[e2e] login seeded accounts"
MANAGER_TOKEN="$(login manager@ba-bazaar.local Manager@123)"
PM_TOKEN="$(login pm1@ba-bazaar.local Pmpo@123)"
BA_TOKEN="$(login ba1@ba-bazaar.local Ba@123)"
ADMIN_TOKEN="$(login admin@ba-bazaar.local Admin@123)"

echo "[e2e] manager directory sees all statuses"
request GET /ba "$MANAGER_TOKEN" >/dev/null
assert_status 200
json_assert "Array.isArray(data) && data.some((ba) => ba.status === 'ACTIVE') && data.some((ba) => ba.status === 'ON_LEAVE') && data.some((ba) => ba.status === 'RESIGNED')"

ACTIVE_BA_ID=$(json_get "data.find((ba) => ba.status === 'ACTIVE').id")
ACTIVE_BA_NAME=$(json_get "data.find((ba) => ba.status === 'ACTIVE').full_name")
ACTIVE_BA_EMAIL=$(json_get "data.find((ba) => ba.status === 'ACTIVE').email")
RESIGNED_BA_ID=$(json_get "data.find((ba) => ba.status === 'RESIGNED').id")

SEARCH_TERM="${ACTIVE_BA_NAME%% *}"
echo "[e2e] search filters by BA name: $SEARCH_TERM"
request GET "/ba?search=$SEARCH_TERM" "$MANAGER_TOKEN" >/dev/null
assert_status 200
json_assert "Array.isArray(data) && data.length > 0 && data.every((ba) => [ba.full_name, ba.email].some((value) => String(value).toLowerCase().includes('$SEARCH_TERM'.toLowerCase())))"

echo "[e2e] PM/PO directory only sees active BA"
request GET /ba "$PM_TOKEN" >/dev/null
assert_status 200
json_assert "Array.isArray(data) && data.length > 0 && data.every((ba) => ba.status === 'ACTIVE')"

echo "[e2e] public profile privacy for PM/PO"
request GET "/ba/$ACTIVE_BA_ID" "$PM_TOKEN" >/dev/null
assert_status 200
json_assert "data.id === '$ACTIVE_BA_ID' && data.email === undefined && data.phone === undefined && data.user_id === undefined && data.bookings === undefined && data.created_at === undefined && data.updated_at === undefined && data.version === undefined"

echo "[e2e] PM/PO cannot view resigned public card"
request GET "/ba/$RESIGNED_BA_ID" "$PM_TOKEN" >/dev/null || true
assert_status 403

echo "[e2e] BA self scope is safe"
request GET /ba "$BA_TOKEN" >/dev/null
assert_status 200
json_assert "Array.isArray(data) && data.length === 1 && data[0].status !== 'RESIGNED'"

echo "[e2e] private notes forbidden for non-manager roles"
request GET "/ba/$ACTIVE_BA_ID/notes" "$PM_TOKEN" >/dev/null || true
assert_status 403
request GET "/ba/$ACTIVE_BA_ID/notes" "$BA_TOKEN" >/dev/null || true
assert_status 403

echo "[e2e] create BA validations and permissions"
UNIQUE_EMAIL="ci.ba.$STAMP@ba-bazaar.local"
CREATE_BODY="{\"full_name\":\"CI Functional BA $STAMP\",\"email\":\"$UNIQUE_EMAIL\",\"password\":\"Password@123\",\"phone\":\"0912345678\",\"level\":\"MIDDLE\",\"joined_date\":\"2026-06-01\"}"
request POST /ba "$MANAGER_TOKEN" "$CREATE_BODY" >/dev/null
assert_status 201
NEW_BA_ID=$(json_get "data.id")
json_assert "data.status === 'ACTIVE' && data.email === '$UNIQUE_EMAIL'"

request POST /ba "$MANAGER_TOKEN" "$CREATE_BODY" >/dev/null || true
assert_status 400
json_assert "String(data.message).includes('already exists')"

request POST /ba "$MANAGER_TOKEN" '{"full_name":"Missing Email"}' >/dev/null || true
assert_status 400

request POST /ba "$PM_TOKEN" "{\"full_name\":\"Forbidden\",\"email\":\"forbidden.$STAMP@ba-bazaar.local\",\"password\":\"Password@123\"}" >/dev/null || true
assert_status 403
request POST /ba "$BA_TOKEN" "{\"full_name\":\"Forbidden\",\"email\":\"forbidden.ba.$STAMP@ba-bazaar.local\",\"password\":\"Password@123\"}" >/dev/null || true
assert_status 403

echo "[e2e] update, immutable email, status reason, resigned gating"
request PATCH "/ba/$NEW_BA_ID" "$MANAGER_TOKEN" '{"phone":"0999999999","level":"LEAD","avatar_url":"https://example.com/avatar.png"}' >/dev/null
assert_status 200
json_assert "data.phone === '0999999999' && data.level === 'LEAD'"

request PATCH "/ba/$NEW_BA_ID" "$MANAGER_TOKEN" "{\"email\":\"changed.$STAMP@ba-bazaar.local\"}" >/dev/null || true
assert_status 400
json_assert "String(data.message).includes('immutable')"

request PATCH "/ba/$NEW_BA_ID/status" "$MANAGER_TOKEN" '{"status":"ON_LEAVE","reason":"CI leave reason"}' >/dev/null
assert_status 200
json_assert "data.status === 'ON_LEAVE' && data.status_reason === 'CI leave reason'"

request GET /ba?bookable=true "$MANAGER_TOKEN" >/dev/null
assert_status 200
json_assert "Array.isArray(data) && !data.some((ba) => ba.id === '$NEW_BA_ID')"

request PATCH "/ba/$NEW_BA_ID/status" "$MANAGER_TOKEN" '{"status":"RESIGNED","status_reason":"CI resigned"}' >/dev/null
assert_status 200
request PATCH "/ba/$NEW_BA_ID" "$MANAGER_TOKEN" '{"phone":"0888888888"}' >/dev/null || true
assert_status 400
request PATCH "/ba/$NEW_BA_ID/status" "$MANAGER_TOKEN" '{"status":"ACTIVE"}' >/dev/null || true
assert_status 400

echo "[e2e] tag add/remove and free-text validation"
request GET /tags "$MANAGER_TOKEN" >/dev/null
assert_status 200
TAG_ID=$(json_get "data[0].id")
request POST "/ba/$NEW_BA_ID/tags" "$MANAGER_TOKEN" "{\"tag_id\":\"$TAG_ID\"}" >/dev/null
assert_status 201
request POST "/ba/$NEW_BA_ID/tags" "$MANAGER_TOKEN" '{"name":"Unknown Free Text QA"}' >/dev/null || true
assert_status 400
request DELETE "/ba/$NEW_BA_ID/tags/$TAG_ID" "$MANAGER_TOKEN" >/dev/null
assert_status 200

echo "[e2e] notes and audit"
request POST "/ba/$NEW_BA_ID/notes" "$MANAGER_TOKEN" '{"content":"CI private note"}' >/dev/null
assert_status 201
request GET "/ba/$NEW_BA_ID/notes" "$MANAGER_TOKEN" >/dev/null
assert_status 200
json_assert "Array.isArray(data) && data.some((note) => note.content === 'CI private note')"

request GET "/ba/$NEW_BA_ID/audit" "$MANAGER_TOKEN" >/dev/null
assert_status 200
json_assert "Array.isArray(data) && data.some((log) => log.action === 'CREATE_BA_ACCOUNT') && data.some((log) => log.action === 'CHANGE_BA_STATUS')"

echo "[e2e] booking request, approve, reject, reports, notifications"
request GET /projects "$MANAGER_TOKEN" >/dev/null
assert_status 200
PROJECT_ID=$(json_get "data[0].id")
request GET /ba?bookable=true "$MANAGER_TOKEN" >/dev/null
assert_status 200
BOOKABLE_BA_ID=$(json_get "data[0].id")
BOOKING_BODY="{\"ba_id\":\"$BOOKABLE_BA_ID\",\"project_id\":\"$PROJECT_ID\",\"title\":\"CI booking $STAMP\",\"description\":\"CI booking flow\",\"start_date\":\"2026-09-01\",\"end_date\":\"2026-09-02\",\"capacity_percent\":50,\"priority\":\"MEDIUM\"}"
request POST /bookings/request "$PM_TOKEN" "$BOOKING_BODY" >/dev/null
assert_status 201
PENDING_BOOKING_ID=$(json_get "(data.booking ?? data).id")
json_assert "(data.booking ?? data).status === 'PENDING'"
request GET /bookings?status=PENDING "$MANAGER_TOKEN" >/dev/null
assert_status 200
json_assert "Array.isArray(data) && data.some((booking) => booking.id === '$PENDING_BOOKING_ID')"
request POST "/bookings/$PENDING_BOOKING_ID/approve" "$MANAGER_TOKEN" >/dev/null
assert_status_in 200 201
json_assert "data.status === 'APPROVED'"

REJECT_BODY="{\"ba_id\":\"$BOOKABLE_BA_ID\",\"project_id\":\"$PROJECT_ID\",\"title\":\"CI reject booking $STAMP\",\"description\":\"CI reject flow\",\"start_date\":\"2026-09-03\",\"end_date\":\"2026-09-04\",\"capacity_percent\":50,\"priority\":\"LOW\"}"
request POST /bookings/request "$PM_TOKEN" "$REJECT_BODY" >/dev/null
assert_status 201
REJECT_BOOKING_ID=$(json_get "(data.booking ?? data).id")
request POST "/bookings/$REJECT_BOOKING_ID/reject" "$MANAGER_TOKEN" '{"reject_reason":"CI reject reason"}' >/dev/null
assert_status_in 200 201
json_assert "data.status === 'REJECTED' && data.reject_reason === 'CI reject reason'"

request GET /capacity/summary "$MANAGER_TOKEN" >/dev/null
assert_status 200
json_assert "typeof data.average_capacity === 'number'"
request GET /reports/utilization?month=2026-09 "$MANAGER_TOKEN" >/dev/null
assert_status 200
json_assert "Array.isArray(data.rows) || Array.isArray(data)"
request GET /notifications "$MANAGER_TOKEN" >/dev/null
assert_status 200
json_assert "Array.isArray(data)"

echo "[e2e] admin is view-only for manager actions"
request GET /reports/utilization?month=2026-09 "$ADMIN_TOKEN" >/dev/null
assert_status 200
request POST /ba "$ADMIN_TOKEN" "{\"full_name\":\"Admin Forbidden\",\"email\":\"admin.forbidden.$STAMP@ba-bazaar.local\",\"password\":\"Password@123\"}" >/dev/null || true
assert_status 403
request POST "/bookings/$PENDING_BOOKING_ID/approve" "$ADMIN_TOKEN" >/dev/null || true
assert_status 403
request POST /notifications/reminders/run?date=2026-06-04 "$ADMIN_TOKEN" >/dev/null || true
assert_status 403

echo "[e2e] all functional checks passed"
