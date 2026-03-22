"""Test claude-agent-sdk: verify we can use it for simple completion calls with token tracking."""
import asyncio
from claude_agent_sdk import query, ClaudeAgentOptions

async def main():
    options = ClaudeAgentOptions(
        system_prompt="You are a helpful math assistant. Answer concisely.",
    )

    full_text = ""
    usage = {}
    cost = 0.0

    async for message in query(
        prompt="Does x = x * y imply x = x * x over all magmas? Answer TRUE or FALSE with a one-line reason.",
        options=options
    ):
        name = type(message).__name__
        if name == "AssistantMessage":
            for block in message.content:
                if hasattr(block, "text"):
                    full_text += block.text
            usage = message.usage
            print(f"Model: {message.model}")
        elif name == "ResultMessage":
            cost = message.total_cost_usd
            print(f"Cost: ${cost}")
            print(f"Usage: {message.usage}")
            print(f"Result: {message.result}")

    print(f"\nFull text: {full_text}")
    print(f"Prompt tokens: {usage.get('input_tokens', 'N/A')}")
    print(f"Completion tokens: {usage.get('output_tokens', 'N/A')}")
    print(f"Total cost: ${cost}")

asyncio.run(main())
