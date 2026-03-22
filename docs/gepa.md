# Strategy: DSPy + GEPA for Equational Theories Competition

## Overview

We use DSPy with GEPA (its built-in evolutionary optimizer) to optimize a prompt that helps cheap LLMs determine whether one equational law implies another over magmas. GEPA evolves instructions using a strong reflection model (Claude Opus 4.6) to teach a cheap student model (on Vertex AI).

## Architecture

```
                    GEPA Optimization Loop (via DSPy)
                    ---------------------------------
  reflection_lm (Opus 4.6 via Claude Code auth)
       |
       |  reads failures + reference solutions from traces,
       |  proposes better instructions
       v
  DSPy Module (solver.py)
       |
       |  runs with evolved instructions
       v
  student_lm (cheap model on Vertex AI via gcloud credits)
       |
       |  evaluated on problems
       v
  metric (accuracy + feedback with reference solutions from benchmark traces)
       |
       |  feedback flows back to reflection_lm
       v
  repeat for N generations → export best as ≤10KB submission
```

## LLM Setup

| Role | Model | Auth | Cost |
|---|---|---|---|
| **reflection_lm** | Claude Opus 4.6 | Claude Code auth token | Free (included in subscription) |
| **student_lm** | Cheap model on Vertex AI (Gemini Flash Lite, Llama, etc.) | gcloud credits | Minimal per-problem cost |

We need to figure out:
- How to expose Claude Code's Opus 4.6 as a DSPy LM (likely via Anthropic API with the auth token)
- How to launch a cheap model on Vertex AI and connect it as the DSPy student LM
- Alternatively, use Gemini models directly through Vertex AI for both reflection and student (if we want to conserve the Claude Code token for other work)

## Using the Benchmark Traces

The competition provides 60,000 runs across 25 models with full responses on the same public problems we already have (200 normal + 200 hard). Two concrete uses in our pipeline:

### 1. Reference solutions in GEPA's feedback function

When the student model gets a problem wrong, the reflection_lm needs to understand what went wrong and propose a better instruction. We pre-index the best correct response from the traces for each problem. When the student fails, the feedback includes that actual correct solution, so the reflection_lm has a concrete reference to learn from when proposing new instructions.

```python
# Pre-index: for each problem, store the best correct response from the traces
correct_responses = {}
for run in all_runs:
    if run["correct"] and run["problem_id"] not in correct_responses:
        correct_responses[run["problem_id"]] = run["response"]

def metric(gold, pred, trace=None, pred_name=None, pred_trace=None):
    correct = (pred.verdict == gold.answer)
    if not correct:
        ref = correct_responses.get(gold.id, "")
        feedback = f"Wrong. Expected {'TRUE' if gold.answer else 'FALSE'}. "
        if ref:
            feedback += f"A correct solution for this problem:\n{ref}"
    else:
        feedback = "Correct."
    return dspy.Prediction(score=float(correct), feedback=feedback)
```

### 2. Pre-bootstrapped few-shot demonstrations

GEPA normally bootstraps few-shot examples by running the student and keeping correct outputs. We can skip that cost by pre-filtering correct responses from cheap models (Llama 8B, Gemini Flash Lite) in the traces and feeding them directly as bootstrapped demos.

## DSPy Module Design

Start simple, iterate based on GEPA results:

### v1: Single predictor (baseline)

```python
class EquationalSolver(dspy.Module):
    def __init__(self):
        self.solve = dspy.ChainOfThought(
            "equation1: str, equation2: str -> verdict: bool"
        )

    def forward(self, equation1, equation2):
        return self.solve(equation1=equation1, equation2=equation2)
```

### v2: With cheatsheet context

```python
class EquationalSolver(dspy.Module):
    def __init__(self, cheatsheet: str):
        self.cheatsheet = cheatsheet
        self.solve = dspy.ChainOfThought(
            "equation1: str, equation2: str, reference: str -> verdict: bool"
        )

    def forward(self, equation1, equation2):
        return self.solve(
            equation1=equation1,
            equation2=equation2,
            reference=self.cheatsheet,
        )
```

### v3: Two-step (analyze then classify)

```python
class EquationalSolver(dspy.Module):
    def __init__(self, cheatsheet: str):
        self.cheatsheet = cheatsheet
        self.analyze = dspy.ChainOfThought(
            "equation1: str, equation2: str, reference: str -> analysis: str"
        )
        self.classify = dspy.Predict(
            "equation1: str, equation2: str, analysis: str -> verdict: bool"
        )

    def forward(self, equation1, equation2):
        analysis = self.analyze(
            equation1=equation1,
            equation2=equation2,
            reference=self.cheatsheet,
        )
        return self.classify(
            equation1=equation1,
            equation2=equation2,
            analysis=analysis.analysis,
        )
```

We try each structure, run GEPA, compare results, pick the best.

## Observability

We need to see what's happening during GEPA optimization at the per-equation, per-LLM-call level, including costs. DSPy provides the hooks natively:

### What DSPy gives us

1. **`BaseCallback`** — hooks into every LLM call (`on_lm_start`/`on_lm_end`) and every module call. The `on_lm_end` handler receives the full output including token usage.

2. **`dspy.track_usage()`** — context manager that accumulates `prompt_tokens` and `completion_tokens` per model across all calls within the context.

3. **`LM.history`** — every LM instance stores its call history (messages sent, responses received).

### What GEPA gives us

1. **`log_dir`** — GEPA saves all candidate programs, traces, and checkpoints to this directory. Running with the same `log_dir` resumes from checkpoint.

2. **`track_stats=True`** — returns `detailed_results` on the optimized program containing all candidates, their scores, per-instance subscores, parent lineage, and discovery order.

### Our observability plan

Write a `BaseCallback` that logs every LLM call to SQLite, tagged with context about what GEPA is doing. Then extend our existing dashboard to show it.

```python
import time
import sqlite3
from dspy.utils.callback import BaseCallback

class GEPAObserver(BaseCallback):
    """Logs every LLM call during GEPA optimization to SQLite."""

    def __init__(self, db_path: str):
        self.db = sqlite3.connect(db_path)
        self.db.execute("""
            CREATE TABLE IF NOT EXISTS llm_calls (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp REAL,
                call_id TEXT,
                model TEXT,
                role TEXT,           -- 'student' or 'reflection'
                equation1 TEXT,
                equation2 TEXT,
                prompt_tokens INTEGER,
                completion_tokens INTEGER,
                cost_usd REAL,
                duration_secs REAL,
                generation INTEGER,  -- GEPA generation number
                candidate_idx INTEGER,
                correct INTEGER,
                response_preview TEXT
            )
        """)
        self.db.commit()
        self._call_starts = {}
        self.generation = 0

    def on_lm_start(self, call_id, instance, inputs):
        self._call_starts[call_id] = {
            "time": time.time(),
            "model": getattr(instance, "model", "unknown"),
            "messages": inputs.get("messages", []),
        }

    def on_lm_end(self, call_id, outputs, exception=None):
        if call_id not in self._call_starts:
            return
        start = self._call_starts.pop(call_id)
        duration = time.time() - start["time"]

        # Extract token usage from outputs
        usage = {}
        if outputs and "usage" in outputs:
            usage = outputs["usage"]
        prompt_tokens = usage.get("prompt_tokens", 0)
        completion_tokens = usage.get("completion_tokens", 0)

        # Estimate cost (model-specific rates would go here)
        cost = self._estimate_cost(start["model"], prompt_tokens, completion_tokens)

        # Determine role based on model name
        role = "reflection" if "opus" in start["model"] or "gpt-5" in start["model"] else "student"

        # Extract equation context from messages if present
        eq1, eq2 = self._extract_equations(start["messages"])

        # Response preview
        response_preview = ""
        if outputs and isinstance(outputs, list) and len(outputs) > 0:
            response_preview = str(outputs[0])[:500]

        self.db.execute(
            """INSERT INTO llm_calls
               (timestamp, call_id, model, role, equation1, equation2,
                prompt_tokens, completion_tokens, cost_usd, duration_secs,
                generation, response_preview)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (start["time"], call_id, start["model"], role, eq1, eq2,
             prompt_tokens, completion_tokens, cost, duration,
             self.generation, response_preview),
        )
        self.db.commit()

    def _extract_equations(self, messages):
        """Try to extract equation1/equation2 from the prompt messages."""
        text = str(messages)
        eq1, eq2 = None, None
        # Simple extraction — look for equation patterns in the message text
        # This will be refined once we know the exact prompt format
        for msg in messages if isinstance(messages, list) else []:
            content = msg.get("content", "") if isinstance(msg, dict) else str(msg)
            if "equation1" in content.lower() or "equation 1" in content.lower():
                eq1 = content[:200]  # crude, will refine
            if "equation2" in content.lower() or "equation 2" in content.lower():
                eq2 = content[:200]
        return eq1, eq2

    def _estimate_cost(self, model, prompt_tokens, completion_tokens):
        """Rough cost estimation per model. Update with actual rates."""
        rates = {
            # (input_per_1M, output_per_1M)
            "vertex_ai/gemini-2.0-flash-lite": (0.075, 0.30),
            "anthropic/claude-opus-4-6": (15.0, 75.0),
        }
        input_rate, output_rate = rates.get(model, (1.0, 3.0))
        return (prompt_tokens * input_rate + completion_tokens * output_rate) / 1_000_000
```

### Usage during GEPA optimization

```python
observer = GEPAObserver(db_path="gepa_observations.db")

dspy.configure(
    lm=student_lm,
    callbacks=[observer],
)

optimizer = dspy.GEPA(
    metric=metric,
    reflection_lm=reflection_lm,
    auto="medium",
    track_stats=True,
    log_dir="gepa_logs/",
)

with dspy.track_usage() as usage:
    optimized = optimizer.compile(solver, trainset=trainset, valset=valset)

# After optimization, print total costs
print(usage.get_total_tokens())
```

### Dashboard extension

Add an API route and tab to the existing dashboard that queries `gepa_observations.db`:
- **Per-generation view**: How many LLM calls, total cost, accuracy improvement
- **Per-equation view**: Click an equation pair, see every LLM call made for it across generations
- **Cost breakdown**: Student vs reflection costs, cumulative spend over time
- **Live view**: Auto-refresh during optimization to watch progress

This keeps it clean — one row per LLM call, tagged with which equation and which role (student/reflection). No clutter.

## Exporting to Competition Format

After GEPA finds the best instructions, export to a flat ≤10KB prompt:

```python
optimized = EquationalSolver()
optimized.load("best_solver.json")

# Extract optimized instruction(s)
instructions = {name: pred.signature.instructions
                for name, pred in optimized.named_predictors()}

# Build competition template with {{ equation1 }} and {{ equation2 }} placeholders
# Ensure total size ≤ 10KB
# Test in the competition playground before submitting
```

## Data Split

From the 1,269 public problems:
- **Train** (for GEPA reflection): ~800 problems
- **Val** (for GEPA scoring/selection): ~200 problems
- **Holdout** (final sanity check): ~269 problems

Balance TRUE/FALSE in each split. Include a mix of normal and hard problems in train.

## Immediate Next Steps

1. Set up DSPy with Claude Opus 4.6 as reflection_lm
2. Set up a cheap student model on Vertex AI
3. Build the metric function with reference solutions from benchmark traces
4. Build the GEPAObserver callback and wire it into the dashboard
5. Run GEPA on v1 (single predictor, no cheatsheet) as baseline
6. Iterate on module structure and cheatsheet content
