"""DSPy callback that logs every LLM call to SQLite for dashboard observability."""
import sqlite3
import time
import uuid
from typing import Any

from dspy.utils.callback import BaseCallback


class GEPAObserver(BaseCallback):
    """Logs every LLM call during GEPA optimization to SQLite.

    Each instantiation creates a new run_id so experiments are separated.
    """

    def __init__(self, db_path: str, run_name: str = "", solver: str = "", auto: str = ""):
        self.db = sqlite3.connect(db_path, check_same_thread=False, isolation_level=None)
        self.run_id = uuid.uuid4().hex[:12]
        self.run_name = run_name
        self._call_starts: dict[str, dict[str, Any]] = {}

        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS runs (
                run_id TEXT PRIMARY KEY,
                name TEXT,
                solver TEXT,
                auto TEXT,
                started_at REAL,
                finished_at REAL,
                status TEXT DEFAULT 'running'
            );
            CREATE TABLE IF NOT EXISTS llm_calls (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT,
                timestamp REAL,
                call_id TEXT,
                model TEXT,
                role TEXT,
                prompt_tokens INTEGER,
                completion_tokens INTEGER,
                cost_usd REAL,
                duration_secs REAL,
                response_preview TEXT,
                error TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_llm_calls_run ON llm_calls(run_id);
        """)

        self.db.execute(
            "INSERT INTO runs (run_id, name, solver, auto, started_at, status) VALUES (?, ?, ?, ?, ?, ?)",
            (self.run_id, run_name, solver, auto, time.time(), "running"),
        )

    def on_lm_start(self, call_id: str, instance: Any, inputs: dict[str, Any]):
        self._call_starts[call_id] = {
            "time": time.time(),
            "model": getattr(instance, "model", "unknown"),
            "instance": instance,
        }

    def on_lm_end(self, call_id: str, outputs: Any | None, exception: Exception | None = None):
        if call_id not in self._call_starts:
            return
        start = self._call_starts.pop(call_id)
        duration = time.time() - start["time"]
        model = start["model"]
        instance = start.get("instance")

        # Determine role based on model name
        role = "reflection" if any(k in model for k in ("pro", "opus", "gpt-5.")) else "student"

        # Extract token usage from LM history or estimate from text
        prompt_tokens = 0
        completion_tokens = 0
        if instance and hasattr(instance, "history") and instance.history:
            last = instance.history[-1]
            resp = last.get("response")
            # Try API-reported usage first
            if resp:
                usage = getattr(resp, "usage", None)
                if usage:
                    prompt_tokens = getattr(usage, "prompt_tokens", 0) or 0
                    completion_tokens = getattr(usage, "completion_tokens", 0) or 0

            # Estimate from text if API didn't report (~4 chars per token)
            if prompt_tokens == 0:
                msgs = last.get("messages") or last.get("prompt") or ""
                if isinstance(msgs, list):
                    prompt_text = " ".join(m.get("content", "") for m in msgs if isinstance(m, dict))
                else:
                    prompt_text = str(msgs)
                prompt_tokens = max(1, len(prompt_text) // 4)
            if completion_tokens == 0 and outputs and isinstance(outputs, list) and outputs:
                completion_tokens = max(1, len(str(outputs[0])) // 4)

        cost = self._estimate_cost(model, prompt_tokens, completion_tokens)

        # Response preview
        response_preview = ""
        if outputs and isinstance(outputs, list) and len(outputs) > 0:
            response_preview = str(outputs[0])[:500]

        error_text = str(exception)[:500] if exception else None

        self.db.execute(
            """INSERT INTO llm_calls
               (run_id, timestamp, call_id, model, role, prompt_tokens, completion_tokens,
                cost_usd, duration_secs, response_preview, error)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (self.run_id, start["time"], call_id, model, role,
             prompt_tokens, completion_tokens, cost, duration,
             response_preview, error_text),
        )

    def finish(self, status: str = "completed"):
        """Mark the run as finished."""
        self.db.execute(
            "UPDATE runs SET finished_at = ?, status = ? WHERE run_id = ?",
            (time.time(), status, self.run_id),
        )

    def _estimate_cost(self, model: str, prompt_tokens: int, completion_tokens: int) -> float:
        """Cost estimation per model. Vertex AI standard pricing."""
        rates = {
            # (input_per_1M, output_per_1M)
            "gemini-2.0-flash-lite": (0.075, 0.30),
            "gemini-2.0-flash": (0.15, 0.60),
            "gemini-2.5-flash-lite": (0.10, 0.40),
            "gemini-2.5-flash": (0.30, 2.50),
            "gemini-2.5-pro": (1.25, 10.0),
            "gemini-3.1-pro-preview": (2.0, 12.0),
            "gemini-3.1-pro": (2.0, 12.0),
            "gemini-3-flash": (0.50, 3.0),
            "gemini-3.1-flash-lite": (0.25, 1.50),
        }
        for key, (inp, out) in rates.items():
            if key in model:
                return (prompt_tokens * inp + completion_tokens * out) / 1_000_000
        # Fallback
        return (prompt_tokens * 1.0 + completion_tokens * 3.0) / 1_000_000

    def get_summary(self, run_id: str | None = None) -> dict:
        """Get summary stats for a run (defaults to current run)."""
        rid = run_id or self.run_id
        cursor = self.db.execute("""
            SELECT role, COUNT(*) as calls,
                   SUM(prompt_tokens) as total_prompt,
                   SUM(completion_tokens) as total_completion,
                   SUM(cost_usd) as total_cost,
                   SUM(duration_secs) as total_time,
                   SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) as errors
            FROM llm_calls WHERE run_id = ? GROUP BY role
        """, (rid,))
        return {row[0]: dict(zip(
            ["calls", "prompt_tokens", "completion_tokens", "cost_usd", "duration_secs", "errors"],
            row[1:]
        )) for row in cursor.fetchall()}
