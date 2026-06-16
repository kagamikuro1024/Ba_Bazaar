"""Trace what extract_slots actually does with a real LLM call."""
import asyncio
from langchain_core.messages import HumanMessage
from ba_chat.config import get_settings
from ba_chat.nodes.extract_slots import extract_slots

async def main():
    s = get_settings()
    print(f"LLM enabled: {s.has_llm}, model: {s.deepseek_model}")
    state = {
        "messages": [HumanMessage(content="Acme Migration project, BA analysis work, 50% capacity, from June 20 to June 30")],
        "slots": {},
        "missing_slots": ["project_name"],
        "awaiting_user": "clarification",
        "user_role": "BA_MANAGER",
    }
    result = await extract_slots(state)
    print(f"Result: {result}")

asyncio.run(main())
