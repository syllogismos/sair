"""Tests for the GEPAObserver callback."""
import concurrent.futures
import json
import os
import sys
import tempfile
sys.path.insert(0, "src")

import dspy
from observer import GEPAObserver


def _make_observer(**kwargs):
    f = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    f.close()
    obs = GEPAObserver(f.name, **kwargs)
    return obs, f.name


def test_creates_tables():
    obs, path = _make_observer()
    try:
        cursor = obs.db.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = {row[0] for row in cursor.fetchall()}
        assert "llm_calls" in tables
        assert "runs" in tables
    finally:
        os.unlink(path)


def test_run_id_assigned():
    obs, path = _make_observer(run_name="test_run", solver="v1", auto="light")
    try:
        assert len(obs.run_id) == 12
        row = obs.db.execute("SELECT * FROM runs WHERE run_id = ?", (obs.run_id,)).fetchone()
        assert row is not None
    finally:
        os.unlink(path)


def test_separate_runs():
    f = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    f.close()
    try:
        obs1 = GEPAObserver(f.name, run_name="run1")
        obs2 = GEPAObserver(f.name, run_name="run2")
        assert obs1.run_id != obs2.run_id

        rows = obs1.db.execute("SELECT COUNT(*) FROM runs").fetchone()
        assert rows[0] == 2
    finally:
        os.unlink(f.name)


def test_logs_lm_call_with_run_id():
    obs, path = _make_observer(
        student_model="gemini-2.5-flash-lite",
        reflection_model="gemini-2.5-flash",
    )
    try:
        class FakeStudentLM:
            model = "gemini-2.5-flash-lite"
        class FakeReflectionLM:
            model = "gemini-2.5-flash"

        obs.on_lm_start("call_1", FakeStudentLM(), {"prompt": "test"})
        obs.on_lm_end("call_1", ["some response text"])

        obs.on_lm_start("call_2", FakeReflectionLM(), {"prompt": "reflect"})
        obs.on_lm_end("call_2", ["reflection response"])

        rows = obs.db.execute("SELECT run_id, model, role FROM llm_calls ORDER BY id").fetchall()
        assert rows[0][0] == obs.run_id
        assert rows[0][1] == "gemini-2.5-flash-lite"
        assert rows[0][2] == "student"
        assert rows[1][1] == "gemini-2.5-flash"
        assert rows[1][2] == "reflection"
    finally:
        os.unlink(path)


def test_logs_error():
    obs, path = _make_observer()
    try:
        class FakeLM:
            model = "gemini-2.5-flash-lite"

        obs.on_lm_start("call_err", FakeLM(), {})
        obs.on_lm_end("call_err", None, exception=ValueError("API timeout"))

        row = obs.db.execute("SELECT error FROM llm_calls").fetchone()
        assert "API timeout" in row[0]
    finally:
        os.unlink(path)


def test_finish_updates_status():
    obs, path = _make_observer()
    try:
        obs.finish("completed")
        row = obs.db.execute(
            "SELECT status, finished_at FROM runs WHERE run_id = ?", (obs.run_id,)
        ).fetchone()
        assert row[0] == "completed"
        assert row[1] is not None
    finally:
        os.unlink(path)


def test_get_summary_filters_by_run():
    f = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    f.close()
    try:
        obs1 = GEPAObserver(f.name, run_name="run1", student_model="gemini-2.5-flash-lite")
        obs2 = GEPAObserver(f.name, run_name="run2", student_model="gemini-2.5-flash-lite")

        class FakeLM:
            model = "gemini-2.5-flash-lite"

        obs1.on_lm_start("c1", FakeLM(), {})
        obs1.on_lm_end("c1", ["resp"])
        obs1.on_lm_start("c2", FakeLM(), {})
        obs1.on_lm_end("c2", ["resp"])

        obs2.on_lm_start("c3", FakeLM(), {})
        obs2.on_lm_end("c3", ["resp"])

        summary1 = obs1.get_summary()
        summary2 = obs2.get_summary()
        assert summary1["student"]["calls"] == 2
        assert summary2["student"]["calls"] == 1
    finally:
        os.unlink(f.name)


def test_cost_estimation():
    obs, path = _make_observer()
    try:
        cost = obs._estimate_cost("gemini-2.5-flash-lite", 1_000_000, 1_000_000)
        assert cost == 0.10 + 0.40
    finally:
        os.unlink(path)


# --- GEPA tracking tables ---

def test_creates_gepa_tables():
    obs, path = _make_observer()
    try:
        cursor = obs.db.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = {row[0] for row in cursor.fetchall()}
        assert "gepa_metric_calls" in tables
        assert "gepa_candidates" in tables
        assert "gepa_candidate_scores" in tables
        assert "gepa_pareto" in tables
    finally:
        os.unlink(path)


# --- Metric wrapper ---

def _fake_metric(gold, pred, trace=None, pred_name=None, pred_trace=None):
    verdict = pred.verdict
    if isinstance(verdict, str):
        verdict = verdict.strip().lower() in ("true", "1", "yes")
    correct = verdict == gold.answer
    return dspy.Prediction(score=1.0 if correct else 0.0, feedback="ok" if correct else "wrong")


def test_wrap_metric_logs_calls():
    obs, path = _make_observer()
    try:
        wrapped = obs.wrap_metric(_fake_metric)
        gold = dspy.Example(
            id="p1", equation1="x=x", equation2="x=x", answer=True
        ).with_inputs("equation1", "equation2")

        result = wrapped(gold, dspy.Prediction(verdict="TRUE"))
        assert result.score == 1.0

        row = obs.db.execute(
            "SELECT run_id, problem_id, expected, predicted, score FROM gepa_metric_calls"
        ).fetchone()
        assert row[0] == obs.run_id
        assert row[1] == "p1"
        assert row[2] == 1  # expected True
        assert row[3] == 1  # predicted True
        assert row[4] == 1.0
    finally:
        os.unlink(path)


def test_wrap_metric_logs_wrong_answer():
    obs, path = _make_observer()
    try:
        wrapped = obs.wrap_metric(_fake_metric)
        gold = dspy.Example(
            id="p2", equation1="x=x", equation2="x=x", answer=True
        ).with_inputs("equation1", "equation2")

        result = wrapped(gold, dspy.Prediction(verdict="FALSE"))
        assert result.score == 0.0

        row = obs.db.execute("SELECT predicted, score, feedback_preview FROM gepa_metric_calls").fetchone()
        assert row[0] == 0  # predicted False
        assert row[1] == 0.0
        assert "wrong" in row[2]
    finally:
        os.unlink(path)


def test_wrap_metric_increments_seq():
    obs, path = _make_observer()
    try:
        wrapped = obs.wrap_metric(_fake_metric)
        gold = dspy.Example(
            id="p1", equation1="x=x", equation2="x=x", answer=True
        ).with_inputs("equation1", "equation2")

        wrapped(gold, dspy.Prediction(verdict="TRUE"))
        wrapped(gold, dspy.Prediction(verdict="FALSE"))
        wrapped(gold, dspy.Prediction(verdict="TRUE"))

        rows = obs.db.execute("SELECT seq FROM gepa_metric_calls ORDER BY seq").fetchall()
        assert [r[0] for r in rows] == [1, 2, 3]
    finally:
        os.unlink(path)


def test_wrap_metric_preserves_return_value():
    obs, path = _make_observer()
    try:
        wrapped = obs.wrap_metric(_fake_metric)
        gold = dspy.Example(
            id="p1", equation1="x=x", equation2="x=x", answer=False
        ).with_inputs("equation1", "equation2")

        result = wrapped(gold, dspy.Prediction(verdict="FALSE"))
        # Must return exactly what the original metric returns
        assert result.score == 1.0
        assert result.feedback == "ok"
    finally:
        os.unlink(path)


# --- dump_gepa_results ---

class _FakeDetailedResults:
    """Mimics DspyGEPAResult for testing."""
    def __init__(self):
        self.candidates = [
            {"solve": "Think step by step."},
            {"solve": "Analyze the magma structure carefully."},
            {"solve": "Check if eq1 trivializes, then verify eq2."},
        ]
        self.parents = [[None], [0], [1]]
        self.val_aggregate_scores = [0.65, 0.72, 0.80]
        self.val_subscores = [
            [1.0, 0.0, 1.0, 0.0, 1.0],
            [1.0, 1.0, 0.0, 1.0, 0.0],
            [1.0, 1.0, 1.0, 0.0, 1.0],
        ]
        self.per_val_instance_best_candidates = [
            {0, 1, 2}, {1, 2}, {0, 2}, {1}, {0, 2},
        ]
        self.discovery_eval_counts = [100, 250, 400]


class _FakeOptimized:
    def __init__(self):
        self.detailed_results = _FakeDetailedResults()


def test_dump_gepa_results_candidates():
    obs, path = _make_observer()
    try:
        obs.dump_gepa_results(_FakeOptimized())

        rows = obs.db.execute(
            "SELECT candidate_idx, val_score, instructions FROM gepa_candidates ORDER BY candidate_idx"
        ).fetchall()
        assert len(rows) == 3
        assert rows[0][0] == 0
        assert rows[0][1] == 0.65
        assert "step by step" in json.loads(rows[0][2])["solve"]

        assert rows[2][0] == 2
        assert rows[2][1] == 0.80
    finally:
        os.unlink(path)


def test_dump_gepa_results_parents():
    obs, path = _make_observer()
    try:
        obs.dump_gepa_results(_FakeOptimized())

        rows = obs.db.execute(
            "SELECT candidate_idx, parents FROM gepa_candidates ORDER BY candidate_idx"
        ).fetchall()
        assert json.loads(rows[0][1]) == [None]
        assert json.loads(rows[1][1]) == [0]
        assert json.loads(rows[2][1]) == [1]
    finally:
        os.unlink(path)


def test_dump_gepa_results_scores():
    obs, path = _make_observer()
    try:
        obs.dump_gepa_results(_FakeOptimized())

        # Non-zero scores only
        count = obs.db.execute("SELECT COUNT(*) FROM gepa_candidate_scores").fetchone()[0]
        # 3 candidates x 5 vals, minus zeros: cand0=[1,0,1,0,1]=3, cand1=[1,1,0,1,0]=3, cand2=[1,1,1,0,1]=4 → 10
        assert count == 10

        # Check a specific score
        row = obs.db.execute(
            "SELECT score FROM gepa_candidate_scores WHERE candidate_idx=2 AND val_idx=2"
        ).fetchone()
        assert row[0] == 1.0
    finally:
        os.unlink(path)


def test_dump_gepa_results_pareto():
    obs, path = _make_observer()
    try:
        obs.dump_gepa_results(_FakeOptimized())

        rows = obs.db.execute(
            "SELECT val_idx, best_candidate_idxs FROM gepa_pareto ORDER BY val_idx"
        ).fetchall()
        assert len(rows) == 5
        assert json.loads(rows[0][1]) == [0, 1, 2]  # val_idx=0, all candidates are best
        assert json.loads(rows[3][1]) == [1]          # val_idx=3, only candidate 1
    finally:
        os.unlink(path)


def test_dump_gepa_results_metric_calls_at_discovery():
    obs, path = _make_observer()
    try:
        obs.dump_gepa_results(_FakeOptimized())

        rows = obs.db.execute(
            "SELECT candidate_idx, metric_calls_at_discovery FROM gepa_candidates ORDER BY candidate_idx"
        ).fetchall()
        assert rows[0][1] == 100
        assert rows[1][1] == 250
        assert rows[2][1] == 400
    finally:
        os.unlink(path)


def test_dump_gepa_results_no_detailed_results():
    """Should be a no-op if detailed_results is missing."""
    obs, path = _make_observer()
    try:
        class NoResults:
            pass
        obs.dump_gepa_results(NoResults())
        count = obs.db.execute("SELECT COUNT(*) FROM gepa_candidates").fetchone()[0]
        assert count == 0
    finally:
        os.unlink(path)


# --- Pareto edge cases ---

def test_dump_pareto_with_int_instead_of_set():
    """per_val_instance_best_candidates may contain ints instead of sets."""
    obs, path = _make_observer()
    try:
        fake = _FakeOptimized()
        fake.detailed_results.per_val_instance_best_candidates = [0, 1, 2, 1, 0]
        obs.dump_gepa_results(fake)

        rows = obs.db.execute(
            "SELECT val_idx, best_candidate_idxs FROM gepa_pareto ORDER BY val_idx"
        ).fetchall()
        assert len(rows) == 5
        assert json.loads(rows[0][1]) == [0]
        assert json.loads(rows[1][1]) == [1]
    finally:
        os.unlink(path)


# --- Prompt and response logging ---

def test_logs_full_prompt_and_response():
    obs, path = _make_observer()
    try:
        class FakeLM:
            model = "gemini-2.5-flash-lite"

        obs.on_lm_start("call_full", FakeLM(), {
            "messages": [
                {"role": "system", "content": "You are a mathematician."},
                {"role": "user", "content": "Does x=x imply y=y?"},
            ]
        })
        long_response = "Yes, because " + "x" * 1000
        obs.on_lm_end("call_full", [long_response])

        row = obs.db.execute(
            "SELECT prompt_full, response_preview, response_full FROM llm_calls"
        ).fetchone()
        assert "[system]: You are a mathematician." in row[0]
        assert "[user]: Does x=x imply y=y?" in row[0]
        assert len(row[1]) == 500  # preview is truncated
        assert len(row[2]) > 500  # full is not truncated
        assert row[2] == long_response
    finally:
        os.unlink(path)


def test_logs_prompt_from_string():
    obs, path = _make_observer()
    try:
        class FakeLM:
            model = "gemini-2.5-flash-lite"

        obs.on_lm_start("call_str", FakeLM(), {"prompt": "test prompt text"})
        obs.on_lm_end("call_str", ["response"])

        row = obs.db.execute("SELECT prompt_full FROM llm_calls").fetchone()
        assert row[0] == "test prompt text"
    finally:
        os.unlink(path)


def test_null_byte_sanitization():
    obs, path = _make_observer()
    try:
        class FakeLM:
            model = "gemini-2.5-flash-lite"

        obs.on_lm_start("call_null", FakeLM(), {"prompt": "hello\x00world"})
        obs.on_lm_end("call_null", ["resp\x00onse"])

        row = obs.db.execute("SELECT prompt_full, response_full FROM llm_calls").fetchone()
        assert "\x00" not in row[0]
        assert "\x00" not in row[1]
        assert row[0] == "helloworld"
        assert row[1] == "response"
    finally:
        os.unlink(path)


# --- Thread safety ---

def test_metric_wrapper_thread_safety():
    """Metric wrapper must handle concurrent calls from DSPy's parallelizer."""
    obs, path = _make_observer()
    try:
        wrapped = obs.wrap_metric(_fake_metric)

        gold_true = dspy.Example(
            id="p1", equation1="x=x", equation2="x=x", answer=True
        ).with_inputs("equation1", "equation2")
        gold_false = dspy.Example(
            id="p2", equation1="x=x", equation2="x=x", answer=False
        ).with_inputs("equation1", "equation2")

        def call_metric(i):
            gold = gold_true if i % 2 == 0 else gold_false
            verdict = "TRUE" if i % 2 == 0 else "FALSE"
            return wrapped(gold, dspy.Prediction(verdict=verdict))

        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            futures = [executor.submit(call_metric, i) for i in range(20)]
            results = [f.result() for f in futures]

        assert all(r.score == 1.0 for r in results)

        count = obs.db.execute("SELECT COUNT(*) FROM gepa_metric_calls").fetchone()[0]
        assert count == 20

        # Seq numbers should be unique
        seqs = obs.db.execute("SELECT seq FROM gepa_metric_calls ORDER BY seq").fetchall()
        seq_list = [r[0] for r in seqs]
        assert len(set(seq_list)) == 20
    finally:
        os.unlink(path)


# --- GEPA iteration tables ---

def test_creates_gepa_iterations_table():
    obs, path = _make_observer()
    try:
        cursor = obs.db.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = {row[0] for row in cursor.fetchall()}
        assert "gepa_iterations" in tables
    finally:
        os.unlink(path)


def test_install_gepa_hooks():
    """install_gepa_hooks should patch ExperimentTracker.log_metrics."""
    obs, path = _make_observer()
    try:
        from gepa.logging.experiment_tracker import ExperimentTracker
        original = ExperimentTracker.log_metrics

        obs.install_gepa_hooks()

        # Should be patched now
        assert ExperimentTracker.log_metrics is not original

        # Simulate what GEPA does — call log_metrics with iteration data
        tracker = ExperimentTracker()
        tracker.log_metrics({
            "iteration": 1,
            "selected_program_candidate": 0,
            "total_metric_calls": 6,
        }, step=1)

        # These calls DON'T include "iteration" — just like real GEPA
        tracker.log_metrics({
            "subsample_score": 2.0,
            "total_metric_calls": 9,
        }, step=1)

        tracker.log_metrics({
            "new_instruction_solve.predict": "Think about magmas carefully.",
        }, step=1)

        tracker.log_metrics({
            "new_subsample_score": 3.0,
            "total_metric_calls": 12,
        }, step=1)

        rows = obs.db.execute(
            "SELECT iteration, event, selected_candidate, subsample_score, new_subsample_score, new_instructions "
            "FROM gepa_iterations WHERE run_id = ? ORDER BY id",
            (obs.run_id,)
        ).fetchall()

        assert len(rows) == 4
        assert rows[0][1] == "select_parent"
        assert rows[0][2] == 0
        # iteration should carry forward from select_parent
        assert rows[1][0] == 1  # carried from select_parent
        assert rows[1][1] == "subsample_before"
        assert rows[1][3] == 2.0
        assert rows[2][0] == 1  # carried
        assert rows[2][1] == "proposal"
        instructions = json.loads(rows[2][5])
        assert "magmas" in instructions["solve.predict"]
        assert rows[3][0] == 1  # carried
        assert rows[3][1] == "subsample_eval"
        assert rows[3][4] == 3.0

        # Restore original
        ExperimentTracker.log_metrics = original
    finally:
        os.unlink(path)


def test_gepa_hooks_candidate_accepted():
    obs, path = _make_observer()
    try:
        from gepa.logging.experiment_tracker import ExperimentTracker
        original = ExperimentTracker.log_metrics

        obs.install_gepa_hooks()

        tracker = ExperimentTracker()
        tracker.log_metrics({
            "iteration": 2,
            "new_program_idx": 1,
            "best_score_on_valset": 0.75,
            "total_metric_calls": 20,
        }, step=2)

        row = obs.db.execute(
            "SELECT event, new_program_idx, best_score FROM gepa_iterations WHERE run_id = ?",
            (obs.run_id,)
        ).fetchone()

        assert row[0] == "candidate_accepted"
        assert row[1] == 1
        assert row[2] == 0.75

        ExperimentTracker.log_metrics = original
    finally:
        os.unlink(path)
