# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Competition entry for the SAIR Foundation's **Mathematics Distillation Challenge: Equational Theories (Stage 1)**. The goal is to craft a prompt (template + cheatsheet, max 10KB) that helps lower-cost LLMs determine whether one equational law implies another over all magmas.

- Competition: https://competition.sair.foundation/competitions/mathematics-distillation-challenge-equational-theories-stage1/overview
- Problems dataset: https://huggingface.co/datasets/SAIRfoundation/equational-theories-selected-problems
- Benchmark dataset: https://huggingface.co/datasets/SAIRfoundation/equational-theories-benchmark
- Equational Theories Project: https://github.com/teorth/equational_theories

## Problem

Given two equations over magmas (e.g. `x = x * (y * z)` and `x * y = y * x`), answer: **does Equation 1 imply Equation 2?** (TRUE/FALSE). Equations use `*` as the binary operation and variables `x, y, z, w, u, v`.

Submission is a Jinja2 prompt template with `{{ equation1 }}`, `{{ equation2 }}`, and optionally `{{ cheatsheet }}`. Evaluation is offline, no-tools, on a hidden balanced (50/50) set using lower-cost models (Llama, Gemini Flash, etc.).

## Environment

- Python 3.12 via uv (`uv pip install`, never pip)
- Virtual environment: `.venv/` (activate: `source .venv/bin/activate`)
- HuggingFace CLI: `.venv/bin/hf`
- Vertex AI: set `GOOGLE_CLOUD_PROJECT` and `GOOGLE_APPLICATION_CREDENTIALS` env vars. The `VERTEXAI_LOCATION` default is `global` because Gemini 3.1 models only work with the global endpoint.

## Commands

```bash
# Run GEPA optimization (main workflow)
uv run python src/run_gepa.py --solver v1 --auto light
uv run python src/run_gepa.py --solver v2 --auto medium --cheatsheet cheatsheet.txt
uv run python src/run_gepa.py --solver v3 --auto heavy --use-cc  # uses Claude Code SDK for reflection

# Baby run — smoke test the full pipeline (GEPA + eval) cheaply
uv run python src/run_gepa.py --solver v1 --baby

# Standalone evaluation of a solver on benchmark problems
uv run python src/run_eval.py --solver-path optimized_solver.json --subset all_400
uv run python src/run_eval.py --solver-path my_prompt.txt --subset normal_200 --dry-run

# Export optimized solver to submission prompt
uv run python src/export.py --solver-path optimized_solver.json --solver-version v1 --output submission.txt

# Run tests
uv run python -m pytest tests/ -v

# Dashboard (Next.js, in dashboard/)
cd dashboard && npm run dev
```

## Architecture

Two main systems: a **DSPy optimization pipeline** (`src/`) and an **observability dashboard** (`dashboard/`).

### DSPy Pipeline (`src/`)

The pipeline uses DSPy's GEPA optimizer to automatically improve prompt instructions for the equational implication task.

**Data flow:** `data.py` loads JSONL problems as DSPy Examples → `solver.py` defines the DSPy modules → `metric.py` scores predictions using reference solutions from benchmark traces → `run_gepa.py` orchestrates GEPA optimization → `export.py` converts the optimized solver to a 10KB submission template.

**Solvers** (all in `solver.py`):
- `SolverV1` — single ChainOfThought, no cheatsheet
- `SolverV2` — single ChainOfThought with cheatsheet as `reference` input
- `SolverV3` — two-step: ChainOfThought analyze → Predict classify, with cheatsheet

**LM setup:** Student LM (Gemini Flash Lite via Vertex AI, temp=0) runs the solver. Reflection LM (Gemini Pro or Claude Opus via `cc_adapter.py`) guides GEPA optimization. The `--use-cc` flag switches reflection to the Claude Code SDK adapter (`ClaudeCodeLM`), which uses subscription auth with no API key.

**Metric** (`metric.py`): Binary score (0/1) with textual feedback. On wrong answers, includes reference solutions from benchmark traces (truncated to 2000 chars) or fallback hints about TRUE/FALSE reasoning patterns.

**Observer** (`observer.py`): DSPy callback logging every LLM call to SQLite (`gepa_observations.db`) with model, role, token counts, cost estimates, and response previews.

### Dashboard (`dashboard/`)

Next.js app (React 19, Tailwind 4) for exploring benchmark data. Reads SQLite for GEPA observations and CSV/JSONL data files. Components: ProblemExplorer, LeaderboardView, ModelBreakdownView, RunsExplorer. API routes serve run data from SQLite.

**Important:** This uses a newer Next.js version with breaking changes. Read `node_modules/next/dist/docs/` before modifying dashboard code.

## Data (in `data/`)

**Problem sets** (JSONL/CSV, fields: `id`, `index`, `difficulty`, `equation1`, `equation2`, `answer`):
- `problems_normal` — 1,000 problems (500 TRUE, 500 FALSE)
- `problems_hard1` — 69 problems (24 TRUE, 45 FALSE)
- `problems_hard2` — 200 problems (100 TRUE, 100 FALSE)

**Reference data:**
- `equations.txt` — all 4,694 equational laws (line N = Equation N)
- `benchmark_models.csv` — 25 models (CSV only, no JSONL)
- `benchmark_leaderboard` — per-model aggregate scores
- `benchmark_runs` — 60,000 individual model runs (~265MB JSONL)
- `benchmark_cells` — 20,000 aggregated model/problem pairs
- `benchmark_benchmarks` — 4 benchmark configs
- `benchmark_prompt_templates` — prompt template metadata

### Downloading data

```bash
# Install HuggingFace CLI if not present
uv pip install huggingface_hub

# Problems dataset
.venv/bin/hf download SAIRfoundation/equational-theories-selected-problems --local-dir data/

# Benchmark dataset (~265MB, needed for reference solutions in metric feedback)
.venv/bin/hf download SAIRfoundation/equational-theories-benchmark --local-dir data/
```

**Expected JSONL format** (one JSON object per line):
```json
{"id": "normal_0001", "index": 1, "difficulty": "normal", "equation1": "x = ...", "equation2": "x * y = ...", "answer": true}
```

The `answer` field must be a JSON boolean (`true`/`false`), not a string. The scripts handle both but booleans are expected.

Note: benchmark reference solutions only cover 200 normal + 200 hard problems (not all 1,269). Problems without reference solutions get generic fallback feedback.

## Running GEPA Optimization

### Baby run (for testing)

```bash
# Smoke test full pipeline: GEPA (20 problems, 60 metric calls) + dry-run eval (predicts FALSE)
uv run python src/run_gepa.py --solver v1 --baby

# Legacy baby run (GEPA only, no eval)
uv run python baby_run.py

# With a seed prompt — start optimization from a hand-crafted instruction
uv run python baby_run.py --initial-prompt src/seed_prompt_iter3_39e2654730fd.txt
```

### Full run

```bash
# Light budget (~1,724 metric calls, ~6 candidates, ~$5-6)
uv run python src/run_gepa.py --solver v1 --auto light

# With seed prompt
uv run python src/run_gepa.py --solver v1 --auto light --initial-prompt src/seed_prompt_iter3_39e2654730fd.txt

# Heavy budget (~3,210 metric calls, ~18 candidates, ~$9-12)
uv run python src/run_gepa.py --solver v1 --auto heavy

# Custom budget
uv run python src/run_gepa.py --solver v1 --max-metric-calls 500

# Resume a previous run
uv run python src/run_gepa.py --solver v1 --auto light --resume <run_id>

# Use different models
uv run python src/run_gepa.py --solver v1 --auto light \
  --student-model vertex_ai/gemini-2.5-flash-lite \
  --reflection-model vertex_ai/gemini-3.1-pro-preview
```

### Hyperparameters

| Flag | Default | Description |
|------|---------|-------------|
| `--solver` | `v1` | Solver architecture: `v1` (single step), `v2` (with cheatsheet), `v3` (two-step) |
| `--auto` | `light` | Budget: `light` (6 candidates, ~1,724 calls), `medium` (12, ~2,410), `heavy` (18, ~3,210) |
| `--max-metric-calls` | None | Override `--auto` with exact metric call budget |
| `--minibatch-size` | `35` | Training examples per reflection minibatch (DSPy default is 3, GEPA auto_budget uses 35) |
| `--student-model` | `vertex_ai/gemini-2.5-flash-lite` | Student LM. Use any litellm-compatible model string |
| `--reflection-model` | `vertex_ai/gemini-3.1-pro-preview` | Reflection LM |
| `--initial-prompt` | None | Text file with seed instruction (GEPA optimizes from here) |
| `--resume` | None | Run ID to resume (reuses checkpoint and dashboard data) |
| `--cheatsheet` | None | Text file for v2/v3 solvers |
| `--seed` | `42` | RNG seed |
| `--use-cc` | false | Use Claude Code SDK for reflection (slow — see `cc_adapter.py` warning) |
| `--baby` | false | Smoke test: 20 problems, 60 metric calls, minibatch=3, auto-eval with dry-run |
| `--auto-eval` | false | Run full evaluation on benchmark problems after GEPA completes |
| `--eval-subset` | `all_400` | Problem subset for auto-eval: `normal_200`, `hard_200`, `all_400`, `all_1269` |

### Using your own models

The scripts use Vertex AI by default but you can use any provider litellm supports:

```bash
# OpenAI
uv run python src/run_gepa.py --solver v1 --auto light \
  --student-model openai/gpt-4o-mini \
  --reflection-model openai/gpt-4o

# Anthropic (requires ANTHROPIC_API_KEY)
uv run python src/run_gepa.py --solver v1 --auto light \
  --student-model anthropic/claude-haiku-4-5-20251001 \
  --reflection-model anthropic/claude-sonnet-4-6

# Together AI (requires TOGETHER_API_KEY)
uv run python src/run_gepa.py --solver v1 --auto light \
  --student-model together_ai/meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo \
  --reflection-model together_ai/meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo
```

Set the corresponding API key environment variable for your provider. No Claude Code or Vertex AI account needed.

### Train/val split

All problems (normal + hard1 + hard2 = 1,269) are combined and split 80/20 into train (1,016) / val (253), balanced by answer and deterministic via `--seed`.

### Run outputs

- `gepa_logs/<run_id>/gepa_state.bin` — GEPA checkpoint (for `--resume`)
- `gepa_logs/<run_id>/optimized_solver.json` — best candidate's DSPy module
- `optimized_solver.json` (project root) — latest run's best (overwritten each run)
- `gepa_observations.db` — SQLite with all tracking data (LLM calls, metrics, iterations, candidates, Pareto)

## Standalone Evaluation

Evaluate an optimized solver (or raw prompt) on benchmark problem subsets and compare against the 25 benchmark models in the dashboard leaderboard.

```bash
# Evaluate optimized solver on all 400 benchmark problems (200 normal + 200 hard)
uv run python src/run_eval.py --solver-path optimized_solver.json --subset all_400

# Evaluate a raw prompt text file
uv run python src/run_eval.py --solver-path my_prompt.txt --subset normal_200

# Dry-run: predict FALSE for all problems (no LLM calls, for testing)
uv run python src/run_eval.py --solver-path optimized_solver.json --subset all_400 --dry-run

# Reuse GEPA val results to avoid re-evaluating those problems
uv run python src/run_eval.py --solver-path optimized_solver.json --gepa-run-id abc123

# Custom display name for leaderboard
uv run python src/run_eval.py --solver-path optimized_solver.json --display-name "My best solver v2"
```

Results are stored in `gepa_observations.db` (tables: `eval_runs`, `eval_results`) and appear in the dashboard **Leaderboard** tab with an `OURS` badge, alongside the benchmark models. Data stays separate — benchmark data in `dashboard/data.db` is never modified.

## Exporting a Submission

```bash
# From a specific run
uv run python src/export.py --solver-path gepa_logs/<run_id>/optimized_solver.json --solver-version v1 --output submission.txt

# From latest run
uv run python src/export.py --solver-path optimized_solver.json --solver-version v1 --output submission.txt
```

The output is a Jinja2 template (max 10KB). The competition evaluator replaces `{{ equation1 }}` and `{{ equation2 }}` with actual equations and sends the full text as the prompt.

**Note:** DSPy wraps instructions with structured output formatting during GEPA optimization, but the competition uses a simpler format (just the template text). The instruction content is the same but the wrapper differs.

## Dashboard

### Starting

```bash
cd dashboard && npm run dev -- -p 3001
```

Open http://localhost:3001

### Data sources

1. **`gepa_observations.db`** (project root) — written by `observer.py` during GEPA runs and `run_eval.py` during evaluations
   - GEPA tables: `runs`, `llm_calls`, `gepa_metric_calls`, `gepa_iterations`, `gepa_candidates`, `gepa_candidate_scores`, `gepa_pareto`
   - Eval tables: `eval_runs`, `eval_results`
   - Feeds the **GEPA Experiments** tab and **Leaderboard** (our eval runs)

2. **`dashboard/data.db`** — pre-built from HuggingFace benchmark data (read-only, never modified)
   - Feeds the **Leaderboard** (benchmark models), **Model Breakdown**, **Problems**, and **Runs** tabs

### Features

- **GEPA Experiments** — live tracking of runs. Accuracy chart, metric evaluations (clickable dots with feedback), iteration timeline (proposed instructions, accept/reject/skip), candidate programs, Pareto frontier. Auto-refreshes every 3s while a run is active.
- **Leaderboard** — benchmark model scores + our eval runs (merged via `/api/leaderboard`, our runs shown with cyan `OURS` badge)
- **Model Breakdown** — per-model analysis
- **Problems** — problem explorer
- **Runs** — individual benchmark runs with problem search and accuracy filtering

URL routing uses hash (`#gepa`, `#gepa/<run_id>`, `#leaderboard`, etc.). Refreshing preserves the current view.
