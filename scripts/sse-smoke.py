#!/usr/bin/env python3
"""Smoke test the SSE stream endpoint."""
import json
import sys
import time
import urllib.parse
import urllib.request

API = "http://localhost:3001"
EMAIL = "manager@ba-bazaar.local"
PASSWORD = "Manager@123"
MSG = "who is good at payments"

# 1. Login
print("--- Login ---")
req = urllib.request.Request(
    f"{API}/api/auth/login",
    data=json.dumps({"email": EMAIL, "password": PASSWORD}).encode(),
    headers={"Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(req, timeout=5) as r:
    body = json.loads(r.read())
token = body["access_token"]
print(f"Token: {token[:20]}... (len={len(token)})")
print()

# 2. SSE stream
print("--- SSE stream ---")
enc = urllib.parse.quote(MSG)
url = f"{API}/api/ai/agent/chat/stream?message={enc}&token={token}"
start = time.time()
try:
    with urllib.request.urlopen(url, timeout=15) as r:
        # Read line by line so we see events as they arrive.
        for raw in r:
            line = raw.decode("utf-8", errors="replace").rstrip()
            elapsed = time.time() - start
            print(f"  [{elapsed:5.2f}s] {line}")
            if line.startswith("event: done") or line.startswith("event: error"):
                # Drain remaining buffered bytes briefly then stop.
                pass
except Exception as e:
    print(f"stream error: {e}")
print(f"--- end of stream ({time.time()-start:.2f}s) ---")
