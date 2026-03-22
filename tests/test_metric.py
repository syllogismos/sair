"""Tests for the GEPA metric function."""
import inspect
import sys
sys.path.insert(0, "src")

import dspy
from metric import metric, set_reference_solutions


def _make_gold(answer, problem_id="test_1"):
    return dspy.Example(
        id=problem_id, equation1="x = x", equation2="x = x", answer=answer,
    ).with_inputs("equation1", "equation2")


def test_correct_true():
    result = metric(_make_gold(True), dspy.Prediction(verdict="TRUE"), None, None, None)
    assert result.score == 1.0


def test_correct_false():
    result = metric(_make_gold(False), dspy.Prediction(verdict="FALSE"), None, None, None)
    assert result.score == 1.0


def test_wrong_prediction():
    result = metric(_make_gold(True), dspy.Prediction(verdict="FALSE"), None, None, None)
    assert result.score == 0.0
    assert "Wrong" in result.feedback


def test_feedback_includes_reference():
    set_reference_solutions({"ref_test": "Here is how to solve it..."})
    result = metric(
        _make_gold(True, "ref_test"),
        dspy.Prediction(verdict="FALSE"),
        None, None, None,
    )
    assert "correct solution" in result.feedback
    set_reference_solutions({})


def test_feedback_fallback_true():
    set_reference_solutions({})
    result = metric(_make_gold(True), dspy.Prediction(verdict="FALSE"), None, None, None)
    assert "implication IS true" in result.feedback


def test_feedback_fallback_false():
    set_reference_solutions({})
    result = metric(_make_gold(False), dspy.Prediction(verdict="TRUE"), None, None, None)
    assert "counterexample" in result.feedback


def test_bool_verdict():
    result = metric(_make_gold(True), dspy.Prediction(verdict=True), None, None, None)
    assert result.score == 1.0


def test_string_verdict_variants():
    for v in ["true", "TRUE", "True", "1", "yes"]:
        result = metric(_make_gold(True), dspy.Prediction(verdict=v), None, None, None)
        assert result.score == 1.0, f"Failed for verdict={v}"


def test_gepa_compatible_signature():
    """GEPA requires metric(gold, pred, trace, pred_name, pred_trace)."""
    sig = inspect.signature(metric)
    sig.bind(None, None, None, None, None)


def test_returns_prediction_with_score_and_feedback():
    result = metric(_make_gold(True), dspy.Prediction(verdict="TRUE"), None, None, None)
    assert hasattr(result, "score")
    assert hasattr(result, "feedback")
    assert result["score"] == 1.0  # GEPA accesses via dict-style
    assert isinstance(result["feedback"], str)


def test_gold_answer_string_true():
    """gold.answer as string 'true' should be normalized to bool."""
    gold = dspy.Example(
        id="str_test", equation1="x = x", equation2="x = x", answer="true",
    ).with_inputs("equation1", "equation2")
    result = metric(gold, dspy.Prediction(verdict="TRUE"), None, None, None)
    assert result.score == 1.0


def test_gold_answer_string_false():
    gold = dspy.Example(
        id="str_test", equation1="x = x", equation2="x = x", answer="FALSE",
    ).with_inputs("equation1", "equation2")
    result = metric(gold, dspy.Prediction(verdict="FALSE"), None, None, None)
    assert result.score == 1.0


def test_gold_answer_string_mismatch():
    gold = dspy.Example(
        id="str_test", equation1="x = x", equation2="x = x", answer="TRUE",
    ).with_inputs("equation1", "equation2")
    result = metric(gold, dspy.Prediction(verdict="FALSE"), None, None, None)
    assert result.score == 0.0


def test_feedback_uses_normalized_answer():
    """Feedback should say 'Expected TRUE' even when gold.answer is string 'true'."""
    gold = dspy.Example(
        id="fb_test", equation1="x = x", equation2="x = x", answer="true",
    ).with_inputs("equation1", "equation2")
    set_reference_solutions({})
    result = metric(gold, dspy.Prediction(verdict="FALSE"), None, None, None)
    assert "Expected TRUE" in result.feedback
