"""Baby GEPA run — same setup as run_gepa.py but with fewer problems and smaller budget."""
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

# Setup Vertex AI (same as run_gepa.py)
os.environ.setdefault("VERTEXAI_PROJECT", "YOUR_GCP_PROJECT")
os.environ.setdefault("VERTEXAI_LOCATION", "global")

# Load a small slice of real data
print("Loading problems...")
normal = load_problems("normal")
# Take 20 problems (balanced) from the real dataset
examples = normal[:10] + normal[-10:]
train, val = train_val_split(examples, val_ratio=0.3, seed=42)
print(f"Data: {len(examples)} total, {len(train)} train, {len(val)} val")

# Load reference solutions (same as real run)
print("Loading reference solutions...")
refs = load_reference_solutions()
set_reference_solutions(refs)
print(f"  {len(refs)} reference solutions loaded")

# LMs (same as run_gepa.py defaults)
student_lm = dspy.LM("vertex_ai/gemini-3.1-flash-lite-preview", temperature=0.0, num_retries=3)
reflection_lm = dspy.LM("vertex_ai/gemini-3.1-pro-preview", temperature=1.0, num_retries=3)

# Observer
observer = GEPAObserver(
    db_path="gepa_observations.db",
    run_name="baby_v1_seed42",
    solver="v1",
    auto="baby",
    student_model="vertex_ai/gemini-3.1-flash-lite-preview",
    reflection_model="vertex_ai/gemini-3.1-pro-preview",
)
print(f"Run ID: {observer.run_id}")

observer.install_gepa_hooks()
tracked_metric = observer.wrap_metric(metric)
dspy.configure(lm=student_lm, callbacks=[observer])

solver = SolverV1()

optimizer = dspy.GEPA(
    metric=tracked_metric,
    reflection_lm=reflection_lm,
    max_metric_calls=60,
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
