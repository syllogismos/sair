"""Tests for data loading and splitting."""
import sys
sys.path.insert(0, "src")

from data import load_problems, train_val_split


def test_load_normal():
    problems = load_problems("normal")
    assert len(problems) == 1000
    true_count = sum(1 for p in problems if p.answer)
    assert true_count == 500


def test_load_hard1():
    problems = load_problems("hard1")
    assert len(problems) == 69


def test_load_hard2():
    problems = load_problems("hard2")
    assert len(problems) == 200


def test_example_structure():
    problems = load_problems("normal")
    ex = problems[0]
    assert hasattr(ex, "id")
    assert hasattr(ex, "equation1")
    assert hasattr(ex, "equation2")
    assert hasattr(ex, "answer")
    assert isinstance(ex.answer, bool)
    assert "equation1" in ex.inputs()
    assert "equation2" in ex.inputs()


def test_train_val_split_sizes():
    problems = load_problems("normal")
    train, val = train_val_split(problems, val_ratio=0.2, seed=42)
    assert len(train) + len(val) == len(problems)
    assert len(val) > 0
    assert len(train) > len(val)


def test_train_val_split_balanced():
    problems = load_problems("normal")
    train, val = train_val_split(problems, val_ratio=0.2, seed=42)
    train_true = sum(1 for e in train if e.answer)
    val_true = sum(1 for e in val if e.answer)
    # Both splits should have TRUE and FALSE examples
    assert train_true > 0
    assert len(train) - train_true > 0
    assert val_true > 0
    assert len(val) - val_true > 0


def test_train_val_split_deterministic():
    problems = load_problems("normal")
    train1, val1 = train_val_split(problems, val_ratio=0.2, seed=42)
    train2, val2 = train_val_split(problems, val_ratio=0.2, seed=42)
    assert [e.id for e in train1] == [e.id for e in train2]
    assert [e.id for e in val1] == [e.id for e in val2]
