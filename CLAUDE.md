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
- Vertex AI: project `YOUR_GCP_PROJECT`, region `us-central1` (auto-configured by `run_gepa.py`). Note: the `VERTEXAI_LOCATION` default in `run_gepa.py` is `global` (not `us-central1`) because Gemini 3.1 models only work with the global endpoint.

## Commands

```bash
# Run GEPA optimization (main workflow)
python src/run_gepa.py --solver v1 --auto light
python src/run_gepa.py --solver v2 --auto medium --cheatsheet cheatsheet.txt
python src/run_gepa.py --solver v3 --auto heavy --use-cc  # uses Claude Code SDK for reflection

# Export optimized solver to submission prompt
python src/export.py --solver-path optimized_solver.json --solver-version v1 --output submission.txt

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
