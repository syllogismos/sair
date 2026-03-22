"""Custom BaseLM adapter for Claude Code Agent SDK.

Uses the Claude Code subscription auth (no API key needed).
Spawns the claude CLI as a subprocess via claude_agent_sdk.
"""
import asyncio
from dataclasses import dataclass, field
from typing import Any

from dspy.clients.base_lm import BaseLM


@dataclass
class _Usage:
    """OpenAI-compatible usage object."""
    input_tokens: int = 0
    output_tokens: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0

    def __iter__(self):
        """Support dict(usage) as required by BaseLM._process_lm_response."""
        yield "input_tokens", self.input_tokens
        yield "output_tokens", self.output_tokens
        yield "prompt_tokens", self.prompt_tokens
        yield "completion_tokens", self.completion_tokens


@dataclass
class _Message:
    content: str
    role: str = "assistant"


@dataclass
class _Choice:
    message: _Message
    index: int = 0
    finish_reason: str = "stop"


@dataclass
class _Response:
    """Minimal OpenAI ChatCompletion-shaped response."""
    choices: list[_Choice] = field(default_factory=list)
    usage: _Usage = field(default_factory=_Usage)
    model: str = ""


class ClaudeCodeLM(BaseLM):
    """DSPy LM that uses claude_agent_sdk.query() for completions.

    Uses your Claude Code subscription auth — no API key needed.
    Overhead: ~1600 extra input tokens per call (CC system prompt).

    Usage:
        lm = ClaudeCodeLM()
        dspy.configure(lm=lm)
    """

    def __init__(self, model: str = "claude-opus-4-6", **kwargs):
        super().__init__(
            model=model,
            model_type="chat",
            temperature=kwargs.pop("temperature", 1.0),
            max_tokens=kwargs.pop("max_tokens", 8192),
            cache=kwargs.pop("cache", True),
            **kwargs,
        )

    def forward(self, prompt=None, messages=None, **kwargs):
        from claude_agent_sdk import query, ClaudeAgentOptions

        # Build the prompt from messages (same format DSPy sends)
        if messages:
            parts = []
            system_parts = []
            for msg in messages:
                role = msg.get("role", "user")
                content = msg.get("content", "")
                if role == "system":
                    system_parts.append(content)
                elif role == "user":
                    parts.append(content)
                elif role == "assistant":
                    parts.append(f"[Previous response]: {content}")
            prompt_text = "\n\n".join(parts)
            system_prompt = "\n\n".join(system_parts) if system_parts else None
        else:
            prompt_text = prompt or ""
            system_prompt = None

        options = ClaudeAgentOptions(
            system_prompt=system_prompt or "You are a helpful assistant. Answer concisely.",
        )

        result_text = ""
        usage_data = {}

        async def _run():
            nonlocal result_text, usage_data
            async for message in query(prompt=prompt_text, options=options):
                name = type(message).__name__
                if name == "AssistantMessage":
                    for block in message.content:
                        if hasattr(block, "text"):
                            result_text += block.text
                    if message.usage:
                        usage_data = dict(message.usage)
                elif name == "ResultMessage":
                    if message.usage:
                        usage_data = dict(message.usage)

        # Handle both cases: fresh event loop or existing one
        try:
            asyncio.get_running_loop()
            # An event loop is already running — use nest_asyncio
            import nest_asyncio
            nest_asyncio.apply()
            asyncio.get_event_loop().run_until_complete(_run())
        except RuntimeError:
            # No event loop running — safe to use asyncio.run()
            asyncio.run(_run())

        # Build OpenAI-compatible response for BaseLM
        input_tokens = usage_data.get("input_tokens", 0)
        output_tokens = usage_data.get("output_tokens", 0)

        return _Response(
            choices=[_Choice(message=_Message(content=result_text))],
            usage=_Usage(
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                prompt_tokens=input_tokens,
                completion_tokens=output_tokens,
            ),
            model=self.model,
        )
