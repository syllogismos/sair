# SAIR Equational Theories — Prompt Optimization Pipeline

Automated prompt optimization for the [SAIR Mathematics Distillation Challenge: Equational Theories (Stage 1)](https://competition.sair.foundation/competitions/mathematics-distillation-challenge-equational-theories-stage1/overview).

**Goal:** Craft a prompt (max 10KB) that helps lower-cost LLMs determine whether one equational law implies another over all magmas. The prompt is optimized using [DSPy's GEPA optimizer](https://arxiv.org/abs/2507.19457), which iteratively evolves instructions through reflection.

## Quick Start

```bash
# 1. Clone
git clone https://github.com/syllogismos/sair.git
cd sair

# 2. Setup Python environment
uv sync  # or: uv pip install -r requirements.txt

# 3. Download data from HuggingFace
.venv/bin/hf download SAIRfoundation/equational-theories-selected-problems --local-dir data/
.venv/bin/hf download SAIRfoundation/equational-theories-benchmark --local-dir data/

# 4. Set your API key (pick your provider)
export ANTHROPIC_API_KEY=sk-...       # for Anthropic models
# or
export OPENAI_API_KEY=sk-...          # for OpenAI models
# or
export TOGETHER_API_KEY=...           # for Together AI (Llama, etc.)
# or set up Vertex AI credentials for Google models

# 5. Run optimization
uv run python src/run_gepa.py --solver v1 --auto light \
  --student-model openai/gpt-4o-mini \
  --reflection-model openai/gpt-4o

# 6. Export submission
uv run python src/export.py --solver-path optimized_solver.json --solver-version v1 --output submission.txt
```

## The Competition

Given two equations over magmas (e.g. `x = x * (y * z)` and `x * y = y * x`), determine: **does Equation 1 imply Equation 2?** (TRUE/FALSE).

- Equations use `*` as a binary operation and variables `x, y, z, w, u, v`
- `*` is an arbitrary operation — no commutativity, associativity, or other properties assumed
- Evaluation is on a hidden test set using lower-cost models (Llama, Gemini Flash, etc.)
- Submission is a Jinja2 template with `{{ equation1 }}` and `{{ equation2 }}` placeholders (max 10KB)

## Data Setup

Download from HuggingFace and place in `data/`:

```bash
# Required — the problems to train on
.venv/bin/hf download SAIRfoundation/equational-theories-selected-problems --local-dir data/

# Recommended — benchmark model runs, used for reference solutions in metric feedback
.venv/bin/hf download SAIRfoundation/equational-theories-benchmark --local-dir data/
```

**What you get:**

| File | Size | Description |
|------|------|-------------|
| `problems_normal.jsonl` | ~200KB | 1,000 problems (500 TRUE, 500 FALSE) |
| `problems_hard1.jsonl` | ~15KB | 69 hard problems |
| `problems_hard2.jsonl` | ~40KB | 200 hard problems |
| `benchmark_runs.jsonl` | ~265MB | 60,000 model runs — correct solutions used as feedback |
| `equations.txt` | ~100KB | All 4,694 equational laws |

Each problem is a JSONL line:
```json
{"id": "normal_0001", "equation1": "x = ...", "equation2": "x * y = ...", "answer": true}
```

## Running GEPA Optimization

GEPA (Guided Evolutionary Prompt Adaptation) iteratively improves your prompt:
1. Evaluates the current prompt on a validation set
2. Samples a minibatch, identifies failures
3. Sends failures to a reflection LM which proposes an improved prompt
4. Accepts the new prompt if it improves on the minibatch, then runs full evaluation
5. Tracks a Pareto frontier — different prompts can be best on different problems

### Choose Your Models

You need two models:
- **Student** — the cheap/fast model that runs on every problem (hundreds of calls)
- **Reflection** — the smart model that proposes better instructions (few calls)

```bash
# OpenAI
uv run python src/run_gepa.py --solver v1 --auto light \
  --student-model openai/gpt-4o-mini \
  --reflection-model openai/gpt-4o

# Anthropic
uv run python src/run_gepa.py --solver v1 --auto light \
  --student-model anthropic/claude-haiku-4-5-20251001 \
  --reflection-model anthropic/claude-sonnet-4-6

# Together AI (Llama)
uv run python src/run_gepa.py --solver v1 --auto light \
  --student-model together_ai/meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo \
  --reflection-model together_ai/meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo

# Google Vertex AI
uv run python src/run_gepa.py --solver v1 --auto light \
  --student-model vertex_ai/gemini-2.5-flash-lite \
  --reflection-model vertex_ai/gemini-3.1-pro-preview
```

Any [litellm-compatible model string](https://docs.litellm.ai/docs/providers) works. Set the corresponding `*_API_KEY` env variable.

### Budget Presets

| Preset | Candidates | Iterations | Metric Calls | Est. Time |
|--------|-----------|------------|-------------|-----------|
| `--auto light` | 6 | ~10 | ~1,724 | 1-3 hours |
| `--auto medium` | 12 | ~18 | ~2,410 | 2-5 hours |
| `--auto heavy` | 18 | ~27 | ~3,210 | 3-8 hours |

Or set an exact budget: `--max-metric-calls 500`

### Start from a Seed Prompt

Instead of starting from a blank instruction, provide a hand-crafted starting point:

```bash
uv run python src/run_gepa.py --solver v1 --auto light \
  --initial-prompt my_prompt.txt \
  --student-model openai/gpt-4o-mini \
  --reflection-model openai/gpt-4o
```

The text file should contain just the instruction text — no Jinja placeholders or output format. GEPA optimizes from there.

### All Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--solver` | `v1` | `v1` (single step), `v2` (with cheatsheet), `v3` (two-step) |
| `--auto` | `light` | Budget preset: `light`, `medium`, `heavy` |
| `--max-metric-calls` | — | Override auto budget with exact number |
| `--minibatch-size` | `10` | Training examples per reflection step |
| `--student-model` | `vertex_ai/gemini-2.5-flash-lite` | Student model |
| `--reflection-model` | `vertex_ai/gemini-3.1-pro-preview` | Reflection model |
| `--initial-prompt` | — | Path to seed instruction text file |
| `--resume` | — | Run ID to resume a previous run |
| `--cheatsheet` | — | Path to cheatsheet file (for v2/v3) |
| `--seed` | `42` | RNG seed |

### Baby Run (Testing)

Test the full pipeline with 20 problems and a tiny budget:

```bash
uv run python baby_run.py
uv run python baby_run.py --initial-prompt my_prompt.txt
```

## Exporting a Submission

After a run completes:

```bash
# From a specific run
uv run python src/export.py \
  --solver-path gepa_logs/<run_id>/optimized_solver.json \
  --solver-version v1 \
  --output submission.txt

# From the latest run
uv run python src/export.py \
  --solver-path optimized_solver.json \
  --solver-version v1 \
  --output submission.txt
```

This generates a Jinja2 template (max 10KB) with `{{ equation1 }}` and `{{ equation2 }}` placeholders. Submit this file to the competition.

## Dashboard

A Next.js dashboard for monitoring optimization runs and exploring benchmark data.

```bash
cd dashboard && npm install && npm run dev -- -p 3001
```

Open http://localhost:3001

### What it shows

**GEPA Experiments tab** — live monitoring of optimization runs:
- Accuracy chart over time (hover for details)
- Metric evaluations — click any dot to see the problem, prediction, and feedback
- Iteration timeline — see which parent was picked, what instruction was proposed, whether it was accepted/rejected, and why
- Candidate programs — expand to read the actual instruction text GEPA produced
- Pareto frontier — which candidate is best on which problems
- Auto-refreshes every 3 seconds while a run is active

**Other tabs:**
- Leaderboard — benchmark model scores
- Model Breakdown — per-model analysis
- Problems — problem explorer
- Runs — individual benchmark runs with search/filtering

### Data sources

- `gepa_observations.db` (project root) — written during GEPA runs, feeds the GEPA Experiments tab
- `dashboard/data.db` — pre-built from HuggingFace benchmark, feeds Leaderboard/Runs/Problems tabs

## Project Structure

```
baby_run.py          — small test run (20 problems, same models as full run)
baby_run_claude.py   — test run using Claude Code SDK
src/
  run_gepa.py        — main GEPA optimization script
  solver.py          — DSPy solver modules (V1, V2, V3)
  metric.py          — scoring with reference solution feedback
  data.py            — data loading and train/val split
  observer.py        — SQLite logging for LLM calls + GEPA events
  cc_adapter.py      — Claude Code SDK adapter (slow, see warning)
  export.py          — export optimized prompt to submission template
data/
  problems_*.jsonl   — competition problems
  benchmark_*        — benchmark model runs (download from HuggingFace)
dashboard/
  app/               — Next.js app with API routes and components
gepa_logs/
  <run_id>/          — per-run checkpoints and optimized solvers
```
