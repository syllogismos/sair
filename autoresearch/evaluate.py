"""Evaluation harness: send problems to LLM with cheatsheet, score accuracy.

DO NOT MODIFY THIS FILE. The agent modifies only cheatsheet.txt.

Usage:
    uv run evaluate.py                                    # 100 problems, vertex AI gemini 2.5 flash
    uv run evaluate.py --n 200                            # more problems
    uv run evaluate.py --model vertex_ai/gemini-2.5-flash # different model
    uv run evaluate.py --subset hard2                     # eval hard2 only
    uv run evaluate.py --full                             # all 1269 problems
    uv run evaluate.py --verbose                          # print each result
"""

import argparse
import asyncio
import os
import re
import time
import uuid
from dataclasses import dataclass

import litellm

from observe import AutoResearchObserver
from prepare import (
    SEED,
    Problem,
    get_cheatsheet_bytes,
    load_cheatsheet,
    load_problems,
    sample_eval_set,
)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DEFAULT_MODEL = "vertex_ai/gemini-2.5-flash"
DEFAULT_N = 100
DEFAULT_TEMPERATURE = 0.0
DEFAULT_MAX_TOKENS = 1024
MAX_CONCURRENT = 10
MAX_RETRIES = 3
RETRY_DELAY = 2.0  # seconds between retries

# Vertex AI project config
os.environ.setdefault("VERTEXAI_PROJECT", "YOUR_GCP_PROJECT")
os.environ.setdefault("VERTEXAI_LOCATION", "global")

# Suppress litellm's noisy logging
litellm.suppress_debug_info = True

# ---------------------------------------------------------------------------
# Prompt construction
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You are a mathematician specializing in universal algebra.
You are given two equations over magmas (sets with a single binary operation *).
Your task: determine whether Equation 1 implies Equation 2 over ALL magmas.
That is, does every magma satisfying Equation 1 necessarily satisfy Equation 2?

Answer with EXACTLY one of: TRUE or FALSE.
Your response MUST contain a line starting with "VERDICT:" followed by TRUE or FALSE.

{cheatsheet}"""

USER_PROMPT = """Equation 1: {equation1}
Equation 2: {equation2}

Does Equation 1 imply Equation 2 over all magmas? Analyze carefully, then give your verdict.

VERDICT:"""


def build_messages(
    equation1: str,
    equation2: str,
    cheatsheet: str,
) -> list[dict]:
    """Construct the LLM message list."""
    system = SYSTEM_PROMPT.format(cheatsheet=cheatsheet)
    user = USER_PROMPT.format(equation1=equation1, equation2=equation2)
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


# ---------------------------------------------------------------------------
# Verdict parsing
# ---------------------------------------------------------------------------


def parse_verdict(response: str) -> bool | None:
    """Extract TRUE/FALSE from LLM response.

    Returns True, False, or None (unparseable).
    """
    # Strategy 1: explicit VERDICT line
    match = re.search(r"VERDICT:\s*(TRUE|FALSE)", response, re.IGNORECASE)
    if match:
        return match.group(1).upper() == "TRUE"
    # Strategy 2: last isolated TRUE/FALSE
    matches = re.findall(r"\b(TRUE|FALSE)\b", response, re.IGNORECASE)
    if matches:
        return matches[-1].upper() == "TRUE"
    return None


# ---------------------------------------------------------------------------
# LLM calling
# ---------------------------------------------------------------------------


@dataclass
class LLMResponse:
    text: str
    elapsed_seconds: float
    prompt_tokens: int
    completion_tokens: int
    cost_usd: float


async def call_llm(
    messages: list[dict],
    model: str,
    temperature: float,
    max_tokens: int,
    semaphore: asyncio.Semaphore,
) -> LLMResponse:
    """Call LLM via litellm.acompletion with retry on rate limits."""
    async with semaphore:
        t0 = time.time()
        last_error = None
        for attempt in range(MAX_RETRIES):
            try:
                response = await litellm.acompletion(
                    model=model,
                    messages=messages,
                    temperature=temperature,
                    max_tokens=max_tokens,
                )
                elapsed = time.time() - t0
                text = response.choices[0].message.content or ""

                # Extract token usage and cost
                usage = response.usage
                prompt_tokens = usage.prompt_tokens if usage else 0
                completion_tokens = usage.completion_tokens if usage else 0

                # litellm tracks cost via response._hidden_params
                cost = 0.0
                try:
                    hidden = getattr(response, "_hidden_params", {}) or {}
                    cost = hidden.get("response_cost", 0.0) or 0.0
                except Exception:
                    pass

                return LLMResponse(
                    text=text,
                    elapsed_seconds=elapsed,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    cost_usd=cost,
                )
            except litellm.exceptions.RateLimitError as e:
                last_error = e
                if attempt < MAX_RETRIES - 1:
                    await asyncio.sleep(RETRY_DELAY * (attempt + 1))
        raise last_error


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------


@dataclass
class EvalResult:
    problem_id: str
    equation1: str
    equation2: str
    gold: bool
    predicted: bool | None
    correct: bool
    response: str
    elapsed_seconds: float
    prompt_tokens: int
    completion_tokens: int
    cost_usd: float


@dataclass
class EvalSummary:
    accuracy: float
    total_problems: int
    correct: int
    true_accuracy: float
    false_accuracy: float
    unparsed: int
    cheatsheet_bytes: int
    eval_seconds: float
    model: str
    total_cost_usd: float
    total_prompt_tokens: int
    total_completion_tokens: int


def compute_summary(
    results: list[EvalResult],
    cheatsheet_bytes: int,
    total_elapsed: float,
    model: str,
) -> EvalSummary:
    """Compute evaluation summary from individual results."""
    total = len(results)
    correct = sum(1 for r in results if r.correct)

    true_results = [r for r in results if r.gold]
    false_results = [r for r in results if not r.gold]
    true_correct = sum(1 for r in true_results if r.correct)
    false_correct = sum(1 for r in false_results if r.correct)

    unparsed = sum(1 for r in results if r.predicted is None)
    total_cost = sum(r.cost_usd for r in results)
    total_prompt = sum(r.prompt_tokens for r in results)
    total_completion = sum(r.completion_tokens for r in results)

    return EvalSummary(
        accuracy=correct / total if total > 0 else 0.0,
        total_problems=total,
        correct=correct,
        true_accuracy=true_correct / len(true_results) if true_results else 0.0,
        false_accuracy=false_correct / len(false_results) if false_results else 0.0,
        unparsed=unparsed,
        cheatsheet_bytes=cheatsheet_bytes,
        eval_seconds=total_elapsed,
        model=model,
        total_cost_usd=total_cost,
        total_prompt_tokens=total_prompt,
        total_completion_tokens=total_completion,
    )


def print_summary(summary: EvalSummary) -> None:
    """Print grep-able summary block."""
    print("---")
    print(f"accuracy:         {summary.accuracy:.3f}")
    print(f"total_problems:   {summary.total_problems}")
    print(f"correct:          {summary.correct}")
    print(f"true_accuracy:    {summary.true_accuracy:.3f}")
    print(f"false_accuracy:   {summary.false_accuracy:.3f}")
    print(f"unparsed:         {summary.unparsed}")
    print(f"cheatsheet_bytes: {summary.cheatsheet_bytes}")
    print(f"eval_seconds:     {summary.eval_seconds:.1f}")
    print(f"model:            {summary.model}")
    print(f"total_cost_usd:   {summary.total_cost_usd:.6f}")
    print(f"prompt_tokens:    {summary.total_prompt_tokens}")
    print(f"completion_tokens:{summary.total_completion_tokens}")


# ---------------------------------------------------------------------------
# Evaluation orchestration
# ---------------------------------------------------------------------------


async def evaluate_problem(
    problem: Problem,
    cheatsheet: str,
    model: str,
    temperature: float,
    max_tokens: int,
    semaphore: asyncio.Semaphore,
    observer: AutoResearchObserver | None = None,
    run_id: str = "",
    verbose: bool = False,
) -> EvalResult:
    """Evaluate a single problem."""
    messages = build_messages(problem.equation1, problem.equation2, cheatsheet)

    prompt_tokens = 0
    completion_tokens = 0
    cost_usd = 0.0

    try:
        llm_resp = await call_llm(
            messages, model, temperature, max_tokens, semaphore
        )
        response_text = llm_resp.text
        elapsed = llm_resp.elapsed_seconds
        prompt_tokens = llm_resp.prompt_tokens
        completion_tokens = llm_resp.completion_tokens
        cost_usd = llm_resp.cost_usd
    except Exception as e:
        response_text = f"ERROR: {e}"
        elapsed = 0.0

    predicted = parse_verdict(response_text)
    correct = predicted == problem.answer

    result = EvalResult(
        problem_id=problem.id,
        equation1=problem.equation1,
        equation2=problem.equation2,
        gold=problem.answer,
        predicted=predicted,
        correct=correct,
        response=response_text,
        elapsed_seconds=elapsed,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        cost_usd=cost_usd,
    )

    # Log to observer
    if observer and run_id:
        observer.log_llm_call(
            run_id=run_id,
            problem_id=problem.id,
            equation1=problem.equation1,
            equation2=problem.equation2,
            model=model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            cost_usd=cost_usd,
            duration_secs=elapsed,
            gold_answer=problem.answer,
            predicted_answer=predicted,
            correct=correct,
            response=response_text,
        )

    if verbose:
        gold_str = "TRUE" if problem.answer else "FALSE"
        pred_str = "TRUE" if predicted else ("FALSE" if predicted is not None else "NONE")
        mark = "OK" if correct else "XX"
        cost_str = f" ${cost_usd:.4f}" if cost_usd > 0 else ""
        print(f"  [{mark}] {problem.id}: gold={gold_str} pred={pred_str} ({elapsed:.1f}s{cost_str})")

    return result


async def run_evaluation(
    problems: list[Problem],
    cheatsheet: str,
    model: str = DEFAULT_MODEL,
    temperature: float = DEFAULT_TEMPERATURE,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    max_concurrent: int = MAX_CONCURRENT,
    observer: AutoResearchObserver | None = None,
    run_id: str = "",
    verbose: bool = False,
) -> tuple[list[EvalResult], EvalSummary]:
    """Run full evaluation on given problems."""
    semaphore = asyncio.Semaphore(max_concurrent)
    cheatsheet_bytes = len(cheatsheet.encode("utf-8"))

    t0 = time.time()
    tasks = [
        evaluate_problem(
            problem, cheatsheet, model, temperature, max_tokens,
            semaphore, observer, run_id, verbose,
        )
        for problem in problems
    ]
    results = await asyncio.gather(*tasks)
    total_elapsed = time.time() - t0

    summary = compute_summary(list(results), cheatsheet_bytes, total_elapsed, model)
    return list(results), summary


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(description="Evaluate cheatsheet on equational theory problems")
    parser.add_argument("--n", type=int, default=DEFAULT_N, help="Number of problems to sample (default 100)")
    parser.add_argument("--subset", default="all", choices=["all", "normal", "hard1", "hard2"], help="Problem subset")
    parser.add_argument("--model", default=DEFAULT_MODEL, help=f"LLM model (default {DEFAULT_MODEL})")
    parser.add_argument("--seed", type=int, default=SEED, help="Random seed for sampling")
    parser.add_argument("--full", action="store_true", help="Evaluate ALL problems (overrides --n)")
    parser.add_argument("--cheatsheet", default="cheatsheet.txt", help="Path to cheatsheet file")
    parser.add_argument("--temperature", type=float, default=DEFAULT_TEMPERATURE, help="LLM temperature")
    parser.add_argument("--max-concurrent", type=int, default=MAX_CONCURRENT, help="Max parallel API calls")
    parser.add_argument("--max-tokens", type=int, default=DEFAULT_MAX_TOKENS, help="Max response tokens")
    parser.add_argument("--verbose", action="store_true", help="Print each problem result")
    parser.add_argument("--db-path", default=None, help="SQLite DB path for observability (default: ../dashboard/autoresearch.db)")
    args = parser.parse_args()

    # Setup observer
    from observe import DEFAULT_DB_PATH
    db_path = args.db_path or DEFAULT_DB_PATH
    observer = AutoResearchObserver(db_path)
    run_id = str(uuid.uuid4())[:8]

    # Load problems
    problems = load_problems(args.subset)
    print(f"Loaded {len(problems)} problems (subset={args.subset})")

    # Sample or use all
    if args.full:
        eval_set = problems
    else:
        eval_set = sample_eval_set(problems, args.n, args.seed)

    true_count = sum(1 for p in eval_set if p.answer)
    print(f"Eval set: {len(eval_set)} problems ({true_count} TRUE, {len(eval_set) - true_count} FALSE)")

    # Load cheatsheet
    cheatsheet = load_cheatsheet(args.cheatsheet)
    cs_bytes = get_cheatsheet_bytes(args.cheatsheet)
    print(f"Cheatsheet: {cs_bytes} bytes from {args.cheatsheet}")
    print(f"Model: {args.model}")
    print(f"Run ID: {run_id}")
    print(f"Evaluating...")

    # Run
    results, summary = asyncio.run(
        run_evaluation(
            eval_set,
            cheatsheet,
            model=args.model,
            temperature=args.temperature,
            max_tokens=args.max_tokens,
            max_concurrent=args.max_concurrent,
            observer=observer,
            run_id=run_id,
            verbose=args.verbose,
        )
    )

    # Log experiment summary
    observer.log_experiment(
        run_id=run_id,
        model=summary.model,
        cheatsheet_bytes=summary.cheatsheet_bytes,
        total_problems=summary.total_problems,
        accuracy=summary.accuracy,
        true_accuracy=summary.true_accuracy,
        false_accuracy=summary.false_accuracy,
        unparsed=summary.unparsed,
        eval_seconds=summary.eval_seconds,
        total_cost_usd=summary.total_cost_usd,
        total_prompt_tokens=summary.total_prompt_tokens,
        total_completion_tokens=summary.total_completion_tokens,
    )

    # Print summary
    print()
    print_summary(summary)

    observer.close()


if __name__ == "__main__":
    main()
