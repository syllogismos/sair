"""Tests for the GEPAObserver callback."""
import os
import sys
import tempfile
sys.path.insert(0, "src")

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
    obs, path = _make_observer()
    try:
        class FakeLM:
            model = "gemini-2.5-flash-lite"

        obs.on_lm_start("call_1", FakeLM(), {"prompt": "test"})
        obs.on_lm_end("call_1", ["some response text"])

        row = obs.db.execute("SELECT run_id, model, role FROM llm_calls").fetchone()
        assert row[0] == obs.run_id
        assert row[1] == "gemini-2.5-flash-lite"
        assert row[2] == "student"
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
        obs1 = GEPAObserver(f.name, run_name="run1")
        obs2 = GEPAObserver(f.name, run_name="run2")

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
