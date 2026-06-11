#!/usr/bin/env bash
# Smoke test the Bedrock OpenAI-compatible endpoint with gpt-oss-120b.
# Run as: BEDROCK_API_KEY='***' ./scripts/bedrock-smoke.sh
#
# This file is safe to commit. The API key is read from the env, never
# hard-coded or echoed.

set -euo pipefail

if [[ -z "${BEDROCK_API_KEY:-}" ]]; then
  echo "BEDROCK_API_KEY not set. Run as: BEDROCK_API_KEY='***' $0"
  exit 1
fi

BASE="${BEDROCK_BASE_URL:-https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1}"
MODEL="${BEDROCK_MODEL:-openai.gpt-oss-120b-1:0}"

curl -sS -X POST "$BASE/chat/completions" \
  -H "Authorization: Bearer $BEDROCK_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(cat <<JSON
{
  "model": "$MODEL",
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Say 'bedrock ok' and nothing else."}
  ],
  "max_tokens": 50,
  "temperature": 0
}
JSON
)" | head -c 2000
echo
