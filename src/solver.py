"""DSPy modules for the equational implication task."""
import dspy


class SolverV1(dspy.Module):
    """Single-step solver. GEPA optimizes the instruction for self.solve."""

    def __init__(self):
        self.solve = dspy.ChainOfThought(
            "equation1: str, equation2: str -> verdict: bool"
        )

    def forward(self, equation1: str, equation2: str):
        return self.solve(equation1=equation1, equation2=equation2)


class SolverV2(dspy.Module):
    """Single-step solver with cheatsheet context."""

    def __init__(self, cheatsheet: str = ""):
        self.cheatsheet = cheatsheet
        self.solve = dspy.ChainOfThought(
            "equation1: str, equation2: str, reference: str -> verdict: bool"
        )

    def forward(self, equation1: str, equation2: str):
        return self.solve(
            equation1=equation1,
            equation2=equation2,
            reference=self.cheatsheet,
        )


class SolverV3(dspy.Module):
    """Two-step: analyze structure, then classify."""

    def __init__(self, cheatsheet: str = ""):
        self.cheatsheet = cheatsheet
        self.analyze = dspy.ChainOfThought(
            "equation1: str, equation2: str, reference: str -> analysis: str"
        )
        self.classify = dspy.Predict(
            "equation1: str, equation2: str, analysis: str -> verdict: bool"
        )

    def forward(self, equation1: str, equation2: str):
        analysis = self.analyze(
            equation1=equation1,
            equation2=equation2,
            reference=self.cheatsheet,
        )
        return self.classify(
            equation1=equation1,
            equation2=equation2,
            analysis=analysis.analysis,
        )
