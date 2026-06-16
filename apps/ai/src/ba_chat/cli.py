"""Interactive CLI for local testing.

Streams `astream_events` so you see tokens land as they arrive. The CLI
keeps one thread per process — restart for a fresh conversation.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
import uuid
from typing import Any

from langchain_core.messages import AIMessage, HumanMessage
from rich.console import Console
from rich.markdown import Markdown
from rich.prompt import Prompt

from ba_chat.config import get_settings
from ba_chat.graph import compile_graph
from ba_chat.state import empty_state

console = Console()


async def run_repl(
    *,
    user_role: str,
    auth_header: str | None,
    user_id: str,
) -> None:
    settings = get_settings()
    logging.basicConfig(level=settings.log_level, format="%(asctime)s %(levelname)s %(name)s %(message)s")

    graph = compile_graph()
    thread_id = str(uuid.uuid4())
    config: dict[str, Any] = {"configurable": {"thread_id": thread_id}}

    console.print(
        f"[bold]Ba_Bazaar chat (slice 1)[/bold]  api={settings.api_base_url}  "
        f"llm={'on' if settings.has_llm else 'fallback'}  thread={thread_id[:8]}"
    )
    console.print("Type your question. Ctrl+C to quit.\n")

    base_state = empty_state()
    base_state.update({
        "user_id": user_id,
        "user_role": user_role,  # type: ignore[typeddict-item]
        "auth_header": auth_header,
    })

    while True:
        try:
            user_text = Prompt.ask("[bold cyan]you[/bold cyan]")
        except (KeyboardInterrupt, EOFError):
            console.print("\n[dim]bye[/dim]")
            return
        if not user_text.strip():
            continue

        # Per-turn input only carries the new message and the auth context;
        # everything else is loaded from the checkpointer.
        turn_input = {
            "messages": [HumanMessage(content=user_text)],
            "user_id": user_id,
            "user_role": user_role,
            "auth_header": auth_header,
        }

        printed_intent = False
        final_state: dict | None = None
        try:
            async for event in graph.astream_events(turn_input, config=config, version="v2"):
                kind = event.get("event")
                name = event.get("name", "")
                if kind == "on_chain_start" and name == "router" and not printed_intent:
                    console.print("[dim]…routing[/dim]", end=" ")
                    printed_intent = True
                if kind == "on_chain_end" and name == "router":
                    intent = (event.get("data", {}).get("output") or {}).get("intent")
                    target = (event.get("data", {}).get("output") or {}).get("analyze_target")
                    console.print(f"[dim]intent={intent} target={target}[/dim]")
                if kind == "on_chat_model_stream":
                    chunk = event.get("data", {}).get("chunk")
                    text = getattr(chunk, "content", "") or ""
                    if text:
                        console.print(text, end="", soft_wrap=True, highlight=False)
                if kind == "on_chain_end" and event.get("name") == "LangGraph":
                    final_state = event.get("data", {}).get("output")
        except Exception as exc:  # pragma: no cover - REPL safety net
            console.print(f"[red]error:[/red] {exc}")
            continue

        # If the streaming events didn't carry the AI message (e.g. fallback
        # path with no LLM), pull it from the final state and render now.
        if final_state and not printed_intent:
            pass
        if final_state:
            messages = final_state.get("messages", [])
            for msg in reversed(messages):
                if isinstance(msg, AIMessage) and isinstance(msg.content, str) and msg.content.strip():
                    console.print()
                    console.print(Markdown(msg.content))
                    break
        console.print()


def main() -> None:
    parser = argparse.ArgumentParser(prog="ba-chat")
    parser.add_argument("--role", default=os.getenv("BA_USER_ROLE", "BA_MANAGER"))
    parser.add_argument("--user-id", default=os.getenv("BA_USER_ID", "cli"))
    parser.add_argument(
        "--token",
        default=os.getenv("BA_API_TOKEN"),
        help="Bearer token for the Go API. Defaults to $BA_API_TOKEN.",
    )
    args = parser.parse_args()
    auth = args.token or None
    try:
        asyncio.run(run_repl(user_role=args.role, auth_header=auth, user_id=args.user_id))
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
