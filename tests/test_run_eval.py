"""Tests for run_eval.py — uses dry-run mode so no LLM calls are made."""
import sqlite3
import sys
import tempfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from run_eval import (
    estimate_cost,
    load_benchmark_problems,
    parse_verdict,
    run_evaluation,
)


class TestParseVerdict:
    def test_bool_true(self):
        class P:
            verdict = True
        assert parse_verdict(P()) is True

    def test_bool_false(self):
        class P:
            verdict = False
        assert parse_verdict(P()) is False

    def test_string_true(self):
        class P:
            verdict = "True"
        assert parse_verdict(P()) is True

    def test_string_false(self):
        class P:
            verdict = "false"
        assert parse_verdict(P()) is False

    def test_string_yes(self):
        class P:
            verdict = "yes"
        assert parse_verdict(P()) is True

    def test_string_no(self):
        class P:
            verdict = "no"
        assert parse_verdict(P()) is False

    def test_unparsable(self):
        class P:
            verdict = "maybe"
        assert parse_verdict(P()) is None

    def test_none(self):
        class P:
            verdict = None
        assert parse_verdict(P()) is None

    def test_no_verdict(self):
        class P:
            pass
        assert parse_verdict(P()) is None


class TestEstimateCost:
    def test_flash_lite(self):
        cost = estimate_cost("vertex_ai/gemini-2.5-flash-lite", 1000, 500)
        # (1000 * 0.10 + 500 * 0.40) / 1_000_000 = 0.0003
        assert abs(cost - 0.0003) < 1e-10

    def test_opus(self):
        cost = estimate_cost("claude-opus-4-6", 1000, 100)
        # (1000 * 15 + 100 * 75) / 1_000_000 = 0.0225
        assert abs(cost - 0.0225) < 1e-10

    def test_fallback(self):
        cost = estimate_cost("unknown-model", 1000, 1000)
        # (1000 * 1.0 + 1000 * 3.0) / 1_000_000 = 0.004
        assert abs(cost - 0.004) < 1e-10


class TestLoadBenchmarkProblems:
    def test_normal_200(self):
        problems = load_benchmark_problems("normal_200")
        assert len(problems) == 200
        assert problems[0]["problem_id"] == "normal_0001"
        assert problems[-1]["problem_id"] == "normal_0200"
        assert all("equation1" in p and "equation2" in p and "answer" in p for p in problems)

    def test_hard_200(self):
        problems = load_benchmark_problems("hard_200")
        assert len(problems) == 200
        assert all("equation1" in p and "equation2" in p and "answer" in p for p in problems)

    def test_all_400(self):
        problems = load_benchmark_problems("all_400")
        assert len(problems) == 400

    def test_all_1269(self):
        problems = load_benchmark_problems("all_1269")
        assert len(problems) == 1269

    def test_unknown_subset(self):
        with pytest.raises(ValueError, match="Unknown subset"):
            load_benchmark_problems("invalid")


class TestDryRunEvaluation:
    """Test full evaluation pipeline in dry-run mode (no LLM calls)."""

    def test_dry_run_normal_200(self):
        with tempfile.NamedTemporaryFile(suffix=".txt", mode="w", delete=False) as f:
            f.write("Test prompt instruction")
            prompt_path = f.name

        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
            db_path = f.name

        # Create the required tables
        db = sqlite3.connect(db_path)
        db.executescript("""
            CREATE TABLE IF NOT EXISTS eval_runs (
                eval_id TEXT PRIMARY KEY, gepa_run_id TEXT, solver_path TEXT,
                solver_version TEXT, student_model TEXT, benchmark_subset TEXT,
                problem_count INTEGER, started_at REAL, finished_at REAL,
                status TEXT DEFAULT 'running', accuracy REAL, f1_score REAL,
                tp INTEGER DEFAULT 0, fp INTEGER DEFAULT 0, fn INTEGER DEFAULT 0,
                tn INTEGER DEFAULT 0, unparsed INTEGER DEFAULT 0,
                parse_success_rate REAL, avg_cost_usd REAL, avg_time_secs REAL,
                total_cost_usd REAL, display_name TEXT, notes TEXT
            );
            CREATE TABLE IF NOT EXISTS eval_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT, eval_id TEXT,
                problem_id TEXT, equation1 TEXT, equation2 TEXT,
                expected BOOLEAN, predicted BOOLEAN, correct BOOLEAN,
                response TEXT, elapsed_seconds REAL, cost_usd REAL,
                prompt_tokens INTEGER, completion_tokens INTEGER, error TEXT
            );
        """)
        db.close()

        # Run dry evaluation
        eval_id = run_evaluation(
            solver_path=prompt_path,
            solver_version="v1",
            subset="normal_200",
            db_path=db_path,
            dry_run=True,
        )

        # Verify DB records
        db = sqlite3.connect(db_path)
        db.row_factory = sqlite3.Row

        # Check eval_runs
        run = db.execute("SELECT * FROM eval_runs WHERE eval_id = ?", (eval_id,)).fetchone()
        assert run is not None
        assert run["status"] == "completed"
        assert run["problem_count"] == 200
        assert run["accuracy"] is not None
        assert run["f1_score"] is not None
        assert run["tp"] + run["fp"] + run["fn"] + run["tn"] == 200
        assert run["total_cost_usd"] == 0.0

        # Dry-run predicts FALSE, so:
        # - TRUE problems -> FN (predicted FALSE, expected TRUE)
        # - FALSE problems -> TN (predicted FALSE, expected FALSE)
        assert run["tp"] == 0
        assert run["fp"] == 0
        assert run["fn"] > 0  # some problems have answer=TRUE
        assert run["tn"] > 0  # some problems have answer=FALSE

        # Check eval_results
        results = db.execute(
            "SELECT COUNT(*) as n FROM eval_results WHERE eval_id = ?", (eval_id,)
        ).fetchone()
        assert results["n"] == 200

        # All results should have dry-run response
        dry_results = db.execute(
            "SELECT COUNT(*) as n FROM eval_results WHERE eval_id = ? AND response LIKE '%dry-run%'",
            (eval_id,),
        ).fetchone()
        assert dry_results["n"] == 200

        db.close()

        # Cleanup
        Path(prompt_path).unlink()
        Path(db_path).unlink()

    def test_dry_run_accuracy_matches_false_baseline(self):
        """Dry-run predicts FALSE for everything, so accuracy = proportion of FALSE problems."""
        with tempfile.NamedTemporaryFile(suffix=".txt", mode="w", delete=False) as f:
            f.write("Test prompt")
            prompt_path = f.name
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
            db_path = f.name

        db = sqlite3.connect(db_path)
        db.executescript("""
            CREATE TABLE IF NOT EXISTS eval_runs (
                eval_id TEXT PRIMARY KEY, gepa_run_id TEXT, solver_path TEXT,
                solver_version TEXT, student_model TEXT, benchmark_subset TEXT,
                problem_count INTEGER, started_at REAL, finished_at REAL,
                status TEXT DEFAULT 'running', accuracy REAL, f1_score REAL,
                tp INTEGER DEFAULT 0, fp INTEGER DEFAULT 0, fn INTEGER DEFAULT 0,
                tn INTEGER DEFAULT 0, unparsed INTEGER DEFAULT 0,
                parse_success_rate REAL, avg_cost_usd REAL, avg_time_secs REAL,
                total_cost_usd REAL, display_name TEXT, notes TEXT
            );
            CREATE TABLE IF NOT EXISTS eval_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT, eval_id TEXT,
                problem_id TEXT, equation1 TEXT, equation2 TEXT,
                expected BOOLEAN, predicted BOOLEAN, correct BOOLEAN,
                response TEXT, elapsed_seconds REAL, cost_usd REAL,
                prompt_tokens INTEGER, completion_tokens INTEGER, error TEXT
            );
        """)
        db.close()

        eval_id = run_evaluation(
            solver_path=prompt_path, solver_version="v1",
            subset="normal_200", db_path=db_path, dry_run=True,
        )

        # Count FALSE problems in normal_200
        problems = load_benchmark_problems("normal_200")
        false_count = sum(1 for p in problems if not p["answer"])

        db = sqlite3.connect(db_path)
        db.row_factory = sqlite3.Row
        run = db.execute("SELECT * FROM eval_runs WHERE eval_id = ?", (eval_id,)).fetchone()
        expected_accuracy = false_count / 200
        assert abs(run["accuracy"] - expected_accuracy) < 1e-6
        assert run["tn"] == false_count
        assert run["fn"] == 200 - false_count
        db.close()

        Path(prompt_path).unlink()
        Path(db_path).unlink()
