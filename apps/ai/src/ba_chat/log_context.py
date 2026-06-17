import contextvars
from typing import Any

# A ContextVar that holds a list of tool call dictionaries
tool_calls_var: contextvars.ContextVar[list[dict[str, Any]] | None] = contextvars.ContextVar("tool_calls", default=None)
