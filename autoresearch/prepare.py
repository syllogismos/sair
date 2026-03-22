"""Fixed constants, data loading, and evaluation subset sampling.

DO NOT MODIFY THIS FILE. It is the scientific control.
The agent modifies only cheatsheet.txt.

Usage (standalone test):
    uv run python -c "from prepare import load_problems; print(len(load_problems()))"
"""

import json
import random
from dataclasses import dataclass
from pathlib import Path

# ---------------------------------------------------------------------------
# Constants (fixed, do not modify)
# ---------------------------------------------------------------------------

DATA_DIR = Path(__file__).parent.parent / "data"
MAX_CHEATSHEET_BYTES = 9500  # leaves ~500 bytes for submission template wrapper
SEED = 42

# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------


@dataclass
class Problem:
    id: str
    index: int
    difficulty: str
    equation1: str
    equation2: str
    answer: bool


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------


def load_problems(subset: str = "all") -> list[Problem]:
    """Load problems from ../data/ JSONL files.

    Args:
        subset: "normal", "hard1", "hard2", or "all"

    Returns:
        List of Problem dataclasses, sorted by id for reproducibility.
    """
    if subset == "all":
        subsets = ["normal", "hard1", "hard2"]
    else:
        subsets = [subset]

    problems = []
    for s in subsets:
        path = DATA_DIR / f"problems_{s}.jsonl"
        if not path.exists():
            raise FileNotFoundError(f"Data file not found: {path}")
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                row = json.loads(line)
                problems.append(Problem(
                    id=row["id"],
                    index=row["index"],
                    difficulty=row["difficulty"],
                    equation1=row["equation1"],
                    equation2=row["equation2"],
                    answer=bool(row["answer"]),
                ))

    problems.sort(key=lambda p: p.id)
    return problems


def sample_eval_set(
    problems: list[Problem],
    n: int = 100,
    seed: int = SEED,
) -> list[Problem]:
    """Sample a balanced eval subset (50% TRUE, 50% FALSE).

    Deterministic given the same seed and n.

    Args:
        problems: full problem list
        n: total number of problems to sample
        seed: random seed

    Returns:
        Balanced list of n problems (n//2 TRUE, n//2 FALSE), shuffled.
    """
    rng = random.Random(seed)

    true_problems = [p for p in problems if p.answer]
    false_problems = [p for p in problems if not p.answer]

    true_n = n // 2
    false_n = n - true_n

    # Shuffle deterministically, then take first N of each
    true_copy = list(true_problems)
    false_copy = list(false_problems)
    rng.shuffle(true_copy)
    rng.shuffle(false_copy)

    sampled = true_copy[:true_n] + false_copy[:false_n]
    rng.shuffle(sampled)
    return sampled


def load_cheatsheet(path: str = "cheatsheet.txt") -> str:
    """Load cheatsheet and validate size.

    Returns empty string if file doesn't exist.
    Raises ValueError if > MAX_CHEATSHEET_BYTES.
    """
    p = Path(path)
    if not p.exists():
        return ""

    content = p.read_text(encoding="utf-8")
    size = len(content.encode("utf-8"))

    if size > MAX_CHEATSHEET_BYTES:
        raise ValueError(
            f"Cheatsheet is {size} bytes, exceeds limit of {MAX_CHEATSHEET_BYTES} bytes"
        )

    return content


def get_cheatsheet_bytes(path: str = "cheatsheet.txt") -> int:
    """Return byte count of cheatsheet file (UTF-8). 0 if missing."""
    p = Path(path)
    if not p.exists():
        return 0
    return len(p.read_text(encoding="utf-8").encode("utf-8"))
