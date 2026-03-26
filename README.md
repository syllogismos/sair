# SAIR Equational Theories — Prompt Optimization Pipeline

Automated prompt optimization for the [SAIR Mathematics Distillation Challenge: Equational Theories (Stage 1)](https://competition.sair.foundation/competitions/mathematics-distillation-challenge-equational-theories-stage1/overview).

**Goal:** Craft a prompt (max 10KB) that helps lower-cost LLMs determine whether one equational law implies another over all magmas. The prompt is optimized using [DSPy's GEPA optimizer](https://arxiv.org/abs/2507.19457), which iteratively evolves instructions through reflection.

## Current Best Submission

**78.5% accuracy** on 400 benchmark problems (200 normal + 200 hard) with Gemini 2.5 Flash Lite. Trained with two rounds of GEPA heavy optimization, < $20 total on Vertex AI.

<details>
<summary><strong>submission.txt</strong> (5.9 KB) — click to expand</summary>

```
You are a mathematician specializing in equational theories of magmas.
Your task is to determine whether Equation 1 ({{ equation1 }}) implies Equation 2 ({{ equation2 }}) over all magmas.

You are an expert mathematician specializing in universal algebra. Your task is to determine if `equation1` universally implies `equation2` for any arbitrary magma (a set with a single uninterpreted binary operation `*`).

**CRITICAL RULES:**
1. **NO ASSUMED PROPERTIES**: The operation `*` is an arbitrary binary operation. It is **NOT** commutative, **NOT** associative, and has no identity or inverses unless derivable from the given equations.
2. **UNIVERSAL QUANTIFICATION**: Variables in the equations are implicitly universally quantified. If an equation forces a constraint on free variables like `x = y`, `x = c`, `0 = z`, or `x = y ^ z`, it means the magma must be trivial (1 element).
3. **NO CANCELLATION**: `x * y = x * z` does NOT imply `y = z`.

**THE 4-STEP ALGORITHM:**
Follow this deterministic flowchart exactly.

**Step 1: Isolated Variable Trivialization (Applies ONLY to `equation1`)**
- Check if `equation1` is of the exact form `V = Term` or `Term = V`, where `V` is a single standalone variable that does **NOT** appear anywhere in `Term`.
- If YES: `equation1` forces the magma to be trivial. Output **TRUE**.
- If NO: Proceed to Step 2.

**Step 2: Standard Magma Models for Counterexamples**
Test 4 standard models to find a counterexample:
1. **Left-zero semigroup ($a * b = a$):** Any expression evaluates to its left-most variable.
2. **Right-zero semigroup ($a * b = b$):** Any expression evaluates to its right-most variable.
3. **Constant magma ($a * b = c$):** Any expression with `*` evaluates to constant `c`.
4. **XOR / Parity magma ($a * b = a \oplus b$):** Count variable occurrences — odd stays, even cancels.

For each model: simplify equation1 (constraint = abort, tautology = valid). If valid, simplify equation2 (constraint = FALSE, tautology = inconclusive).

**Step 3: Advanced Heuristics for Unresolved Cases**
- All 4 models aborted: 3+ distinct variables -> TRUE, 2 variables -> FALSE
- At least one valid model inconclusive: check for specific restrictive syntactic forms -> TRUE if matched, else FALSE

**Step 4: Final Verdict**
Output step-by-step reasoning following the algorithm exactly.
```

</details>

## Training

```bash
# Smoke test — 20 problems, 60 metric calls, dry-run eval
uv run python src/run_gepa.py --solver v1 --baby

# Light budget (~1,724 metric calls, ~$5)
uv run python src/run_gepa.py --solver v1 --auto light

# Heavy budget (~3,210 metric calls, ~$10)
uv run python src/run_gepa.py --solver v1 --auto heavy

# Heavy + auto-eval on all 400 benchmark problems after training
uv run python src/run_gepa.py --solver v1 --auto heavy --auto-eval

# Start from a seed prompt (e.g. best candidate from a previous run)
uv run python src/run_gepa.py --solver v1 --auto heavy \
  --initial-prompt src/seed_from_32d09f740fd2.txt

# Use different models (any litellm-compatible model string)
uv run python src/run_gepa.py --solver v1 --auto light \
  --student-model openai/gpt-4o-mini \
  --reflection-model openai/gpt-4o
```

Set the corresponding API key env var for your provider (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `TOGETHER_API_KEY`, or Vertex AI credentials).

## Evaluation

```bash
# Evaluate optimized solver on all 400 benchmark problems
uv run python src/run_eval.py --solver-path optimized_solver.json --subset all_400

# Evaluate a raw prompt file
uv run python src/run_eval.py --solver-path submission.txt --subset all_400

# With Gemini thinking tokens enabled
uv run python src/run_eval.py --solver-path submission.txt --subset all_400 \
  --thinking-budget 4096

# Repeat 3 times (for consistency measurement)
uv run python src/run_eval.py --solver-path submission.txt --subset all_400 --repeat 3

# Different model
uv run python src/run_eval.py --solver-path submission.txt --subset all_400 \
  --student-model vertex_ai/gemini-2.5-flash

# Dry-run (predict FALSE, no LLM calls — for testing)
uv run python src/run_eval.py --solver-path submission.txt --subset all_400 --dry-run
```

Results are stored in `gepa_observations.db` and appear in the dashboard Leaderboard and Evaluations tabs.

## Exporting a Submission

```bash
uv run python src/export.py \
  --solver-path gepa_logs/<run_id>/optimized_solver.json \
  --solver-version v1 \
  --output submission.txt
```

Generates a Jinja2 template (max 10KB) with `{{ equation1 }}` and `{{ equation2 }}` placeholders.

## Dashboard

```bash
cd dashboard && npm install && npm run dev -- -p 3001
```

Open http://localhost:3001

| Tab | Description |
|-----|-------------|
| **Leaderboard** | 25 benchmark models + our eval runs side-by-side, sorted by accuracy/F1/cost. Our runs shown with cyan `OURS` badge. |
| **Evaluations** | Per-problem results for each eval run. Filter by correct/wrong, expected TRUE/FALSE, normal/hard. Click a problem to see the full model response. Stats recalculate based on filters. |
| **GEPA Experiments** | Live training run monitoring — accuracy chart, iteration timeline (accept/reject/skip), candidate instructions, Pareto frontier. Auto-refreshes during active runs. |
| **Model Breakdown** | Per-model analysis from the benchmark dataset. |
| **Problems** | Browse all 1,269 problems with equations and answers. |
| **Runs** | Individual benchmark model runs with search and accuracy filtering. |

## Data Setup

```bash
# Problems (required)
.venv/bin/hf download SAIRfoundation/equational-theories-selected-problems --local-dir data/

# Benchmark runs (recommended — used for reference solutions in metric feedback)
.venv/bin/hf download SAIRfoundation/equational-theories-benchmark --local-dir data/
```

## Project Structure

```
src/
  run_gepa.py        — GEPA optimization (training)
  run_eval.py        — standalone evaluation on benchmark problems
  export.py          — export optimized prompt to submission template
  solver.py          — DSPy solver modules (V1, V2, V3)
  metric.py          — scoring with reference solution feedback
  data.py            — data loading and train/val split
  observer.py        — SQLite logging for LLM calls and optimization events
tests/
  test_run_eval.py   — tests for evaluation pipeline
dashboard/
  app/               — Next.js app with API routes and components
data/
  problems_*.jsonl   — competition problems
  benchmark_*        — benchmark model runs
gepa_logs/
  <run_id>/          — per-run checkpoints and optimized solvers
```
