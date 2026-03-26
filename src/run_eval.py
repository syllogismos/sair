"""Run standalone evaluation of a solver on benchmark problem subsets.

Usage:
    # Evaluate an optimized solver JSON on the benchmark 400 problems
    python src/run_eval.py --solver-path optimized_solver.json --subset all_400

    # Evaluate a raw prompt text file
    python src/run_eval.py --solver-path my_prompt.txt --subset normal_200

    # Reuse GEPA val results to avoid re-evaluating those problems
    python src/run_eval.py --solver-path optimized_solver.json --gepa-run-id abc123
"""
import argparse
import json
import os
import sqlite3
import sys
import time
import uuid
from pathlib import Path

import dspy

from data import load_problems, train_val_split
from observer import GEPAObserver
from solver import SolverV1, SolverV2, SolverV3

PROJECT_ROOT = Path(__file__).parent.parent
DATA_DIR = PROJECT_ROOT / "data"


def setup_vertex_ai():
    env_path = PROJECT_ROOT / ".env"
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


def load_benchmark_problems(subset: str) -> list[dict]:
    """Load problems for the given subset.

    Returns list of dicts with: problem_id, equation1, equation2, answer
    """
    normal = load_problems("normal")
    hard1 = load_problems("hard1")
    hard2 = load_problems("hard2")

    if subset == "normal_200":
        # Benchmark uses normal_0001 through normal_0200
        return [
            {"problem_id": ex.id, "equation1": ex.equation1, "equation2": ex.equation2, "answer": ex.answer}
            for ex in normal[:200]
        ]
    elif subset == "hard_200":
        # Benchmark hard_0001-0200 maps to our hard1+hard2 by equation content
        # Build mapping from benchmark DB
        db_path = PROJECT_ROOT / "dashboard" / "data.db"
        if not db_path.exists():
            raise FileNotFoundError(f"Need {db_path} for hard problem ID mapping")

        # Build equation -> local problem lookup
        eq_to_local = {}
        for ex in hard1 + hard2:
            eq_to_local[(ex.equation1, ex.equation2)] = ex

        db = sqlite3.connect(str(db_path))
        db.row_factory = sqlite3.Row
        rows = db.execute("""
            SELECT DISTINCT problem_id, equation1, equation2, answer
            FROM runs WHERE benchmark_id = 'hard_200_common_25_low_reason'
            ORDER BY problem_id
        """).fetchall()
        db.close()

        problems = []
        for r in rows:
            local = eq_to_local.get((r["equation1"], r["equation2"]))
            if not local:
                print(f"WARNING: No local match for benchmark {r['problem_id']}")
                continue
            problems.append({
                "problem_id": local.id,
                "equation1": r["equation1"],
                "equation2": r["equation2"],
                "answer": bool(r["answer"]),
            })
        return problems

    elif subset == "all_400":
        return load_benchmark_problems("normal_200") + load_benchmark_problems("hard_200")

    elif subset == "all_1269":
        return [
            {"problem_id": ex.id, "equation1": ex.equation1, "equation2": ex.equation2, "answer": ex.answer}
            for ex in normal + hard1 + hard2
        ]
    else:
        raise ValueError(f"Unknown subset: {subset}")


def load_gepa_val_results(db_path: str, gepa_run_id: str, seed: int) -> dict[str, dict]:
    """Load the best candidate's val set results from a GEPA run.

    Returns dict mapping problem_id -> {score, expected, predicted}.
    """
    db = sqlite3.connect(db_path)
    db.row_factory = sqlite3.Row

    # Get the best candidate index
    row = db.execute("""
        SELECT candidate_idx, val_score FROM gepa_candidates
        WHERE run_id = ? ORDER BY val_score DESC LIMIT 1
    """, (gepa_run_id,)).fetchone()
    if not row:
        print(f"  No candidates found for GEPA run {gepa_run_id}")
        db.close()
        return {}

    best_idx = row["candidate_idx"]
    best_score = row["val_score"]
    print(f"  Best candidate: idx={best_idx}, val_score={best_score:.2%}")

    # Get per-val-instance scores for the best candidate
    scores = db.execute("""
        SELECT val_idx, score FROM gepa_candidate_scores
        WHERE run_id = ? AND candidate_idx = ?
        ORDER BY val_idx
    """, (gepa_run_id, best_idx)).fetchall()
    db.close()

    if not scores:
        print(f"  No per-instance scores found for candidate {best_idx}")
        return {}

    # Reconstruct the val set to map val_idx -> problem_id
    normal = load_problems("normal")
    hard1 = load_problems("hard1")
    hard2 = load_problems("hard2")
    all_problems = normal + hard1 + hard2
    _, val = train_val_split(all_problems, val_ratio=0.2, seed=seed)

    results = {}
    for s in scores:
        vi = s["val_idx"]
        if vi < len(val):
            ex = val[vi]
            score = s["score"]
            expected = bool(ex.answer)
            # Infer prediction from score + expected
            predicted = expected if score == 1.0 else (not expected)
            results[ex.id] = {
                "score": score,
                "expected": expected,
                "predicted": predicted,
                "correct": score == 1.0,
            }

    print(f"  Loaded {len(results)} val results to reuse ({sum(1 for r in results.values() if r['correct'])}/{len(results)} correct)")
    return results


def make_solver(version: str, cheatsheet: str = "") -> dspy.Module:
    if version == "v1":
        return SolverV1()
    elif version == "v2":
        return SolverV2(cheatsheet=cheatsheet)
    elif version == "v3":
        return SolverV3(cheatsheet=cheatsheet)
    else:
        raise ValueError(f"Unknown solver version: {version}")


def parse_verdict(pred) -> bool | None:
    """Parse a verdict from a DSPy prediction. Returns None if unparsable."""
    verdict = getattr(pred, "verdict", None)
    if verdict is None:
        return None
    if isinstance(verdict, bool):
        return verdict
    if isinstance(verdict, str):
        v = verdict.strip().lower()
        if v in ("true", "1", "yes"):
            return True
        elif v in ("false", "0", "no"):
            return False
    return None


def estimate_cost(model: str, prompt_tokens: int, completion_tokens: int) -> float:
    rates = {
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
    return (prompt_tokens * 1.0 + completion_tokens * 3.0) / 1_000_000


def run_evaluation(
    solver_path: str,
    solver_version: str = "v1",
    student_model: str = "vertex_ai/gemini-2.5-flash-lite",
    subset: str = "all_400",
    gepa_run_id: str | None = None,
    display_name: str | None = None,
    cheatsheet: str | None = None,
    db_path: str = "gepa_observations.db",
    num_threads: int = 4,
    seed: int = 42,
    dry_run: bool = False,
    temperature: float = 0.0,
    no_cot: bool = False,
    repeat: int = 1,
    reasoning_effort: str | None = None,
    thinking_budget: int | None = None,
):
    """Run evaluation and record results. Can be called from CLI or programmatically."""

    setup_vertex_ai()

    # Generate eval ID early (needed by observer)
    eval_id = uuid.uuid4().hex[:12]

    # Load problems
    print(f"Loading problems for subset: {subset}")
    problems = load_benchmark_problems(subset)
    print(f"  {len(problems)} problems loaded")

    # Load solver
    if no_cot:
        # No chain-of-thought — use dspy.Predict directly
        class NoCotSolver(dspy.Module):
            def __init__(self):
                self.solve = dspy.Predict("equation1: str, equation2: str -> verdict: bool")
            def forward(self, equation1: str, equation2: str):
                return self.solve(equation1=equation1, equation2=equation2)
        solver = NoCotSolver()
    else:
        solver = make_solver(solver_version, cheatsheet=cheatsheet or "")

    solver_path_obj = Path(solver_path)
    if solver_path_obj.suffix == ".json":
        solver.load(solver_path)
        print(f"Loaded optimized solver from: {solver_path}")
    elif solver_path_obj.suffix == ".txt":
        prompt_text = solver_path_obj.read_text()
        for name, pred in solver.named_predictors():
            pred.signature = pred.signature.with_instructions(prompt_text)
        print(f"Loaded raw prompt ({len(prompt_text)} bytes) from: {solver_path}")
    else:
        raise ValueError(f"Unsupported solver file type: {solver_path_obj.suffix} (use .json or .txt)")

    # Setup LM and observer (skip in dry-run mode)
    student_lm = None
    observer = None
    if not dry_run:
        lm_kwargs = dict(model=student_model, temperature=temperature, max_tokens=20000, num_retries=8)
        # Reasoning/thinking params — litellm handles provider mapping
        if reasoning_effort:
            lm_kwargs["reasoning_effort"] = reasoning_effort
        if thinking_budget is not None:
            lm_kwargs["thinking"] = {"type": "enabled", "budget_tokens": thinking_budget}
        student_lm = dspy.LM(**lm_kwargs)

        # Observer logs all LLM calls with full prompts/responses
        observer = GEPAObserver(
            db_path=str(PROJECT_ROOT / db_path),
            run_name=f"eval_{eval_id}",
            solver=solver_version,
            auto="eval",
            student_model=student_model,
        )
        # Use eval_id as the run_id so llm_calls link to our eval
        old_run_id = observer.run_id
        observer.run_id = eval_id
        # Move the runs row to use eval_id, then delete it (we use eval_runs instead)
        observer.db.execute("DELETE FROM runs WHERE run_id = ?", (old_run_id,))
        observer.db.execute("DELETE FROM runs WHERE run_id = ?", (eval_id,))

        dspy.configure(lm=student_lm, callbacks=[observer], num_threads=num_threads)

    # Load GEPA val results to reuse (if provided)
    reuse_results = {}
    if gepa_run_id:
        print(f"Loading GEPA val results from run {gepa_run_id}...")
        reuse_results = load_gepa_val_results(str(PROJECT_ROOT / db_path), gepa_run_id, seed)

    # Setup DB
    db = sqlite3.connect(str(PROJECT_ROOT / db_path), check_same_thread=False, isolation_level=None)

    # Auto-generate display name
    if not display_name:
        model_short = student_model.split("/")[-1]
        source = f"gepa:{gepa_run_id[:8]}" if gepa_run_id else "manual"
        reasoning = "no-cot" if no_cot else "cot"
        temp_str = f"t={temperature}" if temperature != 0.0 else "t=0"
        repeat_str = f" x{repeat}" if repeat > 1 else ""
        thinking_str = ""
        if thinking_budget is not None:
            thinking_str = f", think={thinking_budget}"
        elif reasoning_effort:
            thinking_str = f", {reasoning_effort}"
        display_name = f"{model_short} / {solver_version} ({source}, {reasoning}, {temp_str}{thinking_str}{repeat_str})"

    # Expand problems for repeats
    if repeat > 1:
        expanded_problems = []
        for r in range(repeat):
            for p in problems:
                expanded_problems.append({**p, "_repeat_id": r + 1})
        total_runs = len(expanded_problems)
    else:
        expanded_problems = [{**p, "_repeat_id": 1} for p in problems]
        total_runs = len(problems)

    db.execute("""
        INSERT INTO eval_runs (eval_id, gepa_run_id, solver_path, solver_version, student_model,
                               benchmark_subset, problem_count, started_at, status, display_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?)
    """, (eval_id, gepa_run_id, solver_path, solver_version, student_model,
          subset, len(problems), time.time(), display_name))

    print(f"\nEval ID: {eval_id}")
    print(f"Display name: {display_name}")
    print(f"Student: {student_model} (temperature={temperature})")
    print(f"Reasoning: {'no CoT (Predict)' if no_cot else 'CoT (ChainOfThought)'}")
    print(f"Subset: {subset} ({len(problems)} problems x {repeat} repeat{'s' if repeat > 1 else ''} = {total_runs} runs)")
    if reuse_results:
        print(f"GEPA cache: {len(reuse_results)} results to reuse")
    if dry_run:
        print(f"DRY RUN: predicting FALSE for non-cached problems (no LLM calls)")
    print()

    # Run evaluation
    tp = fp = fn = tn = unparsed = 0
    total_cost = 0.0
    total_time = 0.0
    completed = 0

    try:
        for i, problem in enumerate(expanded_problems):
            pid = problem["problem_id"]
            repeat_id = problem["_repeat_id"]
            expected = bool(problem["answer"])

            # Check if we can reuse GEPA result (only on first repeat)
            cached = reuse_results.get(pid) if repeat_id == 1 else None
            if cached is not None:
                predicted = cached["predicted"]
                correct = cached["correct"]
                db.execute("""
                    INSERT INTO eval_results (eval_id, problem_id, equation1, equation2,
                                              expected, predicted, correct, response,
                                              elapsed_seconds, cost_usd, prompt_tokens, completion_tokens)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (eval_id, pid, problem["equation1"], problem["equation2"],
                      expected, predicted, correct, "[reused from GEPA val]",
                      0.0, 0.0, 0, 0))

                if correct:
                    if expected:
                        tp += 1
                    else:
                        tn += 1
                else:
                    if expected:
                        fn += 1
                    else:
                        fp += 1

                completed += 1
                status = "correct" if correct else "WRONG"
                print(f"  [{completed}/{total_runs}] {pid}: {status} (cached)")
                continue

            # Dry-run mode: predict FALSE without calling LLM
            if dry_run:
                predicted = False
                correct = predicted == expected
                elapsed = 0.0
                response_text = "[dry-run: predicted FALSE]"
                prompt_tokens = completion_tokens = 0
                cost = 0.0
                error_text = None
            else:
                # Run solver
                start_time = time.time()
                response_text = ""
                prompt_tokens = completion_tokens = 0
                cost = 0.0
                error_text = None
                predicted = None
                correct = False

                try:
                    pred = solver(equation1=problem["equation1"], equation2=problem["equation2"])
                    elapsed = time.time() - start_time
                    response_text = str(getattr(pred, "reasoning", "")) + "\n" + str(getattr(pred, "verdict", ""))

                    # Get token usage from LM history
                    if student_lm and student_lm.history:
                        last = student_lm.history[-1]
                        resp = last.get("response")
                        if resp:
                            usage = getattr(resp, "usage", None)
                            if usage:
                                prompt_tokens = getattr(usage, "prompt_tokens", 0) or 0
                                completion_tokens = getattr(usage, "completion_tokens", 0) or 0
                    cost = estimate_cost(student_model, prompt_tokens, completion_tokens)

                    predicted = parse_verdict(pred)
                    if predicted is None:
                        unparsed += 1
                        error_text = f"Unparsable verdict: {getattr(pred, 'verdict', None)}"
                except Exception as e:
                    elapsed = time.time() - start_time
                    error_text = str(e)[:500]
                    unparsed += 1

            # Update confusion matrix (for both dry-run and real)
            if predicted is not None and error_text is None:
                correct = predicted == expected
                if correct:
                    if expected:
                        tp += 1
                    else:
                        tn += 1
                else:
                    if expected:
                        fn += 1
                    else:
                        fp += 1

            total_cost += cost
            total_time += elapsed

            db.execute("""
                INSERT INTO eval_results (eval_id, problem_id, equation1, equation2,
                                          expected, predicted, correct, response,
                                          elapsed_seconds, cost_usd, prompt_tokens,
                                          completion_tokens, error)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (eval_id, pid, problem["equation1"], problem["equation2"],
                  expected, predicted, correct, response_text,
                  elapsed, cost, prompt_tokens, completion_tokens, error_text))

            completed += 1
            label = "correct" if correct else ("WRONG" if predicted is not None else "ERROR")
            if dry_run and not cached:
                label += " (dry-run)"
            acc_so_far = (tp + tn) / completed if completed > 0 else 0
            rep_label = f" r{repeat_id}" if repeat > 1 else ""
            print(f"  [{completed}/{total_runs}] {pid}{rep_label}: pred={predicted} exp={expected} -> {label}  (acc={acc_so_far:.1%}, cost=${total_cost:.4f})")

    except KeyboardInterrupt:
        print(f"\nCancelled after {completed}/{total_runs} runs.")

    # Compute aggregates
    total_evaluated = tp + fp + fn + tn + unparsed
    accuracy = (tp + tn) / total_evaluated if total_evaluated > 0 else 0
    f1 = (2 * tp) / (2 * tp + fp + fn) if (2 * tp + fp + fn) > 0 else 0
    parse_rate = (total_evaluated - unparsed) / total_evaluated if total_evaluated > 0 else 0
    llm_calls = max(1, completed)
    if reuse_results:
        llm_calls = max(1, completed - sum(1 for p in expanded_problems[:completed] if reuse_results.get(p["problem_id"]) and p["_repeat_id"] == 1))
    avg_cost = total_cost / llm_calls
    avg_time = total_time / llm_calls

    status = "completed" if completed == total_runs else "cancelled"

    db.execute("""
        UPDATE eval_runs SET
            finished_at = ?, status = ?, accuracy = ?, f1_score = ?,
            tp = ?, fp = ?, fn = ?, tn = ?, unparsed = ?,
            parse_success_rate = ?, avg_cost_usd = ?, avg_time_secs = ?,
            total_cost_usd = ?
        WHERE eval_id = ?
    """, (time.time(), status, accuracy, f1, tp, fp, fn, tn, unparsed,
          parse_rate, avg_cost, avg_time, total_cost, eval_id))
    db.close()

    # Print summary
    print(f"\n{'='*60}")
    print(f"Evaluation Complete: {eval_id}")
    print(f"{'='*60}")
    print(f"  Status:     {status}")
    print(f"  Runs:       {completed}/{total_runs} ({len(problems)} problems x {repeat})")
    print(f"  Accuracy:   {accuracy:.2%}")
    print(f"  F1 Score:   {f1:.4f}")
    print(f"  TP={tp}  FP={fp}  FN={fn}  TN={tn}  Unparsed={unparsed}")
    print(f"  Parse Rate: {parse_rate:.2%}")
    print(f"  Total Cost: ${total_cost:.4f}")
    print(f"  Avg Cost:   ${avg_cost:.6f}/problem")
    print(f"  Avg Time:   {avg_time:.1f}s/problem")
    if gepa_run_id and reuse_results:
        reused = sum(1 for p in problems if reuse_results.get(p["problem_id"]))
        print(f"  Reused:     {reused} problems from GEPA val cache")
    print()

    return eval_id


def main():
    parser = argparse.ArgumentParser(description="Run standalone evaluation")
    parser.add_argument("--solver-path", required=True, help="Path to optimized_solver.json or raw prompt .txt")
    parser.add_argument("--solver-version", default="v1", choices=["v1", "v2", "v3"])
    parser.add_argument("--student-model", default="vertex_ai/gemini-2.5-flash-lite")
    parser.add_argument("--subset", default="all_400", choices=["normal_200", "hard_200", "all_400", "all_1269"])
    parser.add_argument("--gepa-run-id", default=None, help="GEPA run ID to reuse val results from")
    parser.add_argument("--display-name", default=None, help="Custom display name for leaderboard")
    parser.add_argument("--cheatsheet", default=None, help="Path to cheatsheet file (for v2/v3)")
    parser.add_argument("--db-path", default="gepa_observations.db")
    parser.add_argument("--num-threads", type=int, default=4)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--dry-run", action="store_true", help="Predict FALSE for non-cached problems instead of calling LLM")
    parser.add_argument("--temperature", type=float, default=0.0, help="LM temperature (0=deterministic, default=0.0)")
    parser.add_argument("--no-cot", action="store_true", help="No chain-of-thought — use dspy.Predict instead of ChainOfThought")
    parser.add_argument("--repeat", type=int, default=1, help="Run each problem N times (for consistency measurement)")
    parser.add_argument("--reasoning-effort", default=None, choices=["low", "medium", "high"],
                        help="Reasoning effort (litellm standard — maps to provider-specific params)")
    parser.add_argument("--thinking-budget", type=int, default=None,
                        help="Thinking token budget (Gemini: 512-24576 for Flash Lite)")
    args = parser.parse_args()

    cheatsheet = ""
    if args.cheatsheet:
        cheatsheet = Path(args.cheatsheet).read_text()
        print(f"Cheatsheet: {len(cheatsheet)} bytes from {args.cheatsheet}")

    run_evaluation(
        solver_path=args.solver_path,
        solver_version=args.solver_version,
        student_model=args.student_model,
        subset=args.subset,
        gepa_run_id=args.gepa_run_id,
        display_name=args.display_name,
        cheatsheet=cheatsheet or None,
        db_path=args.db_path,
        num_threads=args.num_threads,
        seed=args.seed,
        dry_run=args.dry_run,
        temperature=args.temperature,
        no_cot=args.no_cot,
        repeat=args.repeat,
        reasoning_effort=args.reasoning_effort,
        thinking_budget=args.thinking_budget,
    )


if __name__ == "__main__":
    main()
