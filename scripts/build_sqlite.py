"""Load all competition data into a single SQLite database."""
import json
import csv
import sqlite3
import os

DB_PATH = "/Volumes/ssd/c/sair/dashboard/data.db"
DATA = "/Volumes/ssd/c/sair/data"

if os.path.exists(DB_PATH):
    os.remove(DB_PATH)

conn = sqlite3.connect(DB_PATH)
c = conn.cursor()

# 1. Runs (60K with full responses)
print("Loading runs...")
c.execute("""
    CREATE TABLE runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        benchmark_id TEXT,
        problem_id TEXT,
        model_id TEXT,
        repeat_id INTEGER,
        equation1 TEXT,
        equation2 TEXT,
        answer BOOLEAN,
        correct BOOLEAN,
        response TEXT,
        judge_reason TEXT,
        elapsed_seconds REAL,
        cost_usd REAL,
        prompt_tokens INTEGER,
        completion_tokens INTEGER
    )
""")

batch = []
count = 0
with open(f"{DATA}/benchmark_runs.jsonl") as f:
    for line in f:
        if not line.strip():
            continue
        row = json.loads(line)
        batch.append((
            row.get("benchmark_id"),
            row.get("problem_id"),
            row.get("model_id"),
            row.get("repeat_id"),
            row.get("equation1"),
            row.get("equation2"),
            row.get("answer"),
            row.get("correct"),
            row.get("response"),
            row.get("judge_reason"),
            row.get("elapsed_seconds"),
            row.get("cost_usd"),
            row.get("prompt_tokens"),
            row.get("completion_tokens"),
        ))
        if len(batch) >= 5000:
            c.executemany(
                "INSERT INTO runs (benchmark_id, problem_id, model_id, repeat_id, equation1, equation2, answer, correct, response, judge_reason, elapsed_seconds, cost_usd, prompt_tokens, completion_tokens) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                batch,
            )
            count += len(batch)
            batch = []
            print(f"  {count} rows...")

if batch:
    c.executemany(
        "INSERT INTO runs (benchmark_id, problem_id, model_id, repeat_id, equation1, equation2, answer, correct, response, judge_reason, elapsed_seconds, cost_usd, prompt_tokens, completion_tokens) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        batch,
    )
    count += len(batch)

print(f"  Total: {count} runs")

c.execute("CREATE INDEX idx_runs_model ON runs(model_id)")
c.execute("CREATE INDEX idx_runs_benchmark ON runs(benchmark_id)")
c.execute("CREATE INDEX idx_runs_problem ON runs(problem_id)")
c.execute("CREATE INDEX idx_runs_correct ON runs(correct)")
c.execute("CREATE INDEX idx_runs_model_benchmark ON runs(model_id, benchmark_id)")

# 2. Leaderboard
print("Loading leaderboard...")
c.execute("""
    CREATE TABLE leaderboard (
        benchmark_id TEXT,
        model_id TEXT,
        accuracy REAL,
        f1_score REAL,
        parse_success_rate REAL,
        avg_cost_usd REAL,
        avg_time_secs REAL,
        tp INTEGER,
        fp INTEGER,
        fn INTEGER,
        tn INTEGER,
        unparsed INTEGER,
        repeat_consistency REAL,
        run_count INTEGER,
        problem_count INTEGER,
        repeat_count INTEGER,
        PRIMARY KEY (benchmark_id, model_id)
    )
""")
with open(f"{DATA}/benchmark_leaderboard.jsonl") as f:
    for line in f:
        if not line.strip():
            continue
        row = json.loads(line)
        c.execute(
            "INSERT INTO leaderboard VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (row["benchmark_id"], row["model_id"], row["accuracy"], row["f1_score"],
             row["parse_success_rate"], row["avg_cost_usd"], row["avg_time_secs"],
             row["tp"], row["fp"], row["fn"], row["tn"], row["unparsed"],
             row["repeat_consistency"], row["run_count"], row["problem_count"], row["repeat_count"]),
        )
print(f"  {c.rowcount} leaderboard entries (last batch)")

# 3. Models
print("Loading models...")
c.execute("""
    CREATE TABLE models (
        model_id TEXT PRIMARY KEY,
        model_id_raw TEXT,
        display_name TEXT,
        provider TEXT,
        family TEXT,
        track TEXT
    )
""")
with open(f"{DATA}/benchmark_models.csv") as f:
    reader = csv.DictReader(f)
    for row in reader:
        c.execute(
            "INSERT INTO models VALUES (?,?,?,?,?,?)",
            (row["model_id"], row["model_id_raw"], row["display_name"],
             row["provider"], row["family"], row["track"]),
        )

# 4. Problems
print("Loading problems...")
c.execute("""
    CREATE TABLE problems (
        id TEXT PRIMARY KEY,
        idx INTEGER,
        difficulty TEXT,
        equation1 TEXT,
        equation2 TEXT,
        answer BOOLEAN
    )
""")
for subset in ["normal", "hard1", "hard2"]:
    with open(f"{DATA}/problems_{subset}.jsonl") as f:
        for line in f:
            if not line.strip():
                continue
            row = json.loads(line)
            c.execute(
                "INSERT OR IGNORE INTO problems VALUES (?,?,?,?,?,?)",
                (row["id"], row["index"], row["difficulty"], row["equation1"], row["equation2"], row["answer"]),
            )

# 5. Benchmarks
print("Loading benchmarks...")
c.execute("""
    CREATE TABLE benchmarks (
        benchmark_id TEXT PRIMARY KEY,
        problem_subset TEXT,
        problem_count INTEGER,
        model_count INTEGER,
        repeat_count INTEGER,
        reasoning_mode TEXT,
        temperature_mode TEXT,
        cheatsheet_mode TEXT
    )
""")
with open(f"{DATA}/benchmark_benchmarks.jsonl") as f:
    for line in f:
        if not line.strip():
            continue
        row = json.loads(line)
        c.execute(
            "INSERT INTO benchmarks VALUES (?,?,?,?,?,?,?,?)",
            (row["benchmark_id"], row["problem_subset"], row["problem_count"],
             row["model_count"], row["repeat_count"], row["reasoning_mode"],
             row["temperature_mode"], row["cheatsheet_mode"]),
        )

conn.commit()

# Print summary
for table in ["runs", "leaderboard", "models", "problems", "benchmarks"]:
    c.execute(f"SELECT COUNT(*) FROM {table}")
    print(f"{table}: {c.fetchone()[0]} rows")

db_size = os.path.getsize(DB_PATH)
print(f"\nDatabase size: {db_size / 1024 / 1024:.1f} MB")

conn.close()
