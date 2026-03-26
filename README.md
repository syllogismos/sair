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
- *Examples:* `x = y * (z * w)` or `x = (y * y) * z`.
- If YES: `equation1` forces the magma to be trivial. Output **TRUE**.
- If NO: Proceed to Step 2.

**Step 2: Standard Magma Models for Counterexamples**
Test 4 standard models to find a counterexample.
*How to evaluate the models safely and instantly:*
1. **Left-zero semigroup ($a * b = a$):** Any expression evaluates to its **left-most variable**.
   - e.g., `(y * x) * z` becomes `y`. `x = (y * y) * (z * w)` simplifies to `x = y`.
2. **Right-zero semigroup ($a * b = b$):** Any expression evaluates to its **right-most variable**.
   - e.g., `x * (y * z)` becomes `z`. `x = y * (z * x)` becomes `x = x`.
3. **Constant magma ($a * b = c$):** Any expression that contains **at least one `*` operation** evaluates to the constant `c`. A single standalone variable remains itself.
   - e.g., `x * y` becomes `c`. `x = (y * z) * w` becomes `x = c`. `x * y = z * w` becomes `c = c`.
4. **XOR / Parity magma ($a * b = a \oplus b$):** Flatten the expression and count occurrences of EACH variable on each side.
   - ODD occurrences → variable remains.
   - EVEN occurrences → variable cancels out (becomes 0).
   - Combine remaining variables with XOR (`^`).
   - e.g., `x = y * ((x * z) * y)` → LHS is `x`. RHS has two `y`, one `x`, one `z` → RHS is `x ^ z`. Equation becomes `x = x ^ z`, which means `0 = z`.

*For each model:*
1. Simplify `equation1`.
   - ANY equation that is not identical on both sides is a **CONSTRAINT** (e.g., `x = y`, `x = z`, `x = c`, `0 = z`, `x = y ^ z`, `x ^ y = z ^ w`). Constraints force restricted values because they do not hold for all possible variable assignments. **Abort** this model and try the next.
   - ONLY identical equations are **TAUTOLOGIES** (e.g., `x = x`, `c = c`, `0 = 0`, `x ^ y = x ^ y`). This model is **VALID**.
2. If the model is **VALID**, simplify `equation2`.
   - If `equation2` simplifies to a **CONSTRAINT** (e.g., `x = y`, `x = c`, `x = z`), `equation2` is FALSE in this model. You found a counterexample! **Output FALSE** immediately.
   - If `equation2` simplifies to a **TAUTOLOGY**, this model is compatible but inconclusive. Proceed to the next model.
*CRITICAL:* Do NOT say "All four models aborted" if ANY model was valid. Even if a valid model is inconclusive, it means it did NOT abort.

**Step 3: Advanced Heuristics for Unresolved Cases**
If Step 2 did NOT find a counterexample (meaning all valid models were inconclusive, or all 4 models aborted), apply these heuristics to `equation1`:

*Condition A: ALL FOUR models aborted (forced triviality for `equation1`)*
- Count the number of DISTINCT variables in `equation1`.
- If `equation1` has **3 or more distinct variables**, it is highly restrictive and forces global triviality. Output **TRUE**.
- If `equation1` has **only 2 distinct variables**, output **FALSE**.

*Condition B: NOT all models aborted (At least one valid model was inconclusive)*
- Check if `equation1` matches any of these exact highly restrictive syntactic forms:

  - **Form 1 (Product of distinct variables equals Term with free variable):** `equation1` is EXACTLY of the form `A * B = Term` OR `Term = A * B`, where:
    1. The product side is exactly two distinct standalone variables multiplied together (e.g., exactly `x * y` or `u * v`. It cannot be `x * x` and cannot have nested operations like `(x * y) * z`).
    2. `Term` contains at least one **free variable** (a variable that is NOT `A` and NOT `B`).
    *(Example 1: `x * y = y * ((y * z) * x)` matches because LHS is exactly `x * y` and RHS has `z`. Example 2: `x * y = ((z * y) * y) * w` matches because LHS is `x * y` and RHS has `z` and `w`.)*

  - **Form 2 (Absorption/Identity Form):** `equation1` is EXACTLY of the form `V = V * Term` OR `V = Term * V`, where:
    1. `V` is a single standalone variable.
    2. The other side is exactly `V` multiplied by some `Term` (or `Term` multiplied by `V`).
    3. `equation1` contains **3 or more distinct variables** in total.
    *(Example 1: `x = x * (y * (x * z))` matches because LHS is `x` and RHS is `x * Term` and it has 3 distinct variables. Example 2: `x = ((y * z) * z) * x` matches because LHS is `x` and RHS is `Term * x` with 3 distinct variables.)*

- If `equation1` matches Form 1 OR Form 2 perfectly, it globally forces the magma to be highly structured or trivial. Output **TRUE**.
- If it does NOT match these exact criteria, output **FALSE**.

**Step 4: Final Verdict**
Output your step-by-step reasoning following the algorithm exactly, then output the final verdict in this exact format:

### verdict
True/False

Output format (use exact headers without any additional text or formatting):
VERDICT: must be exactly TRUE or FALSE (in the same line).
REASONING: must be non-empty.
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
| **Leaderboard** | 25 benchmark models + our eval runs side-by-side, sorted by accuracy/F1/cost. Our runs shown with cyan `OURS` badge. Filter by benchmark config (Normal/Hard, Low/Default reasoning). |
| **Evaluations** | Per-problem results for each eval run. Filter by correct/wrong, expected TRUE/FALSE, normal/hard. Click a problem to expand and see the full model response and LLM call details. Stats (accuracy, F1, confusion matrix) recalculate based on active filters. Auto-refreshes during running evals. |
| **GEPA Experiments** | Live training run monitoring — accuracy chart over metric calls, iteration timeline (accept/reject/skip with reasoning), candidate instructions (click to expand), Pareto frontier. Shows train/val sizes, cost, LLM call breakdown. Auto-refreshes every 3s during active runs. |
| **GEPA Replay** | Step-through animation of a completed GEPA run from its checkpoint (`gepa_state.bin`). Visualizes how candidates evolved, which parents were selected, subsample scores, and the Pareto frontier at each iteration. |
| **Model Breakdown** | Per-model TRUE vs FALSE accuracy scatter plot and detailed stats from the benchmark dataset. |
| **Problems** | Browse all 1,269 problems with equations and answers. |
| **Runs** | Individual benchmark model runs (60,000 total) with search by problem ID and accuracy filtering. |

## Data Setup

All problem files and dashboard static JSONs are checked into the repo. You only need two extra steps:

```bash
# 1. Download benchmark runs (~265MB, needed for metric feedback during training)
uv pip install huggingface_hub
.venv/bin/hf download SAIRfoundation/equational-theories-benchmark data/runs.jsonl --repo-type dataset --local-dir /tmp/hf_bench
mv /tmp/hf_bench/data/runs.jsonl data/benchmark_runs.jsonl

# 2. Build dashboard SQLite database
uv run python scripts/build_sqlite.py
```

**What's already in the repo:**
- `data/problems_*.jsonl` — all 1,669 problems (normal, hard1, hard2, hard3)
- `data/benchmark_*.{jsonl,csv}` — leaderboard, models, benchmarks, cells, templates
- `dashboard/public/data/*.json` — static JSON files for the dashboard

**What's gitignored (you create locally):**
- `data/benchmark_runs.jsonl` (~265MB) — downloaded from HuggingFace
- `dashboard/data.db` (~275MB) — built by `scripts/build_sqlite.py`
- `gepa_observations.db` — created automatically during training/eval runs

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
scripts/
  build_sqlite.py    — build dashboard/data.db from HuggingFace data
  build_runs_sample.py — build stratified sample of runs for dashboard
tests/
  test_run_eval.py   — tests for evaluation pipeline
dashboard/
  app/               — Next.js app with API routes and components
  public/data/       — static JSON files (leaderboard, models, problems)
  data.db            — SQLite database built by scripts/build_sqlite.py (gitignored)
data/
  problems_*.{csv,jsonl}  — competition problems (from HuggingFace)
  benchmark_*.{csv,jsonl} — benchmark model runs and metadata
  benchmark_*        — benchmark model runs
gepa_logs/
  <run_id>/          — per-run checkpoints and optimized solvers
```
