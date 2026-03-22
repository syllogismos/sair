"""Run GEPA optimization for the equational theories competition.

Usage:
    python src/run_gepa.py --solver v1 --auto light
    python src/run_gepa.py --solver v2 --auto medium --cheatsheet cheatsheet.txt
"""
import argparse
import os
import sys
from pathlib import Path

import dspy

from data import load_problems, load_reference_solutions, train_val_split
from metric import metric, set_reference_solutions
from observer import GEPAObserver
from solver import SolverV1, SolverV2, SolverV3

PROJECT_ROOT = Path(__file__).parent.parent


def setup_vertex_ai():
    """Configure Vertex AI credentials and project."""
    project = os.environ.get("GOOGLE_CLOUD_PROJECT", "YOUR_GCP_PROJECT")
    region = os.environ.get("GOOGLE_CLOUD_REGION", "global")
    os.environ.setdefault("VERTEXAI_PROJECT", project)
    os.environ.setdefault("VERTEXAI_LOCATION", region)


def make_student_lm(model: str = "vertex_ai/gemini-2.5-flash-lite") -> dspy.LM:
    return dspy.LM(
        model=model,
        temperature=0.0,
        max_tokens=8192,
        num_retries=3,
    )


def make_reflection_lm(model: str = "vertex_ai/gemini-3.1-pro-preview") -> dspy.LM:
    return dspy.LM(
        model=model,
        temperature=1.0,
        max_tokens=8192,
        num_retries=3,
    )


def make_solver(version: str, cheatsheet: str = "") -> dspy.Module:
    if version == "v1":
        return SolverV1()
    elif version == "v2":
        return SolverV2(cheatsheet=cheatsheet)
    elif version == "v3":
        return SolverV3(cheatsheet=cheatsheet)
    else:
        raise ValueError(f"Unknown solver version: {version}")


def main():
    parser = argparse.ArgumentParser(description="Run GEPA optimization")
    parser.add_argument("--solver", default="v1", choices=["v1", "v2", "v3"])
    parser.add_argument("--auto", default="light", choices=["light", "medium", "heavy"])
    parser.add_argument("--cheatsheet", default=None, help="Path to cheatsheet text file")
    parser.add_argument("--student-model", default="vertex_ai/gemini-2.5-flash-lite")
    parser.add_argument("--reflection-model", default="vertex_ai/gemini-3.1-pro-preview")
    parser.add_argument("--use-cc", action="store_true", help="Use Claude Code SDK for reflection instead of Vertex AI")
    parser.add_argument("--log-dir", default=str(PROJECT_ROOT / "gepa_logs"))
    parser.add_argument("--db-path", default=str(PROJECT_ROOT / "gepa_observations.db"))
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    # Setup
    setup_vertex_ai()

    # Load data
    print("Loading problems...")
    normal = load_problems("normal")
    hard1 = load_problems("hard1")
    hard2 = load_problems("hard2")
    all_problems = normal + hard1 + hard2
    print(f"  Total: {len(all_problems)} problems ({len(normal)} normal, {len(hard1)} hard1, {len(hard2)} hard2)")

    train, val = train_val_split(all_problems, val_ratio=0.2, seed=args.seed)
    print(f"  Train: {len(train)}, Val: {len(val)}")

    # Load reference solutions from benchmark traces
    print("Loading reference solutions from benchmark traces...")
    refs = load_reference_solutions()
    set_reference_solutions(refs)
    print(f"  {len(refs)} reference solutions loaded")

    # Setup LLMs
    student_lm = make_student_lm(args.student_model)
    print(f"Student LM: {args.student_model}")

    if args.use_cc:
        from cc_adapter import ClaudeCodeLM
        reflection_lm = ClaudeCodeLM()
        print("Reflection LM: Claude Code SDK (Opus 4.6 via CC subscription)")
    else:
        reflection_lm = make_reflection_lm(args.reflection_model)
        print(f"Reflection LM: {args.reflection_model}")

    # Setup observability
    run_name = f"{args.solver}_{args.auto}_seed{args.seed}"
    reflection_model_name = "claude-opus-4-6" if args.use_cc else args.reflection_model
    observer = GEPAObserver(
        db_path=args.db_path,
        run_name=run_name,
        solver=args.solver,
        auto=args.auto,
        student_model=args.student_model,
        reflection_model=reflection_model_name,
    )
    print(f"Run ID: {observer.run_id} ({run_name})")
    dspy.configure(lm=student_lm, callbacks=[observer])

    # Install real-time GEPA iteration tracking (must be before compile)
    observer.install_gepa_hooks()

    # Wrap metric for real-time GEPA evaluation tracking
    tracked_metric = observer.wrap_metric(metric)

    # Load cheatsheet if provided
    cheatsheet = ""
    if args.cheatsheet:
        cheatsheet = Path(args.cheatsheet).read_text()
        print(f"Cheatsheet: {len(cheatsheet)} bytes from {args.cheatsheet}")

    # Create solver
    solver = make_solver(args.solver, cheatsheet=cheatsheet)
    print(f"Solver: {args.solver}")

    # Run GEPA
    print(f"\nStarting GEPA optimization (auto={args.auto})...")
    print(f"Log dir: {args.log_dir}")
    print(f"Observations DB: {args.db_path}")
    print()

    optimizer = dspy.GEPA(
        metric=tracked_metric,
        reflection_lm=reflection_lm,
        auto=args.auto,
        track_stats=True,
        log_dir=args.log_dir,
        seed=args.seed,
        failure_score=0.0,
    )

    try:
        with dspy.track_usage() as usage:
            optimized = optimizer.compile(solver, trainset=train, valset=val)
        observer.dump_gepa_results(optimized)
        observer.finish("completed")
    except Exception as e:
        observer.finish("failed")
        raise

    # Print results
    print("\n=== Optimization Complete ===")
    print(f"\nToken usage:")
    for model_name, totals in usage.get_total_tokens().items():
        print(f"  {model_name}: {totals}")

    print(f"\nObserver summary:")
    for role, stats in observer.get_summary().items():
        print(f"  {role}: {stats}")

    # Save optimized program
    output_path = PROJECT_ROOT / "optimized_solver.json"
    optimized.save(str(output_path))
    print(f"\nOptimized solver saved to: {output_path}")

    # Print optimized instructions
    print("\n=== Optimized Instructions ===")
    for name, pred in optimized.named_predictors():
        print(f"\n[{name}]:")
        print(pred.signature.instructions)

    # Print detailed results if available
    if hasattr(optimized, "detailed_results") and optimized.detailed_results:
        dr = optimized.detailed_results
        print(f"\n=== Detailed Results ===")
        print(f"Best candidate index: {dr.best_idx}")
        print(f"Best score: {dr.val_aggregate_scores[dr.best_idx]:.4f}")
        print(f"Total candidates explored: {len(dr.candidates)}")
        print(f"Total metric calls: {dr.total_metric_calls}")


if __name__ == "__main__":
    main()
