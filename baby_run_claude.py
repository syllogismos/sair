"""Baby GEPA run using Claude models via Claude Code SDK.
Student: Haiku 4.5, Reflection: Sonnet 4.6. No API key needed.
"""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, "src")

import dspy
from cc_adapter import ClaudeCodeLM
from data import load_problems, load_reference_solutions, train_val_split
from metric import metric, set_reference_solutions
from observer import GEPAObserver
from solver import SolverV1

# Load a small slice of real data
print("Loading problems...")
normal = load_problems("normal")
examples = normal[:10] + normal[-10:]
train, val = train_val_split(examples, val_ratio=0.3, seed=42)
print(f"Data: {len(examples)} total, {len(train)} train, {len(val)} val")

# Load reference solutions
print("Loading reference solutions...")
refs = load_reference_solutions()
set_reference_solutions(refs)
print(f"  {len(refs)} reference solutions loaded")

# LMs — both via Claude Code SDK (subscription auth, no API key)
student_lm = ClaudeCodeLM(model="claude-haiku-4-5-20251001")
reflection_lm = ClaudeCodeLM(model="claude-sonnet-4-6")

# Observer
observer = GEPAObserver(
    db_path="gepa_observations.db",
    run_name="baby_claude_seed42",
    solver="v1",
    auto="baby",
    student_model="claude-haiku-4-5-20251001",
    reflection_model="claude-sonnet-4-6",
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

print("\nStarting baby GEPA run (Claude: Haiku student, Sonnet reflection)...")
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
