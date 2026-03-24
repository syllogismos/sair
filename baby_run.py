"""Baby GEPA run — same models and settings as run_gepa.py, fewer problems and smaller budget."""
import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, "src")

import dspy
from data import load_problems, load_reference_solutions, train_val_split
from metric import metric, set_reference_solutions
from observer import GEPAObserver
from solver import SolverV1

parser = argparse.ArgumentParser(description="Baby GEPA run")
parser.add_argument("--initial-prompt", default=None, help="Path to text file with initial instruction")
parser.add_argument("--resume", default=None, help="Run ID to resume")
args = parser.parse_args()

# Load .env file
env_path = Path(".env")
if env_path.exists():
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, val = line.split("=", 1)
            os.environ.setdefault(key.strip(), val.strip())

project = os.environ.get("GOOGLE_CLOUD_PROJECT", "")
if project:
    os.environ.setdefault("VERTEXAI_PROJECT", project)
os.environ.setdefault("VERTEXAI_LOCATION", os.environ.get("GOOGLE_CLOUD_REGION", "global"))

# Load a small slice of real data
print("Loading problems...")
normal = load_problems("normal")
examples = normal[:10] + normal[-10:]
train, val = train_val_split(examples, val_ratio=0.3, seed=42)
print(f"Data: {len(examples)} total, {len(train)} train, {len(val)} val")

# Load reference solutions (same as real run)
print("Loading reference solutions...")
refs = load_reference_solutions()
set_reference_solutions(refs)
print(f"  {len(refs)} reference solutions loaded")

# LMs — same as run_gepa.py defaults
student_lm = dspy.LM("vertex_ai/gemini-2.5-flash-lite", temperature=0.0, max_tokens=12000, num_retries=8)
reflection_lm = dspy.LM("vertex_ai/gemini-3.1-pro-preview", temperature=1.0, num_retries=8)

# Observer
observer = GEPAObserver(
    db_path="gepa_observations.db",
    run_name="baby_v1_seed42",
    solver="v1",
    auto="baby",
    student_model="vertex_ai/gemini-2.5-flash-lite",
    reflection_model="vertex_ai/gemini-3.1-pro-preview",
)
print(f"Run ID: {observer.run_id}")

if args.resume:
    observer.run_id = args.resume
    observer.db.execute(
        "UPDATE runs SET status = 'running', finished_at = NULL WHERE run_id = ?",
        (args.resume,),
    )
    print(f"Resuming run: {args.resume}")

try:
    observer.store_dataset_sizes(len(train), len(val))
    observer.install_gepa_hooks()
    tracked_metric = observer.wrap_metric(metric)
    dspy.configure(lm=student_lm, callbacks=[observer], num_threads=4)

    solver = SolverV1()
    if args.initial_prompt:
        prompt_text = Path(args.initial_prompt).read_text()
        for name, pred in solver.named_predictors():
            pred.signature = pred.signature.with_instructions(prompt_text)
        print(f"Initial prompt: {len(prompt_text)} bytes from {args.initial_prompt}")
    observer.store_seed_instruction(solver)

    optimizer = dspy.GEPA(
        metric=tracked_metric,
        reflection_lm=reflection_lm,
        reflection_minibatch_size=10,
        max_metric_calls=60,
        track_stats=True,
        log_dir=f"gepa_logs/{args.resume or observer.run_id}",
        seed=42,
        failure_score=0.0,
    )

    print("\nStarting baby GEPA run...")
    print(f"Student: vertex_ai/gemini-2.5-flash-lite")
    print(f"Reflection: vertex_ai/gemini-3.1-pro-preview")
    print(f"Minibatch: 10, Budget: 60 metric calls")
    print()

    with dspy.track_usage() as usage:
        optimized = optimizer.compile(solver, trainset=train, valset=val)
    observer.dump_gepa_results(optimized)
    observer.finish("completed")
except KeyboardInterrupt:
    observer.finish("cancelled")
    print("\nCancelled by user.")
    sys.exit(0)
except Exception as e:
    observer.finish("failed")
    print(f"Failed: {e}")
    raise

print("\n=== Done ===")
for model_name, totals in usage.get_total_tokens().items():
    print(f"  {model_name}: {totals}")

print(f"\nObserver summary:")
for role, stats in observer.get_summary().items():
    print(f"  {role}: {stats}")

if hasattr(optimized, "detailed_results") and optimized.detailed_results:
    dr = optimized.detailed_results
    print(f"\nCandidates: {len(dr.val_aggregate_scores)}")
    print(f"Best score: {dr.val_aggregate_scores[dr.best_idx]:.2%}")
    for name, pred in optimized.named_predictors():
        print(f"\n[{name}] instruction:")
        print(pred.signature.instructions[:200])
