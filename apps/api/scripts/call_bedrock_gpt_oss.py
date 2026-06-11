#!/usr/bin/env python3
"""Bedrock GPT OSS 120B bridge for Ba_Bazaar.

The Go API can call this script as an LLM provider. It accepts an
AIGateway-compatible JSON request on stdin and writes a normalized JSON
response on stdout.

Smoke test:
  export AWS_BEARER_TOKEN_BEDROCK='your-bedrock-api-key'
  echo '{"messages":[{"role":"user","content":"Say hello"}]}' \
    | python scripts/call_bedrock_gpt_oss.py
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError


DEFAULT_MODEL = "openai.gpt-oss-120b-1:0"
DEFAULT_REGION = "us-east-1"


def load_env_files() -> None:
    """Load repo/app .env files without overriding real shell env vars."""
    script_path = Path(__file__).resolve()
    candidates = [
        Path.cwd() / ".env",
        Path.cwd().parent / ".env",
        Path.cwd().parent.parent / ".env",
        script_path.parents[1] / ".env",  # apps/api/.env
        script_path.parents[3] / ".env",  # repo .env
    ]
    seen: set[Path] = set()
    for path in candidates:
        if path in seen or not path.exists():
            continue
        seen.add(path)
        for raw_line in path.read_text().splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"\'')
            if key and not os.getenv(key):
                os.environ[key] = value


load_env_files()


def bedrock_token() -> str:
    return os.getenv("AWS_BEARER_TOKEN_BEDROCK") or os.getenv("BEDROCK_BEARER_TOKEN") or os.getenv("BEDROCK_API_KEY") or ""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Call GPT OSS 120B on Amazon Bedrock.")
    parser.add_argument("prompt", nargs="?", help="Optional one-off prompt. If omitted, JSON is read from stdin.")
    parser.add_argument("--model", default=os.getenv("BEDROCK_MODEL", DEFAULT_MODEL))
    parser.add_argument("--region", default=os.getenv("AWS_REGION", DEFAULT_REGION))
    parser.add_argument("--max-tokens", type=int, default=None)
    parser.add_argument("--temperature", type=float, default=None)
    parser.add_argument("--raw", action="store_true", help="Print the full raw Bedrock JSON response.")
    parser.add_argument("--text", action="store_true", help="Print only text for one-off CLI use.")
    return parser.parse_args()


def read_request(args: argparse.Namespace) -> dict[str, Any]:
    if args.prompt is not None:
        return {
            "messages": [{"role": "user", "content": args.prompt}],
            "model": args.model,
            "max_tokens": args.max_tokens or 128,
            "temperature": 0.0 if args.temperature is None else args.temperature,
        }

    raw = sys.stdin.read().strip()
    if not raw:
        return {
            "messages": [{"role": "user", "content": "Say hello in one short sentence."}],
            "model": args.model,
            "max_tokens": args.max_tokens or 128,
            "temperature": 0.0 if args.temperature is None else args.temperature,
        }
    return json.loads(raw)


def content_blocks(text: str) -> list[dict[str, str]]:
    return [{"text": text or ""}]


def build_messages(req: dict[str, Any]) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = []
    for msg in req.get("messages") or []:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if role == "system":
            continue
        if role == "tool":
            tool_id = msg.get("tool_call_id") or msg.get("tool_id") or "tool_call_1"
            messages.append({
                "role": "user",
                "content": [{
                    "toolResult": {
                        "toolUseId": tool_id,
                        "content": [{"text": content}],
                    }
                }],
            })
            continue
        if role not in {"user", "assistant"}:
            role = "user"
        messages.append({"role": role, "content": content_blocks(content)})
    return messages


def build_tools(req: dict[str, Any]) -> dict[str, Any] | None:
    tools = []
    for tool in req.get("tools") or []:
        tools.append({
            "toolSpec": {
                "name": tool["name"],
                "description": tool.get("description", ""),
                "inputSchema": {"json": tool.get("parameters") or {"type": "object"}},
            }
        })
    if not tools:
        return None
    return {"tools": tools}


def extract_response(output: dict[str, Any]) -> tuple[str, list[dict[str, Any]]]:
    message = output.get("message", {})
    chunks: list[str] = []
    reasoning_chunks: list[str] = []
    tool_calls: list[dict[str, Any]] = []

    for block in message.get("content", []):
        if "text" in block:
            chunks.append(block["text"])
            continue
        if "toolUse" in block:
            tool = block["toolUse"]
            tool_calls.append({
                "id": tool.get("toolUseId", ""),
                "name": tool.get("name", ""),
                "arguments": tool.get("input") or {},
            })
            continue
        reasoning = block.get("reasoningContent", {}).get("reasoningText", {}).get("text")
        if reasoning:
            reasoning_chunks.append(reasoning)

    content = "\n".join(chunks).strip()
    if not content and reasoning_chunks:
        content = "\n".join(reasoning_chunks).strip()
    return content, tool_calls


def main() -> int:
    args = parse_args()
    req = read_request(args)

    token = bedrock_token()
    if not token:
        print("error: set AWS_BEARER_TOKEN_BEDROCK, BEDROCK_BEARER_TOKEN, or BEDROCK_API_KEY", file=sys.stderr)
        return 2
    os.environ["AWS_BEARER_TOKEN_BEDROCK"] = token

    model = req.get("model") or args.model or DEFAULT_MODEL
    max_tokens = args.max_tokens or req.get("max_tokens") or req.get("maxTokens") or 800
    temperature = args.temperature
    if temperature is None:
        temperature = req.get("temperature", 0.2)

    converse: dict[str, Any] = {
        "modelId": model,
        "messages": build_messages(req),
        "inferenceConfig": {"maxTokens": int(max_tokens), "temperature": float(temperature)},
    }
    system = req.get("system", "")
    if system:
        converse["system"] = [{"text": system}]
    tool_config = build_tools(req)
    if tool_config:
        converse["toolConfig"] = tool_config

    client = boto3.client(
        "bedrock-runtime",
        region_name=args.region,
        config=Config(retries={"max_attempts": 1}),
    )

    try:
        response = client.converse(**converse)
    except (BotoCoreError, ClientError) as exc:
        print(f"bedrock call failed: {exc}", file=sys.stderr)
        return 1

    if args.raw:
        print(json.dumps(response, indent=2, default=str))
        return 0

    content, tool_calls = extract_response(response.get("output", {}))
    if args.text:
        print(content)
        return 0

    usage = response.get("usage") or {}
    normalized = {
        "content": content,
        "tool_calls": tool_calls,
        "provider": "python-bedrock",
        "model": model,
        "usage": {
            "prompt_tokens": usage.get("inputTokens", 0),
            "completion_tokens": usage.get("outputTokens", 0),
            "total_tokens": usage.get("totalTokens", 0),
        },
    }
    print(json.dumps(normalized, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
