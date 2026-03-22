# Karpathy's AutoResearch: Key Principles & System Design

Source: [github.com/karpathy/autoresearch](https://github.com/karpathy/autoresearch)

> *One day, frontier AI research used to be done by meat computers in between eating, sleeping, having other fun, and synchronizing once in a while using sound wave interconnect in the ritual of "group meeting". That era is long gone. Research is now entirely the domain of autonomous swarms of AI agents running across compute cluster megastructures in the skies.* -@karpathy, March 2026

## The Core Idea

Give an AI agent a small but real LLM training setup and let it experiment autonomously overnight. It modifies code, trains for 5 minutes, checks if the result improved, keeps or discards the change, and repeats. You wake up to a log of ~100 experiments and (hopefully) a better model.

The human's role shifts from writing Python to writing `program.md` — a markdown file that instructs the AI agent. You're programming the researcher, not the research.

## The 7 Core Principles

### 1. Fixed Budget, Single Metric (The Scientific Control)

- Every experiment runs for exactly **5 minutes** of wall-clock training time — no matter what the agent changes (model size, batch size, architecture).
- The single metric is **val_bpb** (validation bits per byte) — lower is better, vocabulary-size-independent, so even architectural changes are fairly compared.
- By fixing the resource budget, all experiments become directly comparable, turning open-ended research into a well-defined optimization problem.

### 2. Minimal Attack Surface (Constrained Modification Space)

- The agent can **only modify one file**: `train.py`. Everything else (`prepare.py`, evaluation, data loading) is immutable.
- This keeps scope manageable, diffs reviewable, and prevents the agent from "cheating" (e.g., modifying the evaluation harness).
- Within that file, everything is fair game — architecture, optimizer, hyperparameters, batch size, model size.

### 3. Keep/Discard Hill Climbing (Greedy Search with Git)

- The experiment loop is greedy local search on the val_bpb landscape:
  - Make a change -> commit -> train -> evaluate
  - If val_bpb improved -> **keep** (advance the branch)
  - If val_bpb equal or worse -> **discard** (git reset back)
- Git branches serve as the "state" mechanism — the agent works on `autoresearch/<tag>` and the branch tip always represents the best-known configuration.
- `results.tsv` tracks every experiment (kept, discarded, or crashed) for post-hoc analysis.

### 4. Human Programs the Program, Not the Code

- The human writes **`program.md`** — instructions for the AI agent. This is meta-programming: you're programming the researcher, not the research.
- The `program.md` serves as a lightweight "skill" / system prompt for the agent.
- The iterate-able artifact is the research strategy itself, not the model code.

### 5. Never Stop (Full Autonomy)

- The agent is explicitly told: **"NEVER STOP"**. Don't ask the human if you should continue. The human might be asleep.
- If the agent runs out of ideas, it should think harder — read papers referenced in the code, re-read files for new angles, try combining previous near-misses, try more radical architectural changes.
- Designed for overnight/unattended operation (~12 experiments/hour, ~100 while sleeping).

### 6. Simplicity Criterion (Occam's Razor for Code)

- Not just "does it improve the metric?" but "is the complexity worth it?"
- A 0.001 improvement that adds 20 lines of hacky code? Probably not worth it.
- A 0.001 improvement from *deleting* code? Definitely keep.
- Equal performance but simpler code? Keep.
- This prevents the codebase from drifting into incomprehensible complexity over many iterations.

### 7. Self-Contained, Minimal Infrastructure

- One GPU, one file, one metric. No distributed training, no complex configs, no external services.
- Dependencies: just PyTorch + a few small packages.
- The entire setup fits in ~4 files, making it reproducible, forkable, and hackable.

## System Architecture

```
Human writes program.md (research strategy)
         |
         v
   +-------------------------------------+
   |  AI Agent reads program.md           |
   |  + train.py + prepare.py             |
   +------------------+------------------+
                      |
                      v
   +-------------------------------------+
   |  LOOP FOREVER:                       |
   |  1. Propose hypothesis/change        |
   |  2. Edit train.py                    |
   |  3. git commit                       |
   |  4. uv run train.py (5 min)          |
   |  5. Check val_bpb                    |
   |  6. Keep (advance) or                |
   |     Discard (git reset)              |
   |  7. Log to results.tsv               |
   +-------------------------------------+
                      |
                      v
   Human wakes up -> reviews results.tsv
   + progress.png + git log
```

## Project Structure

```
prepare.py      - Fixed constants, data prep + runtime utilities (do not modify)
train.py        - Model, optimizer, training loop (agent modifies this)
program.md      - Agent instructions (human modifies this)
pyproject.toml  - Dependencies
analysis.ipynb  - Post-hoc experiment analysis and visualization
```

## The Agent's Search Space

Looking at `train.py`, the search space is rich:

| Category | Examples |
|---|---|
| **Architecture** | GPT depth, width (aspect ratio), head dim, n_kv_heads, window patterns (sliding vs full attention), value embeddings, residual lambdas |
| **Optimizer** | Muon (for matrices) + AdamW (for embeddings), learning rates per parameter group, weight decay, momentum schedules, betas |
| **Training** | Batch size, gradient accumulation, warmup/warmdown schedules, softcap logit scaling |
| **Activations** | Currently ReLU-squared in MLP — could try SwiGLU, GELU, etc. |
| **Tricks** | RMSNorm, rotary embeddings, QK-norm, value residual (ResFormer), polar express orthogonalization |

## Designing Better Autonomous Research Systems

### 1. Better Search Strategies

- Current approach: greedy hill climbing (keep best, discard rest)
- Improvements: **population-based search** (maintain N parallel branches), **Bayesian optimization** over the hyperparameter space, **crossover** of successful experiments
- Track which *types* of changes tend to work and bias exploration toward those

### 2. Multi-Agent Architectures

Karpathy hints at this: *"how you'd add more agents to the mix"*

- **Proposer agent**: generates hypotheses from literature/past results
- **Implementer agent**: writes the code changes
- **Reviewer agent**: evaluates whether a change is worth the complexity
- **Strategist agent**: decides what to explore next based on results.tsv history

### 3. Smarter program.md Evolution

- The `program.md` is itself a target for optimization — meta-learning the research strategy
- A/B test different `program.md` variants and see which produces faster val_bpb improvement curves

### 4. Memory & Learning from History

- Currently each experiment is independent — the agent re-reads the code fresh
- Could build a **knowledge base** of what worked/failed: "increasing LR beyond 0.06 always crashes", "depth 12 > depth 8 when batch size < 64K"
- Turns the system from memoryless hill climbing into something that accumulates research intuition

### 5. Longer Time Horizons

- 5-minute runs optimize for fast-learning configurations
- Could add a **tournament stage**: promising changes get a longer 30-min validation run before being permanently kept

### 6. Automatic Ablation

- When the agent finds an improvement, automatically test which sub-component actually caused it
- Was it the LR change, or the architecture change, or both?

## The Deep Insight

The fundamental insight is the **separation of concerns**:

1. **The environment** (prepare.py, evaluation) is fixed and trusted
2. **The hypothesis space** (train.py) is fully open
3. **The research strategy** (program.md) is human-programmed but agent-executed
4. **The selection pressure** (val_bpb, keep/discard) is simple and automatic

This is essentially **evolution applied to ML research**: random variation (agent proposes changes) + selection (metric improves or it doesn't) + inheritance (git branch advances). The human's role becomes designing the fitness landscape and the mutation operators, not doing the research itself.
