"""extract_slots — pull booking fields from the latest user message.

Two-phase:
1. Date resolution: deterministic Python (dates.py) — never LLM.
2. Structured extraction: DeepSeek JSON-mode for project, BA, capacity,
   title, description. Falls back to empty slots when LLM is unavailable
   so validate_slots can ask_missing one field at a time.
"""

from __future__ import annotations

import logging
import re
from datetime import date

from pydantic import BaseModel, Field

from ba_chat.dates import parse_relative
from ba_chat.llm import LLMUnavailable, call_json_with_retry
from ba_chat.state import ChatState
from ba_chat.tools.date import get_today_iso

log = logging.getLogger(__name__)

_CAPACITY_VALUES = {25, 50, 75, 100}

# Phrases that signal "the user is restating the booking command", not
# answering the field we just asked about. If we see any of these in a
# clarification reply we refuse to store it as a verbatim field value —
# otherwise "create booking for tomorrow" gets saved as the project_name,
# then as the title, then as the description on subsequent turns.
_COMMAND_PREFIXES = (
    "create ", "book ", "schedule ", "make ", "new ", "add ", "open ",
    "request ", "log ", "raise ", "set up ", "assign ",
)
_COMMAND_TOKENS = (
    "create booking", "new booking", "add booking", "make booking",
    "request booking", "open booking", "log booking", "raise booking",
    "schedule booking",
)


class _SlotExtraction(BaseModel):
    # --- per-turn intent classification ---
    # The LLM picks ONE label that best describes what the user did this turn.
    # The graph routes off this — keyword matching is only a fallback when the
    # LLM is unavailable.
    turn_intent: str = Field(
        default="answer",
        description=(
            "Classification of what the user did this turn. One of: "
            "'answer' (they answered the field we just asked about), "
            "'confirm' (they said yes/agree to a proposal), "
            "'cancel' (they want to abandon the booking entirely), "
            "'go_back' (they want to change a previously-given answer), "
            "'side_question' (they asked a question or said something "
            "unrelated to the field we asked about — e.g. 'what fields do "
            "you need?', 'who's available?', 'never mind explain again'), "
            "'restate_command' (they re-typed the original 'create booking' "
            "command instead of answering)."
        ),
    )
    side_reply: str | None = Field(
        default=None,
        description=(
            "When turn_intent='side_question', a SHORT, friendly reply that "
            "answers the user's question or acknowledges their comment. "
            "Mention that you'll continue the booking flow afterwards. "
            "Null for all other turn_intents."
        ),
    )
    # --- slot values (only populated when turn_intent='answer') ---
    project_name: str | None = Field(
        default=None,
        description="Project name if mentioned. Use null if not found.",
    )
    ba_name: str | None = Field(
        default=None,
        description="Full name of the BA if explicitly mentioned. Use null otherwise.",
    )
    title: str | None = Field(
        default=None,
        description="Short booking title (1-10 words). Derive from context if clear.",
    )
    description: str | None = Field(
        default=None,
        description="One-sentence description of the work. Derive from context.",
    )
    capacity_percent: int | None = Field(
        default=None,
        description="Capacity percentage: must be exactly 25, 50, 75, or 100. Use null if not mentioned.",
    )
    priority: str | None = Field(
        default=None,
        description="One of LOW, MEDIUM, HIGH, URGENT. Use null if not mentioned.",
    )


_SYSTEM = (
    "You are the slot-extraction component of a Ba_Bazaar booking assistant. "
    "Your job is to figure out what the user just did and, when relevant, "
    "extract booking field values from their message. Return STRICT JSON. "
    "\n\n"
    "Step 1 — classify what the user did this turn into ONE turn_intent label:"
    "\n"
    "  * 'answer' — they answered the field we just asked about\n"
    "  * 'confirm' — they're saying yes/ok/go to a proposal\n"
    "  * 'cancel' — they want to drop this booking entirely (e.g. 'no', "
    "'cancel', 'stop', 'never mind', 'forget it', 'I don't want to anymore', "
    "'changed my mind')\n"
    "  * 'go_back' — they want to change a previously-given answer (e.g. "
    "'go back', 'previous', 'wait, change the title', 'actually let me "
    "redo the dates')\n"
    "  * 'side_question' — they asked a clarifying question or said something "
    "unrelated to the current field (e.g. 'what info do you need?', 'who's "
    "free next week?', 'why are you asking that?', 'I haven't decided yet, "
    "can you help me?', 'I'm not sure'). When you pick this, ALSO fill in "
    "side_reply with a short helpful answer that ends by inviting them to "
    "continue the booking.\n"
    "  * During clarification, 'yes', 'ok', or similar acknowledgement is "
    "not a slot answer unless the assistant asked for final confirmation.\n"
    "  * 'restate_command' — they retyped the original 'create booking' "
    "command instead of answering\n"
    "\n"
    "Step 2 — only when turn_intent='answer', extract slot values from the "
    "message. Otherwise leave all slot fields null. "
    "Do NOT invent values not present in the text. "
    "capacity_percent MUST be one of 25, 50, 75, 100 or null. "
    "Never invent BA names or project names that weren't mentioned. "
    "Booking flow rules: description is asked once, but no/nothing/skip "
    "means an intentionally empty description. Relative dates are grounded "
    "to the provided current date. If the current field is end_date and "
    "start_date is already filled, duration replies such as 'for 5 days' "
    "are valid answers, not side questions."
)


def _last_human_text(state: ChatState) -> str:
    for msg in reversed(state.get("messages", [])):
        if getattr(msg, "type", None) == "human" and isinstance(msg.content, str):
            return msg.content.strip()
    return ""


def _conversation_context(state: ChatState) -> str:
    lines: list[str] = []
    for msg in state.get("messages", [])[-8:]:
        role = getattr(msg, "type", "")
        text = msg.content if isinstance(msg.content, str) else ""
        if text:
            lines.append(f"{role}: {text[:300]}")
    return "\n".join(lines)


# Offline keyword fallbacks. Used ONLY when the LLM is unreachable so the
# bot still has minimal sanity in CI / offline contexts. The live path is
# the LLM's turn_intent classification — keywords are not the source of
# truth.
_OFFLINE_CANCEL = {
    "no", "n", "nope", "cancel", "stop", "abort",
    "nevermind", "never mind", "quit", "exit",
    "no thanks", "no thank you", "forget it", "drop it",
    "i changed my mind", "changed my mind", "i changed my mind never mind",
    "i changed my mind, never mind",
}
_OFFLINE_BACK = {"back", "go back", "previous", "undo", "redo"}
_OFFLINE_CONFIRM = {
    "yes", "y", "yep", "yeah", "submit", "go", "go ahead",
    "confirm", "ok", "okay",
}
_DESCRIPTION_SKIP = {
    "",
    "-",
    ".",
    "blank",
    "empty",
    "n",
    "n/a",
    "na",
    "no",
    "no description",
    "no details",
    "no need",
    "no scope",
    "none",
    "nothing",
    "nothing to add",
    "nope",
    "skip",
    "skip it",
    "bo qua",
    "bỏ qua",
    "khong",
    "khong co",
    "không",
    "không có",
    "trong",
    "trống",
}
# Catch re-stated booking commands in the offline path (with or without
# underscores, spaces, or casing). These shouldn't be stored as field values.
_OFFLINE_RESTATE = re.compile(
r"(create[_\s]+book|book[_\s]+(a|the)?|schedule[_\s]+(a|the)?|new[_\s]+book|"
r"make[_\s]+(a\s+)?book|add[_\s]+(a\s+)?book)",
re.IGNORECASE,
)
_SIDE_QUESTION_RE = re.compile(
    r"^\s*(what|who|when|where|why|how|can|could|should|do|does|did|"
    r"is|are|will|would)\b",
    re.IGNORECASE,
)
_CONTROL_REPLY_RE = re.compile(
    r"^\s*(wait|hold on|go back|back|previous|redo|change|edit)\b",
    re.IGNORECASE,
)
_NON_ANSWER_RE = re.compile(
    r"(haven'?t\s+(made\s+up|decided)|not\s+(decided|sure)|"
    r"don'?t\s+know|do\s+not\s+know|no\s+idea|unsure|"
    r"help\s+me|can\s+you\s+help|could\s+you\s+help|"
    r"\bsuggest\b|\brecommend\b)",
    re.IGNORECASE,
)

# Required fields in the order we ask for them. Used by the go_back path to
# clear the most recently-filled slot.
_REQUIRED_ORDER = (
    "project_name", "title", "description",
    "start_date", "end_date", "capacity_percent",
)


def _normalise(text: str) -> str:
    return " ".join(text.lower().strip().split())


def _is_description_skip(text: str) -> bool:
    return _normalise(text) in _DESCRIPTION_SKIP


def _looks_like_side_question(text: str) -> bool:
    stripped = text.strip()
    if not stripped:
        return False
    return "?" in stripped or bool(_SIDE_QUESTION_RE.search(stripped))


def _looks_like_control_reply(text: str) -> bool:
    return bool(_CONTROL_REPLY_RE.search(text.strip()))


def _slot_date(value: object) -> date | None:
    if not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def _go_back_clear_last_slot(slots: dict) -> dict:
    """Remove the most recently-filled required slot. end_date drags
    start_date with it so we don't end up with a half-resolved range."""

    for field in reversed(_REQUIRED_ORDER):
        if slots.get(field) not in (None, ""):
            slots.pop(field, None)
            if field == "end_date":
                slots.pop("start_date", None)
            break
    return slots


def _cancel_state(text: str = "") -> ChatState:
    return {
        "slots": {},
        "confirmed": False,
        "cancelled": True,
        "intent": "unknown",
        "awaiting_user": None,
        "missing_slots": [],
    }


async def extract_slots(state: ChatState) -> ChatState:
    text = _last_human_text(state)
    existing: dict = dict(state.get("slots") or {})
    missing_slots = state.get("missing_slots") or []
    awaiting = state.get("awaiting_user")
    asked_field = missing_slots[0] if awaiting == "clarification" and missing_slots else None
    lowered = _normalise(text)

    if asked_field == "description" and _is_description_skip(text):
        existing["description"] = ""
        return {"slots": existing, "confirmed": False}

    if awaiting == "confirmation":
        if lowered in _OFFLINE_CANCEL:
            return _cancel_state()
        if lowered in _OFFLINE_CONFIRM:
            return {"slots": existing, "confirmed": True}

    if awaiting == "clarification":
        if lowered in _OFFLINE_CANCEL:
            return _cancel_state()
        if lowered in _OFFLINE_BACK:
            return {"slots": _go_back_clear_last_slot(existing), "confirmed": False}
        if _OFFLINE_RESTATE.search(text):
            return {"slots": existing, "confirmed": False}

    # 1. Deterministic date resolution — applied first because it's pure and
    #    cheap and helps even when the LLM is offline. When we're answering a
    #    specific date question, only fill that specific date; a single date
    #    parser returns (same_start, same_end), and treating that as a range is
    #    how we accidentally skipped the end-date question.
    date_anchor = _slot_date(existing.get("start_date")) if asked_field == "end_date" else None
    start, end = parse_relative(text, anchor=date_anchor)
    answered_date_field = False
    if asked_field == "start_date":
        if start:
            existing["start_date"] = start
            if end and end != start and not existing.get("end_date"):
                existing["end_date"] = end
            answered_date_field = True
    elif asked_field == "end_date":
        if end or start:
            existing["end_date"] = end or start
            answered_date_field = True
    else:
        if start and not existing.get("start_date"):
            existing["start_date"] = start
        if end and not existing.get("end_date"):
            existing["end_date"] = end
    parsed_a_date = bool(start or end)
    if answered_date_field:
        return {"slots": existing, "confirmed": False}

    if awaiting == "clarification" and asked_field:
        value = _direct_clarification_value(
            asked_field,
            text,
            parsed_a_date=parsed_a_date,
            already_filled=bool(existing.get(asked_field)),
        )
        if value is not None:
            existing[asked_field] = value
            return {"slots": existing, "confirmed": False}

    # 2. LLM-first turn classification + slot extraction.
    user_prompt = (
        f"Conversation so far:\n{_conversation_context(state)}\n\n"
        f"Current date: {get_today_iso()}\n"
        f"Current slots: {existing!r}\n"
        f"Latest user message: {text!r}\n"
        f"Currently awaiting: {awaiting or 'nothing'}\n"
        f"Field we last asked about: {missing_slots[0] if missing_slots else 'n/a'}\n\n"
        "Classify what the user did this turn and (only if it was an answer) "
        "extract slot values. Return JSON."
    )
    extracted: _SlotExtraction | None = None
    try:
        extracted = await call_json_with_retry(
            system=_SYSTEM,
            user=user_prompt,
            schema=_SlotExtraction,
            node_name="extract_slots",
        )
    except LLMUnavailable as exc:
        log.info(
            "extract_slots: LLM unavailable after retries, using offline path: %s",
            exc,
        )

    if extracted is not None:
        turn_intent = (extracted.turn_intent or "answer").lower().strip()

        if turn_intent == "cancel":
            return _cancel_state()

        if turn_intent == "confirm" and awaiting == "confirmation":
            return {"slots": existing, "confirmed": True}
        if turn_intent == "confirm":
            return {
                "slots": existing,
                "confirmed": False,
                "side_reply_text": _clarification_ack_reply(asked_field),
            }

        if turn_intent == "go_back" and awaiting == "clarification":
            return {"slots": _go_back_clear_last_slot(existing), "confirmed": False}

        if turn_intent == "side_question" and extracted.side_reply:
            # User said something off-flow. Surface the LLM's reply and
            # short-circuit the rest of the booking pipeline for this turn —
            # we keep slots intact so they can resume answering next turn.
            return {
                "slots": existing,
                "confirmed": False,
                "side_reply_text": extracted.side_reply,
            }

        if turn_intent == "restate_command":
            # Don't store the restated command as a field value. Slots stay
            # as-is; the next ask_missing pass re-asks the same field.
            return {"slots": existing, "confirmed": False}

        # turn_intent == 'answer' (or unknown) — apply slot values.
        if extracted.project_name and not existing.get("project_id") and not existing.get("project_name"):
            existing["project_name"] = extracted.project_name
        if extracted.ba_name and not existing.get("ba_id") and not existing.get("ba_name"):
            existing["ba_name"] = extracted.ba_name
        if extracted.title and not existing.get("title"):
            existing["title"] = extracted.title
        if extracted.description and not existing.get("description"):
            existing["description"] = extracted.description
        if extracted.capacity_percent in _CAPACITY_VALUES and not existing.get("capacity_percent"):
            existing["capacity_percent"] = extracted.capacity_percent
        if extracted.priority and not existing.get("priority"):
            existing["priority"] = extracted.priority
        return {"slots": existing, "confirmed": False}

    # 3. Offline fallback: minimal keyword detection so the bot still works
    #    when DeepSeek is unreachable. This is intentionally narrower than
    #    the LLM path — we only catch the obvious cases.
    # Catch re-stated commands BEFORE the clarification fallback so they
    # never get stored as a field value (e.g. "create_booking" becoming
    # the project name). This applies regardless of awaiting state.
    if _OFFLINE_RESTATE.search(text):
        return {"slots": existing, "confirmed": False}

    if awaiting in ("confirmation", "clarification") and lowered in _OFFLINE_CANCEL:
        return _cancel_state()
    if awaiting == "confirmation" and lowered in _OFFLINE_CONFIRM:
        return {"slots": existing, "confirmed": True}
    if awaiting == "clarification" and lowered in _OFFLINE_BACK:
        return {"slots": _go_back_clear_last_slot(existing), "confirmed": False}
    if awaiting == "clarification" and asked_field and _looks_like_non_answer(text):
        return {
            "slots": existing,
            "confirmed": False,
            "side_reply_text": _clarification_help_reply(asked_field),
        }

    # Last-resort: when we asked a specific field, treat the reply as that
    # field's value (deterministic clarification fallback).
    if awaiting == "clarification" and missing_slots:
        first_missing = missing_slots[0]
        if first_missing not in ("start_date", "end_date") and not existing.get(first_missing):
            if (
                len(text.split(",")) <= 2
                and len(text) < 200
                and not _looks_like_command(text)
                and _normalise(text) not in _OFFLINE_CONFIRM
                and not _looks_like_non_answer(text)
                and not parsed_a_date
            ):
                value = _coerce_field_value(first_missing, text)
                if value is not None:
                    existing[first_missing] = value

    # Offline "new booking" bootstrapper: when the slot bag is completely
    # empty (initial "create booking" / "book a BA"), we need to seed
    # missing_slots so the graph enters the ask_missing → ask_missing loop
    # instead of wandering through pick_write_mode → fetch_recommendations
    # with nothing to work with.
    if not awaiting and not existing.get("project_name"):
        return {"slots": existing, "missing_slots": list(_REQUIRED_ORDER)}

    return {"slots": existing, "confirmed": False}


def _direct_clarification_value(
    field: str,
    text: str,
    *,
    parsed_a_date: bool,
    already_filled: bool,
) -> str | int | None:
    """Return a direct slot value for simple clarification answers.

    When the bot has asked for a specific text field, the user's next plain
    reply is the value. This prevents short answers like "1" from going to the
    LLM and coming back as an empty extraction.
    """

    if already_filled or field in ("start_date", "end_date"):
        return None
    if (
        _looks_like_command(text)
        or _looks_like_side_question(text)
        or _looks_like_control_reply(text)
        or _looks_like_non_answer(text)
        or _normalise(text) in _OFFLINE_CONFIRM
    ):
        return None
    if parsed_a_date or len(text.split(",")) > 2 or len(text) >= 200:
        return None
    return _coerce_field_value(field, text)


def _coerce_field_value(field: str, text: str) -> str | int | None:
    """Best-effort field coercion when we know which field we asked about."""

    cleaned = text.strip()
    if not cleaned:
        return None
    if field == "capacity_percent":
        # Pull first number, snap to allowed values.
        import re

        match = re.search(r"\d+", cleaned)
        if not match:
            return None
        value = int(match.group(0))
        return value if value in _CAPACITY_VALUES else None
    # For project_name, title, description: take the user's reply verbatim.
    return cleaned


def _looks_like_command(text: str) -> bool:
    """Heuristic: does this reply look like the user restating the original
    booking command instead of answering the slot question?

    Catches both space-separated ("create booking") and underscore variants
    ("create_booking"), plus any leading imperative verb.
    """

    cleaned = text.strip().lower()
    if not cleaned:
        return False
    # Underscore or space-separated command tokens (e.g. "create_booking")
    if _OFFLINE_RESTATE.search(text):
        return True
    if any(token in cleaned for token in _COMMAND_TOKENS):
        return True
    if any(cleaned.startswith(prefix) for prefix in _COMMAND_PREFIXES):
        return True
    return False


def _looks_like_non_answer(text: str) -> bool:
    return bool(_NON_ANSWER_RE.search(text.strip()))


def _clarification_ack_reply(field: str | None) -> str:
    if field == "title":
        return "I still need the booking title. What short title should I use?"
    if field == "project_name":
        return "I still need the project or client name. Which one should I use?"
    return "I still need that detail before I can continue. What should I use?"


def _clarification_help_reply(field: str | None) -> str:
    if field == "project_name":
        return (
            "No problem. You can use a real project/client name, or a temporary "
            "placeholder like 'TBD project'. Which project or client should I put "
            "on the booking?"
        )
    if field == "title":
        return (
            "No problem. A good title is a few words that describe the work, like "
            "'Discovery support' or 'Refund flow analysis'. What title should I use?"
        )
    return "No problem. Tell me the detail you want to use, or say skip if this field allows it."
