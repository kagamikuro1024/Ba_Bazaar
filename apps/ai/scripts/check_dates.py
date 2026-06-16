"""Quick check that date parser handles the test message correctly."""
from datetime import date
from ba_chat.dates import parse_relative

msg = "Acme Migration project, BA analysis work, 50% capacity, from June 20 to June 30"
result = parse_relative(msg, anchor=date(2026, 6, 15))
print(f"Input: {msg!r}")
print(f"Result: {result}")
assert result == ("2026-06-20", "2026-06-30"), f"got {result}"
print("OK")
