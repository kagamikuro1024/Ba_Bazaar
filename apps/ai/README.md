# Ba_Bazaar AI Chat (slice 1)

LangGraph chatbot that helps BA Managers analyze the Ba_Bazaar workspace from natural-language chat. This first slice ships the read-only analyze path:

```
router → retrieve_metrics → summarize_metrics → respond
```

It reuses the live Go API (`apps/api`) for facts and a streaming DeepSeek call for prose. Everything is grounded — bullets carry citations against numbers fetched from the API; nothing is invented.

## Quick start

```bash
cd apps/ai
uv venv
uv pip install -e .[dev]

# point at your running Go API and DeepSeek
export BA_API_BASE_URL=http://localhost:3000
export BA_API_TOKEN=...        # JWT from /api/auth/login
export DEEPSEEK_API_KEY=...    # leave unset for deterministic fallback

# interactive REPL
ba-chat

# or HTTP SSE server
ba-chat-server  # listens on :8000, POST /chat with {"message": "..."}
```

If `DEEPSEEK_API_KEY` is unset, the bot still works — it returns the deterministic numbers it fetched, just without prose. Same fallback discipline as the Go `llm_summary.go`.

## Slice roadmap

1. **(this slice)** Read-only analyze: dashboard summary, action center, my schedule, reports.
2. Booking helpers as graph tools: list projects/BAs/skills, recommendations, range check.
3. Slot-fill + simulate, ending at a confirmation card.
4. Submit booking, gated by `interrupt_before` so only an explicit "yes" mutates.

## Booking flow skill

The booking assistant follows this slot order:

```
project_name → title → description → start_date → end_date → capacity_percent
```

Flow rules:

- Always ask for `description`, but treat `no`, `none`, `nothing`, or `skip` as an intentional empty description and continue.
- Resolve `today`, `tomorrow`, and other relative dates with `ba_chat.tools.date.get_today()`. The default business timezone is `Asia/Bangkok`; override with `BA_CHAT_TIMEZONE`.
- When `start_date` is already filled and the assistant asks for `end_date`, duration replies such as `for 5 days` or `for 1 week` are valid answers. Resolve them from `start_date` and move to `capacity_percent`.
- Do not ask the user to confirm a date that the deterministic date parser has already resolved.

## Layout

```
src/ba_chat/
  state.py        ChatState, BookingSlots, enums (synced with Go schema)
  llm.py          Streaming DeepSeek client + JSON-mode helper
  tools/date.py   Current-date context for relative booking dates
  tools/read.py   Read-only wrappers for /api/dashboard, /analytics, /reports
  nodes/          router, retrieve_metrics, summarize_metrics, respond
  graph.py        StateGraph wiring + checkpointer
  server.py       FastAPI SSE endpoint
  cli.py          rich-powered REPL for local testing
```
