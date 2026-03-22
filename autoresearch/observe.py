"""SQLite observability logger for autoresearch experiments.

Logs every LLM call and experiment summary to a SQLite database
that the dashboard can read for real-time observability.
"""

import sqlite3
import time
from pathlib import Path


DEFAULT_DB_PATH = str(Path(__file__).parent.parent / "dashboard" / "autoresearch.db")


class AutoResearchObserver:
    """Logs autoresearch experiments and LLM calls to SQLite."""

    def __init__(self, db_path: str = DEFAULT_DB_PATH):
        self.db = sqlite3.connect(db_path, check_same_thread=False)
        self.db.execute("PRAGMA journal_mode=WAL")
        self._create_tables()

    def _create_tables(self):
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS experiments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT UNIQUE,
                timestamp REAL,
                model TEXT,
                cheatsheet_bytes INTEGER,
                total_problems INTEGER,
                accuracy REAL,
                true_accuracy REAL,
                false_accuracy REAL,
                unparsed INTEGER,
                total_cost_usd REAL,
                total_prompt_tokens INTEGER,
                total_completion_tokens INTEGER,
                eval_seconds REAL,
                status TEXT,
                description TEXT
            );

            CREATE TABLE IF NOT EXISTS llm_calls (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT,
                timestamp REAL,
                problem_id TEXT,
                equation1 TEXT,
                equation2 TEXT,
                model TEXT,
                prompt_tokens INTEGER,
                completion_tokens INTEGER,
                cost_usd REAL,
                duration_secs REAL,
                gold_answer INTEGER,
                predicted_answer INTEGER,
                correct INTEGER,
                response TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_llm_calls_run_id ON llm_calls(run_id);
            CREATE INDEX IF NOT EXISTS idx_llm_calls_problem_id ON llm_calls(problem_id);
            CREATE INDEX IF NOT EXISTS idx_llm_calls_correct ON llm_calls(correct);
            CREATE INDEX IF NOT EXISTS idx_experiments_timestamp ON experiments(timestamp);
        """)
        self.db.commit()

    def log_experiment(self, run_id: str, model: str, cheatsheet_bytes: int,
                       total_problems: int, accuracy: float, true_accuracy: float,
                       false_accuracy: float, unparsed: int, eval_seconds: float,
                       total_cost_usd: float = 0.0, total_prompt_tokens: int = 0,
                       total_completion_tokens: int = 0):
        """Log an experiment (one evaluation run)."""
        self.db.execute("""
            INSERT OR REPLACE INTO experiments
            (run_id, timestamp, model, cheatsheet_bytes, total_problems,
             accuracy, true_accuracy, false_accuracy, unparsed,
             total_cost_usd, total_prompt_tokens, total_completion_tokens, eval_seconds)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (run_id, time.time(), model, cheatsheet_bytes, total_problems,
              accuracy, true_accuracy, false_accuracy, unparsed,
              total_cost_usd, total_prompt_tokens, total_completion_tokens, eval_seconds))
        self.db.commit()

    def log_llm_call(self, run_id: str, problem_id: str, equation1: str,
                     equation2: str, model: str,
                     prompt_tokens: int, completion_tokens: int,
                     cost_usd: float, duration_secs: float,
                     gold_answer: bool, predicted_answer: bool | None,
                     correct: bool, response: str):
        """Log a single LLM call with full response and equation data."""
        self.db.execute("""
            INSERT INTO llm_calls
            (run_id, timestamp, problem_id, equation1, equation2, model,
             prompt_tokens, completion_tokens, cost_usd, duration_secs,
             gold_answer, predicted_answer, correct, response)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (run_id, time.time(), problem_id, equation1, equation2, model,
              prompt_tokens, completion_tokens, cost_usd, duration_secs,
              int(gold_answer),
              int(predicted_answer) if predicted_answer is not None else None,
              int(correct),
              response))
        self.db.commit()

    def update_experiment_status(self, run_id: str, status: str, description: str = ""):
        """Update experiment status after keep/discard decision."""
        self.db.execute("""
            UPDATE experiments SET status = ?, description = ? WHERE run_id = ?
        """, (status, description, run_id))
        self.db.commit()

    def close(self):
        self.db.close()
