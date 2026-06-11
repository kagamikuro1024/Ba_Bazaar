#!/usr/bin/env bash
set -euo pipefail

API="http://localhost:3001"
EMAIL="manager@ba-bazaar.local"
PASS="Manager@123"
MSG="who is good at payments"

echo "--- Login ---"
LOGIN=$(curl -sS -X POST "$API/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")
echo "Login: $(echo "$LOGIN" | head -c 80)..."

TOKEN=$(echo "$LOGIN" | grep -o '\"access_token\":\"[^\"]*\"' | cut -d'"' -f4)
if [[ -z "$TOKEN" ]]; then
  echo "Login failed, response was:"
  echo "$LOGIN"
  exit 1
fi
echo "Token: ${TOKEN:0:20}... (len=${#TOKEN})"
echo

echo "--- SSE stream ---"
ENC_MSG=$(printf '%s' "$MSG" | python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.stdin.read()))')
time curl -sN --max-time 15 \
  "$API/api/ai/agent/chat/stream?message=$ENC_MSG&token=$TOKEN" \
  2>&1 | head -c 5000
echo
echo "--- end of stream ---"
