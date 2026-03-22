"""Metric function for GEPA optimization with reference solutions from benchmark traces."""
from typing import Optional

import dspy
from dspy.primitives import Example, Prediction

# Loaded once at import time by run_gepa.py and set here
REFERENCE_SOLUTIONS: dict[str, str] = {}


def set_reference_solutions(refs: dict[str, str]):
    global REFERENCE_SOLUTIONS
    REFERENCE_SOLUTIONS = refs


def metric(
    gold: Example,
    pred: Prediction,
    trace: Optional[list] = None,
    pred_name: Optional[str] = None,
    pred_trace: Optional[list] = None,
) -> dspy.Prediction:
    """GEPA-compatible metric with textual feedback.

    Returns score (0.0 or 1.0) and feedback text.
    When the student gets it wrong, feedback includes the reference solution
    from benchmark traces (if available) so the reflection LLM can learn from it.
    """
    # Parse verdict — handle bool, str, and edge cases
    verdict = pred.verdict
    if isinstance(verdict, str):
        verdict = verdict.strip().lower() in ("true", "1", "yes")

    # Normalize gold answer the same way (defensive — JSONL uses JSON bools,
    # but guard against string-encoded answers)
    expected_answer = gold.answer
    if isinstance(expected_answer, str):
        expected_answer = expected_answer.strip().lower() in ("true", "1", "yes")

    correct = verdict == expected_answer
    score = 1.0 if correct else 0.0

    if correct:
        feedback = "Correct."
    else:
        expected = "TRUE" if expected_answer else "FALSE"
        feedback = f"Wrong. Expected {expected}."

        # Add reference solution from benchmark traces if available
        problem_id = getattr(gold, "id", None)
        ref = REFERENCE_SOLUTIONS.get(problem_id, "") if problem_id else ""
        if ref:
            feedback += f"\n\nHere is a correct solution for this problem:\n{ref}"
        else:
            # Fallback: give a hint about the expected answer
            if expected_answer:
                feedback += (
                    " The implication IS true. Consider whether Equation 1 "
                    "forces the magma to have only one element (trivializing), "
                    "or whether Equation 2 follows by substitution."
                )
            else:
                feedback += (
                    " The implication is FALSE — a counterexample magma exists. "
                    "Try small magmas (2-3 elements) that satisfy Eq1 but violate Eq2."
                )

    return dspy.Prediction(score=score, feedback=feedback)
