"""Tests for the ClaudeCodeLM adapter."""
import sys
from types import ModuleType
from unittest.mock import MagicMock, patch
sys.path.insert(0, "src")

from cc_adapter import ClaudeCodeLM, _Response, _Usage, _Choice, _Message


# --- Unit tests for response dataclasses ---

def test_usage_dict_conversion():
    u = _Usage(input_tokens=100, output_tokens=50, prompt_tokens=100, completion_tokens=50)
    d = dict(u)
    assert d["input_tokens"] == 100
    assert d["output_tokens"] == 50
    assert d["prompt_tokens"] == 100
    assert d["completion_tokens"] == 50


def test_response_structure():
    resp = _Response(
        choices=[_Choice(message=_Message(content="hello"))],
        usage=_Usage(input_tokens=10, output_tokens=5, prompt_tokens=10, completion_tokens=5),
        model="claude-opus-4-6",
    )
    assert resp.choices[0].message.content == "hello"
    assert resp.model == "claude-opus-4-6"
    assert dict(resp.usage)["input_tokens"] == 10


def test_response_matches_openai_format():
    """BaseLM._process_completion accesses response.choices[i].message.content"""
    resp = _Response(
        choices=[_Choice(message=_Message(content="test"))],
        usage=_Usage(),
        model="test",
    )
    c = resp.choices[0]
    assert hasattr(c, "message")
    assert c.message.content == "test"
    assert hasattr(resp, "usage")


# --- ClaudeCodeLM initialization ---

def test_init_defaults():
    lm = ClaudeCodeLM()
    assert lm.model == "claude-opus-4-6"
    assert lm.model_type == "chat"
    assert lm.kwargs["temperature"] == 1.0
    assert lm.kwargs["max_tokens"] == 8192


def test_init_custom_params():
    lm = ClaudeCodeLM(model="claude-sonnet-4-6", temperature=0.5, max_tokens=4096)
    assert lm.model == "claude-sonnet-4-6"
    assert lm.kwargs["temperature"] == 0.5
    assert lm.kwargs["max_tokens"] == 4096


# --- Helpers for mocking claude_agent_sdk ---

def _mock_assistant_message(text, input_tokens=100, output_tokens=50):
    block = MagicMock()
    block.text = text

    msg = MagicMock()
    msg.content = [block]
    msg.usage = {"input_tokens": input_tokens, "output_tokens": output_tokens}
    type(msg).__name__ = "AssistantMessage"
    return msg


def _mock_result_message(input_tokens=100, output_tokens=50):
    msg = MagicMock()
    msg.total_cost_usd = 0.01
    msg.usage = {"input_tokens": input_tokens, "output_tokens": output_tokens}
    type(msg).__name__ = "ResultMessage"
    return msg


def _install_mock_sdk(query_fn):
    """Install a mock claude_agent_sdk module with the given query function."""
    mock_sdk = ModuleType("claude_agent_sdk")
    mock_sdk.query = query_fn
    mock_sdk.ClaudeAgentOptions = lambda **kwargs: MagicMock(**kwargs)
    return mock_sdk


async def _mock_query_basic(prompt, options):
    yield _mock_assistant_message("The answer is TRUE.", 150, 30)
    yield _mock_result_message(150, 30)


async def _mock_query_empty(prompt, options):
    yield _mock_result_message(0, 0)


async def _mock_query_multi_block(prompt, options):
    block1 = MagicMock()
    block1.text = "Part 1. "
    block2 = MagicMock()
    block2.text = "Part 2."

    msg = MagicMock()
    msg.content = [block1, block2]
    msg.usage = {"input_tokens": 100, "output_tokens": 50}
    type(msg).__name__ = "AssistantMessage"
    yield msg
    yield _mock_result_message(100, 50)


# --- forward() tests ---

def test_forward_returns_openai_response():
    lm = ClaudeCodeLM()
    mock_sdk = _install_mock_sdk(_mock_query_basic)
    with patch.dict(sys.modules, {"claude_agent_sdk": mock_sdk}):
        resp = lm.forward(
            messages=[
                {"role": "system", "content": "You are a math expert."},
                {"role": "user", "content": "Does eq1 imply eq2?"},
            ]
        )

    assert isinstance(resp, _Response)
    assert len(resp.choices) == 1
    assert resp.choices[0].message.content == "The answer is TRUE."
    assert resp.model == "claude-opus-4-6"


def test_forward_extracts_usage():
    lm = ClaudeCodeLM()
    mock_sdk = _install_mock_sdk(_mock_query_basic)
    with patch.dict(sys.modules, {"claude_agent_sdk": mock_sdk}):
        resp = lm.forward(prompt="test")

    assert resp.usage.input_tokens == 150
    assert resp.usage.output_tokens == 30
    assert resp.usage.prompt_tokens == 150
    assert resp.usage.completion_tokens == 30


def test_forward_with_prompt_string():
    lm = ClaudeCodeLM()
    mock_sdk = _install_mock_sdk(_mock_query_basic)
    with patch.dict(sys.modules, {"claude_agent_sdk": mock_sdk}):
        resp = lm.forward(prompt="What is 2+2?")

    assert resp.choices[0].message.content == "The answer is TRUE."


def test_forward_system_messages_extracted():
    """System messages should be passed via system_prompt, not in the user prompt."""
    lm = ClaudeCodeLM()
    captured_kwargs = {}

    def capture_options(**kwargs):
        captured_kwargs.update(kwargs)
        return MagicMock()

    mock_sdk = ModuleType("claude_agent_sdk")
    mock_sdk.query = _mock_query_basic
    mock_sdk.ClaudeAgentOptions = capture_options

    with patch.dict(sys.modules, {"claude_agent_sdk": mock_sdk}):
        lm.forward(
            messages=[
                {"role": "system", "content": "Be precise."},
                {"role": "user", "content": "Question here"},
            ]
        )

    assert captured_kwargs.get("system_prompt") == "Be precise."


def test_forward_empty_response():
    lm = ClaudeCodeLM()
    mock_sdk = _install_mock_sdk(_mock_query_empty)
    with patch.dict(sys.modules, {"claude_agent_sdk": mock_sdk}):
        resp = lm.forward(prompt="test")

    assert resp.choices[0].message.content == ""


def test_forward_concatenates_multiple_blocks():
    lm = ClaudeCodeLM()
    mock_sdk = _install_mock_sdk(_mock_query_multi_block)
    with patch.dict(sys.modules, {"claude_agent_sdk": mock_sdk}):
        resp = lm.forward(prompt="test")

    assert resp.choices[0].message.content == "Part 1. Part 2."


def test_forward_fallback_system_prompt():
    """When no system message in messages, use default system prompt."""
    lm = ClaudeCodeLM()
    captured_kwargs = {}

    def capture_options(**kwargs):
        captured_kwargs.update(kwargs)
        return MagicMock()

    mock_sdk = ModuleType("claude_agent_sdk")
    mock_sdk.query = _mock_query_basic
    mock_sdk.ClaudeAgentOptions = capture_options

    with patch.dict(sys.modules, {"claude_agent_sdk": mock_sdk}):
        lm.forward(messages=[{"role": "user", "content": "Hi"}])

    assert "helpful assistant" in captured_kwargs.get("system_prompt", "").lower()


# --- Integration with BaseLM ---

def test_inherits_base_lm():
    from dspy.clients.base_lm import BaseLM
    assert issubclass(ClaudeCodeLM, BaseLM)


def test_has_required_forward_method():
    """BaseLM requires forward() to be implemented."""
    lm = ClaudeCodeLM()
    assert hasattr(lm, "forward")
    from dspy.clients.base_lm import BaseLM
    assert lm.forward.__func__ is not BaseLM.forward
