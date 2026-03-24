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
    """Configure Vertex AI project/region from .env or environment variables."""
    from pathlib import Path
    env_path = Path(__file__).parent.parent / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, val = line.split("=", 1)
                os.environ.setdefault(key.strip(), val.strip())
    project = os.environ.get("GOOGLE_CLOUD_PROJECT", "")
    region = os.environ.get("GOOGLE_CLOUD_REGION", "global")
    if project:
        os.environ.setdefault("VERTEXAI_PROJECT", project)
    os.environ.setdefault("VERTEXAI_LOCATION", region)


def make_student_lm(model: str = "vertex_ai/gemini-2.5-flash-lite") -> dspy.LM:
    return dspy.LM(
        model=model,
        temperature=0.0,
        max_tokens=20000,
        num_retries=8,
    )


def make_reflection_lm(model: str = "vertex_ai/gemini-3.1-pro-preview") -> dspy.LM:
    return dspy.LM(
        model=model,
        temperature=1.0,
        num_retries=8,
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
    parser.add_argument("--max-metric-calls", type=int, default=None, help="Override auto budget with exact metric call limit")
    parser.add_argument("--minibatch-size", type=int, default=10, help="Number of training examples per reflection minibatch")
    parser.add_argument("--cheatsheet", default=None, help="Path to cheatsheet text file")
    parser.add_argument("--student-model", default="vertex_ai/gemini-2.5-flash-lite")
    parser.add_argument("--reflection-model", default="vertex_ai/gemini-3.1-pro-preview")
    parser.add_argument("--use-cc", action="store_true", help="Use Claude Code SDK for reflection instead of Vertex AI")
    parser.add_argument("--log-dir", default=str(PROJECT_ROOT / "gepa_logs"))
    parser.add_argument("--db-path", default=str(PROJECT_ROOT / "gepa_observations.db"))
    parser.add_argument("--resume", default=None, help="Run ID to resume (reuses its log_dir for GEPA checkpoint)")
    parser.add_argument("--initial-prompt", default=None, help="Path to text file with initial instruction for the solver")
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

    if args.resume:
        # Reuse the old run_id so dashboard data stays in one place
        # GEPA resumes from checkpoint via the old log_dir
        observer.run_id = args.resume
        observer.db.execute(
            "UPDATE runs SET status = 'running', finished_at = NULL WHERE run_id = ?",
            (args.resume,),
        )
        print(f"Resuming run: {args.resume}")
    else:
        print(f"Run ID: {observer.run_id} ({run_name})")

    dspy.configure(lm=student_lm, callbacks=[observer], num_threads=4)
    observer.store_dataset_sizes(len(train), len(val))

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
    if args.initial_prompt:
        prompt_text = Path(args.initial_prompt).read_text()
        for name, pred in solver.named_predictors():
            pred.signature = pred.signature.with_instructions(prompt_text)
        print(f"Initial prompt: {len(prompt_text)} bytes from {args.initial_prompt}")
    print(f"Solver: {args.solver}")
    observer.store_seed_instruction(solver)

    # Run GEPA
    print(f"\nStarting GEPA optimization (auto={args.auto})...")
    print(f"Log dir: {args.log_dir}")
    print(f"Observations DB: {args.db_path}")
    print()

    gepa_kwargs = dict(
        metric=tracked_metric,
        reflection_lm=reflection_lm,
        reflection_minibatch_size=args.minibatch_size,
        track_stats=True,
        log_dir=str(Path(args.log_dir) / (args.resume or observer.run_id)),
        seed=args.seed,
        failure_score=0.0,
    )
    if args.max_metric_calls:
        gepa_kwargs["max_metric_calls"] = args.max_metric_calls
    else:
        gepa_kwargs["auto"] = args.auto

    optimizer = dspy.GEPA(**gepa_kwargs)

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
        raise

    # Print results
    print("\n=== Optimization Complete ===")
    print(f"\nToken usage:")
    for model_name, totals in usage.get_total_tokens().items():
        print(f"  {model_name}: {totals}")

    print(f"\nObserver summary:")
    for role, stats in observer.get_summary().items():
        print(f"  {role}: {stats}")

    # Save optimized program — in the run's log dir and at project root
    run_log_dir = Path(args.log_dir) / (args.resume or observer.run_id)
    run_output = run_log_dir / "optimized_solver.json"
    optimized.save(str(run_output))
    print(f"\nOptimized solver saved to: {run_output}")

    # Also save at project root for convenience (overwritten by each run)
    root_output = PROJECT_ROOT / "optimized_solver.json"
    optimized.save(str(root_output))

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
