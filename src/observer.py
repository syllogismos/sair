"""DSPy callback that logs every LLM call and GEPA optimization data to SQLite."""
import json
import sqlite3
import threading
import time
import uuid
from typing import Any

import dspy
from dspy.utils.callback import BaseCallback


class GEPAObserver(BaseCallback):
    """Logs LLM calls and GEPA optimization data to SQLite.

    Two tracking modes:
    1. Real-time: LLM calls (via DSPy callbacks) + metric evaluations (via wrap_metric)
    2. Post-run: Full GEPA results (via dump_gepa_results after compile)
    """

    def __init__(self, db_path: str, run_name: str = "", solver: str = "", auto: str = "",
                 student_model: str = "", reflection_model: str = ""):
        self.db = sqlite3.connect(db_path, check_same_thread=False, isolation_level=None)
        self._db_lock = threading.Lock()
        self.run_id = uuid.uuid4().hex[:12]
        self.run_name = run_name
        self._call_starts: dict[str, dict[str, Any]] = {}
        self._metric_call_seq = 0
        self._student_model = student_model
        self._reflection_model = reflection_model

        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS runs (
                run_id TEXT PRIMARY KEY,
                name TEXT,
                solver TEXT,
                auto TEXT,
                started_at REAL,
                finished_at REAL,
                status TEXT DEFAULT 'running',
                train_size INTEGER,
                val_size INTEGER
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
                prompt_full TEXT,
                response_preview TEXT,
                response_full TEXT,
                error TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_llm_calls_run ON llm_calls(run_id);

            -- Real-time: every metric() call during GEPA evaluation
            CREATE TABLE IF NOT EXISTS gepa_metric_calls (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT,
                seq INTEGER,
                timestamp REAL,
                problem_id TEXT,
                expected INTEGER,
                predicted INTEGER,
                score REAL,
                feedback_preview TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_metric_calls_run ON gepa_metric_calls(run_id);

            -- Real-time: GEPA iteration events (from experiment_tracker.log_metrics hook)
            CREATE TABLE IF NOT EXISTS gepa_iterations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT,
                timestamp REAL,
                iteration INTEGER,
                event TEXT,
                selected_candidate INTEGER,
                subsample_score REAL,
                new_subsample_score REAL,
                new_instructions TEXT,
                new_program_idx INTEGER,
                best_score REAL,
                total_metric_calls INTEGER,
                raw_metrics TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_iterations_run ON gepa_iterations(run_id);

            -- Post-run: candidate programs proposed by GEPA
            CREATE TABLE IF NOT EXISTS gepa_candidates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT,
                candidate_idx INTEGER,
                parents TEXT,
                instructions TEXT,
                val_score REAL,
                metric_calls_at_discovery INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_candidates_run ON gepa_candidates(run_id);

            -- Post-run: per-candidate per-validation-instance scores
            CREATE TABLE IF NOT EXISTS gepa_candidate_scores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT,
                candidate_idx INTEGER,
                val_idx INTEGER,
                score REAL
            );
            CREATE INDEX IF NOT EXISTS idx_cand_scores_run ON gepa_candidate_scores(run_id);

            -- Post-run: Pareto frontier — which candidate is best per val instance
            CREATE TABLE IF NOT EXISTS gepa_pareto (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT,
                val_idx INTEGER,
                best_candidate_idxs TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_pareto_run ON gepa_pareto(run_id);
        """)

        self.db.execute(
            "INSERT INTO runs (run_id, name, solver, auto, started_at, status) VALUES (?, ?, ?, ?, ?, ?)",
            (self.run_id, run_name, solver, auto, time.time(), "running"),
        )

    # --- Real-time: GEPA experiment tracker hook ---

    def install_gepa_hooks(self):
        """Monkey-patch GEPA's ExperimentTracker.log_metrics to stream iteration data to SQLite.

        Call BEFORE optimizer.compile(). Intercepts every log_metrics() call from
        GEPA's engine, capturing: selected candidate, proposed instructions,
        subsample scores, acceptance decisions, Pareto updates — all in real-time.
        """
        observer = self
        # Track the current iteration number across log_metrics calls,
        # because GEPA doesn't include "iteration" in every call.
        current_iter = {"value": None}

        from gepa.logging.experiment_tracker import ExperimentTracker
        original_log = ExperimentTracker.log_metrics

        def patched_log_metrics(tracker_self, metrics, step=None):
            # Call original (WandB/MLflow if configured)
            original_log(tracker_self, metrics, step=step)

            # Track iteration number — carry forward from calls that include it
            if "iteration" in metrics:
                current_iter["value"] = metrics["iteration"]
            iteration = metrics.get("iteration", current_iter["value"])

            # Determine event type from metrics keys
            if "base_program_full_valset_score" in metrics:
                event = "base_eval"
            elif "new_instruction_solve.predict" in metrics or any(
                k.startswith("new_instruction_") for k in metrics
            ):
                event = "proposal"
            elif "new_subsample_score" in metrics:
                event = "subsample_eval"
            elif "subsample_score" in metrics:
                event = "subsample_before"
            elif "new_program_idx" in metrics:
                event = "candidate_accepted"
            elif "selected_program_candidate" in metrics:
                event = "select_parent"
            else:
                event = "other"

            # Extract instruction proposals
            new_instructions = {
                k.replace("new_instruction_", ""): v
                for k, v in metrics.items()
                if k.startswith("new_instruction_")
            }

            with observer._db_lock:
                observer.db.execute(
                    """INSERT INTO gepa_iterations
                       (run_id, timestamp, iteration, event, selected_candidate,
                        subsample_score, new_subsample_score, new_instructions,
                        new_program_idx, best_score, total_metric_calls, raw_metrics)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        observer.run_id,
                        time.time(),
                        iteration,
                        event,
                        metrics.get("selected_program_candidate"),
                        metrics.get("subsample_score"),
                        metrics.get("new_subsample_score"),
                        json.dumps(new_instructions) if new_instructions else None,
                        metrics.get("new_program_idx"),
                        metrics.get("best_score_on_valset") or metrics.get("best_valset_agg_score"),
                        metrics.get("total_metric_calls"),
                        json.dumps({k: v for k, v in metrics.items()
                                    if isinstance(v, (int, float, str, bool))}, default=str),
                    ),
                )

        ExperimentTracker.log_metrics = patched_log_metrics

    def store_dataset_sizes(self, train_size: int, val_size: int):
        """Store train/val split sizes so the dashboard can show eval progress."""
        self.db.execute(
            "UPDATE runs SET train_size = ?, val_size = ? WHERE run_id = ?",
            (train_size, val_size, self.run_id),
        )

    def store_seed_instruction(self, solver):
        """Store the seed candidate's instruction so the dashboard can show it."""
        instructions = {}
        for name, pred in solver.named_predictors():
            instructions[name] = str(pred.signature.instructions)
        with self._db_lock:
            self.db.execute(
                """INSERT INTO gepa_iterations
                   (run_id, timestamp, iteration, event, new_instructions)
                   VALUES (?, ?, 0, 'seed_instruction', ?)""",
                (self.run_id, time.time(), json.dumps(instructions)),
            )

    # --- Real-time: metric wrapper ---

    def wrap_metric(self, metric_fn):
        """Wrap a GEPA metric function to log every call.

        Usage:
            observer = GEPAObserver(...)
            tracked_metric = observer.wrap_metric(metric)
            optimizer = dspy.GEPA(metric=tracked_metric, ...)
        """
        def wrapped(gold, pred, trace=None, pred_name=None, pred_trace=None):
            result = metric_fn(gold, pred, trace, pred_name, pred_trace)

            problem_id = getattr(gold, "id", None)

            # Parse verdict from prediction
            verdict = pred.verdict
            if isinstance(verdict, str):
                predicted = verdict.strip().lower() in ("true", "1", "yes")
            else:
                predicted = bool(verdict)

            expected_answer = gold.answer
            if isinstance(expected_answer, str):
                expected_answer = expected_answer.strip().lower() in ("true", "1", "yes")

            score = result.score if hasattr(result, "score") else float(result)
            feedback = ""
            if hasattr(result, "feedback"):
                feedback = str(result.feedback)

            with self._db_lock:
                self._metric_call_seq += 1
                self.db.execute(
                    """INSERT INTO gepa_metric_calls
                       (run_id, seq, timestamp, problem_id, expected, predicted, score, feedback_preview)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (self.run_id, self._metric_call_seq, time.time(),
                     problem_id, int(expected_answer), int(predicted), score, feedback),
                )

            return result
        return wrapped

    # --- Post-run: dump detailed_results ---

    def dump_gepa_results(self, optimized_program):
        """Extract GEPA optimization data from detailed_results and write to SQLite.

        Call after optimizer.compile() returns.
        """
        dr = getattr(optimized_program, "detailed_results", None)
        if dr is None:
            return

        # Candidates: instructions, parents, aggregate scores, budget
        for idx in range(len(dr.val_aggregate_scores)):
            # Extract instruction text from each candidate module
            candidate = dr.candidates[idx] if idx < len(dr.candidates) else None
            instructions = {}
            if candidate is not None:
                if isinstance(candidate, dict):
                    instructions = candidate
                elif hasattr(candidate, "named_predictors"):
                    for name, pred in candidate.named_predictors():
                        instructions[name] = str(pred.signature.instructions)

            parents = dr.parents[idx] if idx < len(dr.parents) else []

            self.db.execute(
                """INSERT INTO gepa_candidates
                   (run_id, candidate_idx, parents, instructions, val_score, metric_calls_at_discovery)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (self.run_id, idx, json.dumps(parents), json.dumps(instructions),
                 dr.val_aggregate_scores[idx],
                 dr.discovery_eval_counts[idx] if idx < len(dr.discovery_eval_counts) else None),
            )

        # Per-instance scores (sparse — only non-zero)
        score_rows = []
        for cand_idx, subscores in enumerate(dr.val_subscores):
            for val_idx, score in enumerate(subscores):
                if score != 0.0:
                    score_rows.append((self.run_id, cand_idx, val_idx, score))
        if score_rows:
            self.db.executemany(
                "INSERT INTO gepa_candidate_scores (run_id, candidate_idx, val_idx, score) VALUES (?, ?, ?, ?)",
                score_rows,
            )

        # Pareto frontier
        for val_idx, best_set in enumerate(dr.per_val_instance_best_candidates):
            if isinstance(best_set, (set, list, frozenset)):
                idxs = sorted(best_set)
            else:
                idxs = [best_set]
            self.db.execute(
                "INSERT INTO gepa_pareto (run_id, val_idx, best_candidate_idxs) VALUES (?, ?, ?)",
                (self.run_id, val_idx, json.dumps(idxs)),
            )

    # --- LLM call tracking (existing) ---

    def on_lm_start(self, call_id: str, instance: Any, inputs: dict[str, Any]):
        # Capture the full prompt/messages for logging
        prompt_full = ""
        messages = inputs.get("messages") or inputs.get("prompt") or ""
        if isinstance(messages, list):
            parts = []
            for m in messages:
                if isinstance(m, dict):
                    role = m.get("role", "")
                    content = m.get("content", "")
                    parts.append(f"[{role}]: {content}")
            prompt_full = "\n\n".join(parts)
        else:
            prompt_full = str(messages)

        self._call_starts[call_id] = {
            "time": time.time(),
            "model": getattr(instance, "model", "unknown"),
            "instance": instance,
            "prompt_full": prompt_full,
        }

    def on_lm_end(self, call_id: str, outputs: Any | None, exception: Exception | None = None):
        if call_id not in self._call_starts:
            return
        start = self._call_starts.pop(call_id)
        duration = time.time() - start["time"]
        model = start["model"]
        instance = start.get("instance")

        # Determine role from explicitly configured model names
        if self._student_model and self._student_model in model:
            role = "student"
        elif self._reflection_model and self._reflection_model in model:
            role = "reflection"
        elif self._student_model:
            role = "reflection" if model != self._student_model else "student"
        else:
            role = "unknown"

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

        # Response
        response_full = ""
        if outputs and isinstance(outputs, list) and len(outputs) > 0:
            response_full = str(outputs[0])
        response_preview = response_full[:500]

        error_text = str(exception)[:500] if exception else None

        prompt_full = start.get("prompt_full", "") or ""
        # Sanitize: SQLite can't handle null bytes
        if "\x00" in prompt_full:
            prompt_full = prompt_full.replace("\x00", "")
        if "\x00" in response_full:
            response_full = response_full.replace("\x00", "")

        with self._db_lock:
            self.db.execute(
                """INSERT INTO llm_calls
                   (run_id, timestamp, call_id, model, role, prompt_tokens, completion_tokens,
                    cost_usd, duration_secs, prompt_full, response_preview, response_full, error)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (self.run_id, start["time"], call_id, model, role,
                 prompt_tokens, completion_tokens, cost, duration,
                 prompt_full, response_preview, response_full, error_text),
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
            "claude-opus-4-6": (15.0, 75.0),
            "claude-sonnet-4-6": (3.0, 15.0),
            "claude-haiku-4-5": (0.80, 4.0),
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
