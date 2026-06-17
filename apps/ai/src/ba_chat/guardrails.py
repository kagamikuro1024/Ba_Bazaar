"""Guardrails integration for prompt injection and malicious intent protection."""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any

from nemoguardrails import LLMRails, RailsConfig

log = logging.getLogger(__name__)

# Load guardrails config
_config_path = Path(__file__).parent.parent.parent / "guardrails_config"
_config = RailsConfig.from_path(str(_config_path))
_rails = LLMRails(_config)


def check_prompt_injection(message: str) -> bool:
    """
    Check if the message contains prompt injection attempts.
    Returns True if injection detected.
    """
    injection_patterns = [
        r"ignore\s+(all\s+)?(previous|prior)\s+(instructions|prompts|rules)",
        r"forget\s+(everything|all|what)\s+(i\s+)?(told|said)",
        r"disregard\s+(your|the)\s+(system|initial)\s+(prompt|instructions)",
        r"you\s+are\s+now\s+(a\s+)?(different|new)\s+ai",
        r"act\s+as\s+if\s+you\s+have\s+no\s+(restrictions|limits|rules)",
        r"override\s+(your|the)\s+(safety|security)\s+(guidelines|rules)",
        r"show\s+me\s+your\s+(system\s+)?prompt",
        r"(what|which)\s+are\s+your\s+(instructions|rules|guidelines)",
        r"print\s+(your|the)\s+(initial|system)\s+(prompt|instructions)",
        r"reveal\s+your\s+(configuration|setup|rules)",
        r"you\s+are\s+now\s+dan",
        r"pretend\s+you'?re\s+(an?\s+)?unrestricted",
        r"act\s+without\s+(any\s+)?filters?",
        r"ignore\s+your\s+(training|programming)",
        r"you\s+can\s+do\s+anything\s+now",
    ]
    
    message_lower = message.lower()
    for pattern in injection_patterns:
        if re.search(pattern, message_lower, re.IGNORECASE):
            log.warning(f"Prompt injection detected: {message[:100]}")
            return True
    return False


def check_malicious_intent(message: str) -> bool:
    """
    Check if the message contains malicious intent.
    Returns True if malicious intent detected.
    """
    malicious_patterns = [
        r"(how\s+do\s+i|help\s+me)\s+hack\s+(into|the)",
        r"write\s+(malware|virus|trojan)",
        r"create\s+(a\s+)?phishing\s+(email|message)",
        r"(help\s+me|how\s+to)\s+attack",
        r"generate\s+(harmful|malicious)\s+code",
        r"bypass\s+(security|authentication|authorization)",
        r"delete\s+(all\s+)?(data|database|everything)",
        r"drop\s+(the\s+)?(database|table)",
        r"remove\s+(all\s+)?(users|data)",
        r"wipe\s+(everything|all|the\s+system)",
        r"execute\s+(destructive|harmful)\s+commands?",
        r"run\s+rm\s+-rf",
    ]
    
    message_lower = message.lower()
    for pattern in malicious_patterns:
        if re.search(pattern, message_lower, re.IGNORECASE):
            log.warning(f"Malicious intent detected: {message[:100]}")
            return True
    return False


def check_sensitive_request(message: str) -> bool:
    """
    Check if the message requests sensitive data.
    Returns True if sensitive request detected.
    """
    sensitive_patterns = [
        r"(give|show)\s+me\s+(the\s+)?(api\s+)?(key|token|secret)",
        r"(what'?s|what\s+is)\s+the\s+(password|secret|token)",
        r"reveal\s+(the\s+)?(credentials|api\s+key|token)",
        r"print\s+(the\s+)?(auth|api)\s+(token|key|secret)",
        r"show\s+me\s+your\s+(code|source)",
        r"print\s+your\s+source",
        r"(what'?s|what\s+is)\s+in\s+your\s+backend",
        r"show\s+(internal|system)\s+logs?",
        r"reveal\s+server\s+(details|config|setup)",
    ]
    
    message_lower = message.lower()
    for pattern in sensitive_patterns:
        if re.search(pattern, message_lower, re.IGNORECASE):
            log.warning(f"Sensitive request detected: {message[:100]}")
            return True
    return False


def check_output_safety(output: str) -> bool:
    """
    Check if the LLM output is safe.
    Returns True if safe, False if unsafe content detected.
    """
    unsafe_patterns = [
        r"(api[_\s]?key|password|secret|token)\s*[:=]\s*['\"]?[a-zA-Z0-9_-]{20,}",
        r"sk-[a-zA-Z0-9]{32,}",  # OpenAI-style keys
        r"ghp_[a-zA-Z0-9]{36}",  # GitHub tokens
        r"bearer\s+[a-zA-Z0-9._-]{20,}",
    ]
    
    for pattern in unsafe_patterns:
        if re.search(pattern, output, re.IGNORECASE):
            log.warning("Unsafe content in LLM output detected")
            return False
    return True


async def check_input(message: str) -> dict[str, Any]:
    """
    Check user input against all guardrails.
    Returns a dict with check results and optional block message.
    """
    result = {
        "allowed": True,
        "block_message": None,
        "injection_detected": False,
        "malicious_detected": False,
        "sensitive_detected": False,
    }
    
    if check_prompt_injection(message):
        result["allowed"] = False
        result["injection_detected"] = True
        result["block_message"] = (
            "I can't follow those instructions. I'm here to help with business analysis "
            "and team management tasks for Ba_Bazaar. Would you like to analyze some "
            "metrics or create a booking instead?"
        )
        return result
    
    if check_malicious_intent(message):
        result["allowed"] = False
        result["malicious_detected"] = True
        result["block_message"] = (
            "I can't help with that request. I'm designed to assist with business "
            "operations, team metrics, and booking management. How can I help you "
            "with those instead?"
        )
        return result
    
    if check_sensitive_request(message):
        result["allowed"] = False
        result["sensitive_detected"] = True
        result["block_message"] = (
            "I can't share that information. I'm focused on helping you with business "
            "analysis and operational tasks. Would you like to review your team's "
            "performance or create a new booking?"
        )
        return result
    
    return result


def check_output(output: str) -> bool:
    """Check LLM output for safety."""
    return check_output_safety(output)
