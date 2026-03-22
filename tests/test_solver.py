"""Tests for solver module structure (no LLM calls)."""
import sys
sys.path.insert(0, "src")

import dspy
from solver import SolverV1, SolverV2, SolverV3


def test_v1_has_predictor():
    s = SolverV1()
    predictors = list(s.named_predictors())
    assert len(predictors) == 1
    name, pred = predictors[0]
    assert "solve" in name


def test_v1_signature_fields():
    s = SolverV1()
    # named_predictors returns inner Predict objects which have .signature
    _, pred = list(s.named_predictors())[0]
    input_fields = list(pred.signature.input_fields.keys())
    output_fields = list(pred.signature.output_fields.keys())
    assert "equation1" in input_fields
    assert "equation2" in input_fields
    assert "verdict" in output_fields


def test_v2_has_reference_input():
    s = SolverV2(cheatsheet="test cheatsheet")
    _, pred = list(s.named_predictors())[0]
    assert "reference" in list(pred.signature.input_fields.keys())


def test_v3_two_predictors():
    s = SolverV3(cheatsheet="test")
    predictors = list(s.named_predictors())
    assert len(predictors) == 2
    names = [n for n, _ in predictors]
    assert any("analyze" in n for n in names)
    assert any("classify" in n for n in names)


def test_v3_analyze_outputs_analysis():
    s = SolverV3()
    preds = {n: p for n, p in s.named_predictors()}
    analyze_pred = preds.get("analyze.predict") or preds.get("analyze")
    assert analyze_pred is not None
    assert "analysis" in list(analyze_pred.signature.output_fields.keys())


def test_v3_classify_outputs_verdict():
    s = SolverV3()
    preds = {n: p for n, p in s.named_predictors()}
    classify_pred = preds.get("classify") or preds.get("classify.predict")
    assert classify_pred is not None
    assert "verdict" in list(classify_pred.signature.output_fields.keys())


def test_all_solvers_are_modules():
    for cls in [SolverV1, SolverV2, SolverV3]:
        s = cls()
        assert isinstance(s, dspy.Module)
