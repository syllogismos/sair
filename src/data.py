"""Load competition data as DSPy Examples."""
import json
from pathlib import Path

import dspy

DATA_DIR = Path(__file__).parent.parent / "data"


def load_problems(subset: str) -> list[dspy.Example]:
    """Load problems from a JSONL file as DSPy Examples.

    Args:
        subset: one of 'normal', 'hard1', 'hard2'
    """
    path = DATA_DIR / f"problems_{subset}.jsonl"
    examples = []
    with open(path) as f:
        for line in f:
            if not line.strip():
                continue
            row = json.loads(line)
            ex = dspy.Example(
                id=row["id"],
                equation1=row["equation1"],
                equation2=row["equation2"],
                answer=row["answer"],
            ).with_inputs("equation1", "equation2")
            examples.append(ex)
    return examples


def load_reference_solutions() -> dict[str, str]:
    """Load the best correct response for each problem from benchmark traces.

    Returns a dict mapping problem_id -> response text.
    """
    # TODO: Cache the extracted solutions to a smaller file (e.g. pickle/JSON)
    # to avoid re-processing the ~265MB benchmark_runs.jsonl on every run.
    path = DATA_DIR / "benchmark_runs.jsonl"
    correct_responses: dict[str, str] = {}
    if not path.exists():
        return correct_responses

    with open(path) as f:
        for line in f:
            if not line.strip():
                continue
            row = json.loads(line)
            if row.get("correct") and row["problem_id"] not in correct_responses:
                response = row.get("response", "")
                if response:
                    correct_responses[row["problem_id"]] = response

    return correct_responses


def train_val_split(
    examples: list[dspy.Example],
    val_ratio: float = 0.2,
    seed: int = 42,
) -> tuple[list[dspy.Example], list[dspy.Example]]:
    """Split examples into train/val, balanced by answer."""
    import random

    rng = random.Random(seed)
    true_examples = [e for e in examples if e.answer]
    false_examples = [e for e in examples if not e.answer]

    rng.shuffle(true_examples)
    rng.shuffle(false_examples)

    true_val_n = max(1, int(len(true_examples) * val_ratio))
    false_val_n = max(1, int(len(false_examples) * val_ratio))

    val = true_examples[:true_val_n] + false_examples[:false_val_n]
    train = true_examples[true_val_n:] + false_examples[false_val_n:]

    rng.shuffle(val)
    rng.shuffle(train)

    return train, val
