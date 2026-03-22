"""Minimal GEPA run with 20 problems to test dashboard visualization."""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, "src")

import dspy
from data import train_val_split
from metric import metric, set_reference_solutions
from observer import GEPAObserver
from solver import SolverV1

# Setup Vertex AI
os.environ.setdefault("VERTEXAI_PROJECT", "YOUR_GCP_PROJECT")
os.environ.setdefault("VERTEXAI_LOCATION", "global")

# Load tiny dataset
examples = []
for path in [Path("data/problems_normal.jsonl")]:
    with open(path) as f:
        lines = f.readlines()
    # Take 5 TRUE + 5 FALSE from start, 5+5 from end
    for line in lines[:10] + lines[-10:]:
        row = json.loads(line)
        ex = dspy.Example(
            id=row["id"],
            equation1=row["equation1"],
            equation2=row["equation2"],
            answer=row["answer"],
        ).with_inputs("equation1", "equation2")
        examples.append(ex)

train, val = train_val_split(examples, val_ratio=0.3, seed=42)
print(f"Data: {len(examples)} total, {len(train)} train, {len(val)} val")

# LMs
student_lm = dspy.LM("vertex_ai/gemini-2.5-flash-lite", temperature=0.0, max_tokens=4096, num_retries=3)
reflection_lm = dspy.LM("vertex_ai/gemini-2.5-flash", temperature=1.0, max_tokens=16384, num_retries=3)

# Observer
observer = GEPAObserver(
    db_path="gepa_observations.db",
    run_name="baby_v1_light_seed42",
    solver="v1",
    auto="light",
    student_model="vertex_ai/gemini-2.5-flash-lite",
    reflection_model="vertex_ai/gemini-2.5-flash",
)
print(f"Run ID: {observer.run_id}")

observer.install_gepa_hooks()
tracked_metric = observer.wrap_metric(metric)
dspy.configure(lm=student_lm, callbacks=[observer])

# No reference solutions for baby run
set_reference_solutions({})

solver = SolverV1()

optimizer = dspy.GEPA(
    metric=tracked_metric,
    reflection_lm=reflection_lm,
    max_metric_calls=60,  # ~3 full evals worth, enough to see 2-3 candidates
    track_stats=True,
    log_dir=f"gepa_logs/{observer.run_id}",
    seed=42,
    failure_score=0.0,
)

print("\nStarting baby GEPA run...")
try:
    with dspy.track_usage() as usage:
        optimized = optimizer.compile(solver, trainset=train, valset=val)
    observer.dump_gepa_results(optimized)
    observer.finish("completed")
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
