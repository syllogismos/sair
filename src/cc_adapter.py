"""Custom litellm-compatible adapter for Claude Code Agent SDK.

Uses the Claude Code subscription auth (no API key needed).
Spawns the claude CLI as a subprocess via claude_agent_sdk.
"""
import asyncio
from typing import Any

import dspy
from dspy.clients.base_lm import BaseLM


class ClaudeCodeLM(BaseLM):
    """DSPy LM that uses claude_agent_sdk.query() for completions.

    Uses your Claude Code subscription auth — no API key needed.
    Overhead: ~1600 extra input tokens per call (CC system prompt).

    Usage:
        lm = ClaudeCodeLM()
        dspy.configure(lm=lm)
    """

    def __init__(self, model: str = "claude-opus-4-6", **kwargs):
        self.model = model
        self.model_type = "chat"
        self.history = []
        self.callbacks = kwargs.get("callbacks", [])
        self.kwargs = kwargs
        self.cache = kwargs.get("cache", True)

    def __call__(self, prompt=None, messages=None, **kwargs):
        from claude_agent_sdk import query, ClaudeAgentOptions

        # Build the prompt from messages
        if messages:
            parts = []
            for msg in messages:
                role = msg.get("role", "user")
                content = msg.get("content", "")
                if role == "system":
                    parts.append(f"[System]: {content}")
                elif role == "user":
                    parts.append(content)
                elif role == "assistant":
                    parts.append(f"[Previous response]: {content}")
            prompt_text = "\n\n".join(parts)
        else:
            prompt_text = prompt or ""

        options = ClaudeAgentOptions(
            system_prompt=kwargs.get("system_prompt", "You are a helpful assistant. Answer concisely."),
        )

        # Run async query synchronously
        result_text = ""
        usage = {}
        cost = 0.0

        async def _run():
            nonlocal result_text, usage, cost
            async for message in query(prompt=prompt_text, options=options):
                name = type(message).__name__
                if name == "AssistantMessage":
                    for block in message.content:
                        if hasattr(block, "text"):
                            result_text += block.text
                    usage = dict(message.usage) if message.usage else {}
                elif name == "ResultMessage":
                    cost = message.total_cost_usd or 0.0
                    if message.usage:
                        usage = dict(message.usage)

        asyncio.run(_run())

        # Store in history for DSPy
        self.history.append({
            "prompt": prompt_text,
            "response": result_text,
            "kwargs": kwargs,
            "usage": usage,
            "cost": cost,
        })

        return [result_text]

    def basic_request(self, prompt, **kwargs):
        return self(prompt=prompt, **kwargs)

    def inspect_history(self, n: int = 1):
        return self.history[-n:]
