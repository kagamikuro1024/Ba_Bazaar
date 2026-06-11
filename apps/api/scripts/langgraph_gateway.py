#!/usr/bin/env python3
"""LangGraph bridge for Ba_Bazaar AI gateway.

Reads a gateway request JSON from stdin and writes either:
- one final JSON response, or
- JSONL events when LANGGRAPH_STREAM=1: {type: token}, then {type: final}
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Any, TypedDict

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import END, StateGraph


class GatewayState(TypedDict):
    messages: list[Any]
    response: Any


def load_env_files() -> None:
    script_path = Path(__file__).resolve()
    candidates = [
        Path.cwd() / ".env",
        Path.cwd().parent / ".env",
        Path.cwd().parent.parent / ".env",
        script_path.parents[1] / ".env",
        script_path.parents[3] / ".env",
    ]
    seen: set[Path] = set()
    for path in candidates:
        if path in seen or not path.exists():
            continue
        seen.add(path)
        for raw in path.read_text().splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"\'')
            if key and not os.getenv(key):
                os.environ[key] = value


def make_llm(streaming: bool = False) -> ChatOpenAI:
    api_key = os.getenv("DEEPSEEK_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("DEEPSEEK_API_KEY is required for LangGraph provider")
    return ChatOpenAI(
        api_key=api_key,
        base_url=os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
        model=os.getenv("DEEPSEEK_MODEL", "deepseek-chat"),
        temperature=float(os.getenv("AI_TEMPERATURE", "0.2")),
        max_tokens=int(os.getenv("AI_MAX_TOKENS", "800")),
        streaming=streaming,
    )


def to_langchain_messages(req: dict[str, Any]) -> list[Any]:
    out: list[Any] = []
    latest_user = ""
    if req.get("system"):
        out.append(SystemMessage(content=req["system"]))
    for msg in req.get("messages") or []:
        role = msg.get("role")
        content = msg.get("content") or ""
        if role == "user":
            latest_user = content
            out.append(HumanMessage(content=content))
        elif role == "assistant":
            if content:
                out.append(AIMessage(content=truncate_memory(content)))
        elif role == "tool":
            # The Go store persists tool results, but not the preceding
            # assistant tool_calls payload required by OpenAI-compatible
            # chat APIs. Re-inject tool output as user-visible context so
            # follow-up turns remain valid.
            name = msg.get("name") or msg.get("tool_name") or "tool"
            out.append(HumanMessage(content=f"Tool result from {name}: {truncate_memory(content)}"))

    if len(out) > 12:
        system = out[:1] if out and isinstance(out[0], SystemMessage) else []
        out = system + out[-10:]

    if latest_user:
        out.append(SystemMessage(content=(
            "Current-turn guardrail: answer ONLY the latest user message, not an older topic. "
            f"Latest user message: {latest_user!r}. "
            "If the latest message is a selection like 'Select Hoang Minh Chau', treat it as a choice in the current flow; "
            "acknowledge the selection and ask for or perform the next missing action. "
            "Use this final format exactly: Answer: ...\nWhy: ...\nNext: ... . "
            "Keep it under 80 words. Do not use tables or long menus."
        )))
    return out


def truncate_memory(content: str, limit: int = 1200) -> str:
    content = str(content)
    if len(content) <= limit:
        return content
    return content[:limit] + "...[truncated]"


def to_tools(req: dict[str, Any]) -> list[dict[str, Any]]:
    tools = []
    for tool in req.get("tools") or []:
        tools.append({
            "type": "function",
            "function": {
                "name": tool["name"],
                "description": tool.get("description", ""),
                "parameters": tool.get("parameters") or {"type": "object"},
            },
        })
    return tools


def latest_user_message(req: dict[str, Any]) -> str:
    for msg in reversed(req.get("messages") or []):
        if msg.get("role") == "user":
            return str(msg.get("content") or "").strip()
    return ""


def normalized_text(content: str, model: str) -> dict[str, Any]:
    return {
        "content": content,
        "tool_calls": [],
        "provider": "python-langgraph",
        "model": model,
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
    }


def normalized_tool_call(model: str, name: str, args: dict[str, Any], call_id: str | None = None) -> dict[str, Any]:
    return {
        "content": "",
        "tool_calls": [{
            "id": call_id or f"call_{name}_{int.from_bytes(os.urandom(4), 'big')}",
            "name": name,
            "arguments": args,
        }],
        "provider": "python-langgraph",
        "model": model,
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
    }


def extract_project_name(latest: str, lower: str) -> str:
    name = ""
    if lower.startswith("create project "):
        name = latest[len("create project "):].strip()
    elif lower.startswith("new project "):
        name = latest[len("new project "):].strip()
    elif " " in latest:
        name = latest.split(" ", 1)[1].strip()
    if name.lower().startswith("new project "):
        name = name[len("new project "):]
    if name.lower().startswith("project "):
        name = name[len("project "):]
    return name.strip()


def extract_project_name_from_context(req: dict[str, Any]) -> str:
    """Pick a project name from the most recent assistant message."""
    for msg in reversed(req.get("messages") or []):
        if msg.get("role") != "assistant":
            continue
        text = str(msg.get("content") or "")
        for marker in ("named ", "named \u201C", "named \u201D", 'named "', "new project named "):
            idx = text.lower().rfind(marker)
            if idx >= 0:
                tail = text[idx + len(marker):]
                for terminator in ('"', "\u201D", "\n", ".", "?"):
                    end = tail.find(terminator)
                    if end > 0:
                        tail = tail[:end]
                if tail.strip():
                    return tail.strip()
        m = re.search(r"Project Falcon", text, re.IGNORECASE)
        if m:
            return "Project Falcon"
    return ""


def deterministic_turn(req: dict[str, Any]) -> dict[str, Any] | None:
    latest = latest_user_message(req)
    lower = latest.lower().strip()
    model = req.get("model") or os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
    available_tools = {t.get("name") for t in (req.get("tools") or [])}

    if lower in {"start fresh", "new chat", "clear", "reset"}:
        return normalized_text(
            "Answer: Started fresh.\nWhy: I’ll ignore earlier selections and context for the next task.\nNext: Tell me what you want to do.",
            model,
        )

    if (lower.startswith("create project") or lower.startswith("new project") or lower == "create") and "draft_create_project" in available_tools:
        name = extract_project_name(latest, lower)
        if not name:
            return normalized_text(
                "Answer: Ready to create a new project.\nWhy: You said to create a project without a name.\nNext: Send the project name, e.g. 'create project Project Falcon'.",
                model,
            )
        return normalized_tool_call(model, "draft_create_project", {"name": name})

    if (lower in {"yes", "y", "yes draft", "yes please", "yes create draft", "confirm", "confirm draft", "yes, draft", "yes create", "yes create it", "create it", "draft it", "do it"}) and "draft_create_project" in available_tools:
        name = extract_project_name_from_context(req)
        if name:
            return normalized_tool_call(model, "draft_create_project", {"name": name})

    if (lower.startswith("draft booking") or lower.startswith("create booking")) and "draft_booking" in available_tools:
        return normalized_text(
            "Answer: Ready to draft a booking.\nWhy: I need a BA, a project, start and end dates, and capacity.\nNext: Send the BA name, project name, start date, end date, and capacity percent.",
            model,
        )

    if lower.startswith("select ") or lower.startswith("confirm "):
        name = latest.split(" ", 1)[1].strip() if " " in latest else latest
        return normalized_text(
            f"Answer: Selected {name}.\nWhy: I’ll use this BA for the current booking flow.\nNext: Send the project name, dates, capacity, and priority, or say 'draft booking'.",
            model,
        )

    return None


def chunk_text(text: str, size: int = 12) -> list[str]:
    return [text[i:i + size] for i in range(0, len(text), size)]


def normalize(ai_msg: AIMessage, model: str) -> dict[str, Any]:
    content = ai_msg.content
    if isinstance(content, list):
        text = "\n".join(str(x.get("text", x)) if isinstance(x, dict) else str(x) for x in content)
    else:
        text = str(content or "")
    tool_calls = []
    for tc in getattr(ai_msg, "tool_calls", None) or []:
        tool_calls.append({
            "id": tc.get("id") or f"call_{tc.get('name', 'tool')}",
            "name": tc.get("name", ""),
            "arguments": tc.get("args") or {},
        })
    return {
        "content": text,
        "tool_calls": tool_calls,
        "provider": "python-langgraph",
        "model": model,
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
    }


def run_once(req: dict[str, Any]) -> dict[str, Any]:
    deterministic = deterministic_turn(req)
    if deterministic is not None:
        return deterministic

    llm = make_llm(streaming=False)
    tools = to_tools(req)
    runnable = llm.bind_tools(tools) if tools else llm

    def call_model(state: GatewayState) -> GatewayState:
        return {"messages": state["messages"], "response": runnable.invoke(state["messages"])}

    graph = StateGraph(GatewayState)
    graph.add_node("call_model", call_model)
    graph.set_entry_point("call_model")
    graph.add_edge("call_model", END)
    app = graph.compile()
    result = app.invoke({"messages": to_langchain_messages(req), "response": None})
    return normalize(result["response"], req.get("model") or os.getenv("DEEPSEEK_MODEL", "deepseek-chat"))


def run_stream(req: dict[str, Any]) -> dict[str, Any]:
    deterministic = deterministic_turn(req)
    if deterministic is not None:
        text = deterministic.get("content", "")
        if text:
            for part in chunk_text(text):
                print(json.dumps({"type": "token", "text": part}), flush=True)
        return deterministic

    # Streaming is for plain text. Tool calls still use normal invoke so JSON stays valid.
    if req.get("tools") or req.get("json_mode"):
        return run_once(req)
    llm = make_llm(streaming=True)
    messages = to_langchain_messages(req)
    chunks: list[str] = []
    for chunk in llm.stream(messages):
        text = chunk.content if isinstance(chunk.content, str) else ""
        if not text:
            continue
        chunks.append(text)
        print(json.dumps({"type": "token", "text": text}), flush=True)
    return {
        "content": "".join(chunks),
        "tool_calls": [],
        "provider": "python-langgraph",
        "model": req.get("model") or os.getenv("DEEPSEEK_MODEL", "deepseek-chat"),
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
    }


def main() -> int:
    load_env_files()
    req = json.loads(sys.stdin.read() or "{}")
    try:
        if os.getenv("LANGGRAPH_STREAM") == "1":
            response = run_stream(req)
            print(json.dumps({"type": "final", "response": response}), flush=True)
        else:
            print(json.dumps(run_once(req)), flush=True)
    except Exception as exc:
        print(json.dumps({"type": "error", "message": str(exc)}), flush=True)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
