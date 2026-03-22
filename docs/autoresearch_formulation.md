# AutoResearch Formulation for Equational Theories Competition

## Two-Level Optimization Architecture

This competition maps naturally to a two-level optimization system:

1. **Outer loop (AutoResearch)**: An agent modifies the DSPy module code — the pipeline structure, number of reasoning steps, what information to include, how to chain predictors.
2. **Inner loop (GEPA)**: Given a fixed DSPy module structure, GEPA automatically evolves the instructions inside each predictor using a strong reflection LLM.

The key insight: **the DSPy code IS the artifact being optimized, not a static prompt.txt.** GEPA handles instruction optimization within the code; the outer agent handles structural changes to the code itself.

## How DSPy and GEPA Work Together

### DSPy Module = Your Pipeline

You write Python code defining the reasoning pipeline:

```python
class EquationalSolver(dspy.Module):
    def __init__(self):
        # Each predictor gets its own instruction, optimized by GEPA
        self.analyze = dspy.ChainOfThought(
            "equation1, equation2 -> is_trivializing: bool, reasoning: str"
        )
        self.classify = dspy.Predict(
            "equation1, equation2, is_trivializing, reasoning -> verdict: bool"
        )

    def forward(self, equation1, equation2):
        analysis = self.analyze(equation1=equation1, equation2=equation2)
        return self.classify(
            equation1=equation1,
            equation2=equation2,
            is_trivializing=analysis.is_trivializing,
            reasoning=analysis.reasoning,
        )
```

This code defines the **structure** — two steps: analyze, then classify. GEPA optimizes the **instructions** within each step.

### GEPA = Evolutionary Instruction Optimizer

GEPA uses two LLMs with distinct roles:

| Role | LLM | Purpose |
|---|---|---|
| **reflection_lm** (master) | Strong model (Claude Opus, GPT-5) | Reflects on failures, proposes better instructions |
| **student** (task model) | Cheap model (Llama 8B, Gemini Flash Lite) | Executes the pipeline, gets evaluated |

The GEPA loop (from `gepa.py`):
1. Run the student on a minibatch of training problems
2. Capture traces — what each predictor received as input and produced as output
3. Score each trace against the metric (accuracy)
4. Build a **reflective dataset** — examples with inputs, outputs, and feedback ("This got score 0 because the model said FALSE but the answer was TRUE. The equation was trivializing because...")
5. The reflection_lm reads the reflective dataset and the current instruction, then proposes a better instruction
6. Evaluate the new instruction on a validation set
7. Keep if improved (Pareto-based selection), discard otherwise
8. Repeat — instructions evolve over generations

### What GEPA Optimizes

From `gepa.py` line 564:
```python
seed_candidate = {name: pred.signature.instructions for name, pred in student.named_predictors()}
```

GEPA optimizes the `instructions` string for each named predictor in your module. If your module has two predictors (`analyze` and `classify`), GEPA evolves two instruction strings independently, using feedback specific to each predictor.

### The Metric Function

GEPA's metric is richer than plain accuracy — it supports **textual feedback per predictor**:

```python
def metric(gold, pred, trace=None, pred_name=None, pred_trace=None):
    correct = (pred.verdict == gold.answer)
    if pred_name == "analyze":
        feedback = f"The equation {'was' if gold.answer else 'was not'} trivializing. "
        feedback += f"Model said is_trivializing={pred_trace[0][2].is_trivializing}."
    else:
        feedback = f"Expected {gold.answer}, got {pred.verdict}."
    return dspy.Prediction(score=float(correct), feedback=feedback)
```

This feedback is what the reflection_lm reads to understand what went wrong and propose better instructions.

## Mapping to AutoResearch Principles

### 1. Fixed Budget, Single Metric

| AutoResearch | Our Competition |
|---|---|
| 5 min wall-clock training | GEPA budget: `auto="medium"` (~12 generations) |
| val_bpb | **accuracy** on validation set (balanced 50/50 TRUE/FALSE) |

For the outer loop, each experiment = one GEPA run. For the inner loop, GEPA manages its own budget via `max_metric_calls` or `auto` setting.

### 2. Minimal Attack Surface

| What | Who Modifies | Role |
|---|---|---|
| `solver.py` (DSPy module code) | Outer agent | Pipeline structure, predictor signatures, chaining logic |
| Instructions inside predictors | GEPA (inner loop) | Automatically evolved via reflection |
| `evaluate.py` (metric + data) | Nobody — immutable | Scientific control |
| `program.md` | Human | Research strategy for the outer agent |

The outer agent modifies the DSPy module code (add/remove predictors, change signatures, restructure the pipeline). GEPA then optimizes instructions within that structure. `evaluate.py` is never touched.

### 3. Keep/Discard Hill Climbing

**Outer loop** (agent modifies DSPy code):
```
LOOP:
  1. Agent reads solver.py + results history + program.md
  2. Proposes structural change ("add a triviality-detection step before classification")
  3. Edits solver.py
  4. git commit
  5. Run GEPA: optimizes instructions within the new structure
  6. Evaluate best GEPA candidate on validation set
  7. If accuracy improved -> KEEP
     If same or worse -> DISCARD (git reset)
  8. Log to results.tsv
```

**Inner loop** (GEPA optimizes instructions):
```
For a fixed solver.py structure:
  1. Run student on minibatch, capture traces
  2. Score + generate feedback per predictor
  3. reflection_lm proposes new instructions based on feedback
  4. Evaluate on validation set
  5. Pareto selection — keep best candidates
  6. Repeat for N generations
  Return: best instruction set found
```

### 4. Human Programs the Program

`program.md` guides the **outer agent's** search strategy:
- What pipeline structures to explore (single-step vs multi-step, with/without triviality detection)
- What predictor signatures to try
- What cheatsheet content to inject as context
- When to try radical structural changes vs incremental refinements
- Constraints (10KB final output, must work on cheap models)

You update `program.md` when you want to steer the research direction — e.g., after reviewing results and seeing that two-step pipelines outperform single-step.

### 5. Never Stop

The outer loop runs overnight. Each iteration:
- Agent thinks + edits code: ~2 min
- GEPA optimization (`auto="light"`): ~10-20 min (depends on student model cost)
- Total: ~15-25 min per outer iteration, ~3-4 per hour, ~30-40 overnight

### 6. Simplicity Criterion

Applied at both levels:
- **Outer**: Simpler pipeline structures preferred (fewer predictors, cleaner signatures)
- **Inner**: GEPA naturally favors concise instructions (shorter instructions that achieve the same score)
- **Final**: The competition submission must be ≤10KB, so complexity is self-limiting

### 7. Self-Contained

```
solver.py           - DSPy module code (outer agent modifies this)
evaluate.py         - Metric + evaluation harness (immutable)
program.md          - Outer agent instructions (human updates occasionally)
results.tsv         - Experiment log (both outer loop and GEPA results)
data/               - Problem sets + reference data
gepa_logs/          - GEPA optimization logs, candidate programs, traces
```

## The Search Space

### Outer Agent (structural changes to solver.py)

| Category | Examples |
|---|---|
| **Pipeline structure** | Single predictor, two-step (analyze → classify), multi-step chains |
| **Predictor signatures** | What inputs/outputs each step receives (equation1, equation2, cheatsheet, intermediate analysis) |
| **Reasoning strategy** | `dspy.Predict` (direct), `dspy.ChainOfThought` (with reasoning), custom chains |
| **Context injection** | What cheatsheet/reference data to include as input fields |
| **Output format** | How the final verdict is extracted and parsed |

### GEPA (instruction optimization within fixed structure)

| Category | What GEPA evolves |
|---|---|
| **Per-predictor instructions** | The natural language instruction for each `dspy.Predict` or `dspy.ChainOfThought` |
| **Instruction style** | Concise vs detailed, algorithmic vs narrative, with/without examples |
| **Domain knowledge** | What mathematical concepts to emphasize in instructions |
| **Error prevention** | Instructions that address specific failure modes seen in feedback |

## Concrete Example: Full Pipeline

```python
# solver.py — the outer agent writes and modifies this

import dspy

class EquationalSolver(dspy.Module):
    """Determine if equation1 implies equation2 over all magmas."""

    def __init__(self):
        self.solve = dspy.ChainOfThought(
            "equation1: str, equation2: str, cheatsheet: str -> verdict: bool"
        )

    def forward(self, equation1, equation2):
        cheatsheet = open("cheatsheet.txt").read()  # ≤10KB of reference material
        result = self.solve(
            equation1=equation1,
            equation2=equation2,
            cheatsheet=cheatsheet,
        )
        return result

# evaluate.py — immutable

def metric(gold, pred, trace=None, pred_name=None, pred_trace=None):
    correct = (pred.verdict == gold.answer)
    if not correct:
        feedback = f"Wrong. Expected {'TRUE' if gold.answer else 'FALSE'}. "
        feedback += f"Equation 1: {gold.equation1}, Equation 2: {gold.equation2}."
    else:
        feedback = "Correct."
    return dspy.Prediction(score=float(correct), feedback=feedback)

# run_gepa.py — the optimization script

student_lm = dspy.LM("openai/gpt-5-nano", temperature=0.0)  # cheap eval model
reflection_lm = dspy.LM("anthropic/claude-opus-4-6", temperature=1.0, max_tokens=32000)

dspy.configure(lm=student_lm)

optimizer = dspy.GEPA(
    metric=metric,
    reflection_lm=reflection_lm,
    auto="medium",
    track_stats=True,
    log_dir="gepa_logs/",
)

trainset = [dspy.Example(equation1=p["equation1"], equation2=p["equation2"],
                          answer=p["answer"]).with_inputs("equation1", "equation2")
            for p in load_problems("train")]

valset = [dspy.Example(equation1=p["equation1"], equation2=p["equation2"],
                        answer=p["answer"]).with_inputs("equation1", "equation2")
          for p in load_problems("val")]

optimized = optimizer.compile(EquationalSolver(), trainset=trainset, valset=valset)
optimized.save("best_solver.json")
```

## Exporting to Competition Format

After GEPA finds the best instructions, we need to export the optimized DSPy program to a flat prompt template (≤10KB) for the competition submission:

```python
# export.py — converts optimized DSPy program to competition submission format
optimized = EquationalSolver()
optimized.load("best_solver.json")

# Extract the optimized instruction
instruction = optimized.solve.signature.instructions

# Build the competition prompt template
template = f"""You are a mathematician specializing in equational theories of magmas.
Your task is to determine whether Equation 1 ({{{{ equation1 }}}}) implies Equation 2 ({{{{ equation2 }}}}) over all magmas.

{instruction}

{open("cheatsheet.txt").read()}

Output format:
VERDICT: must be exactly TRUE or FALSE
REASONING: must be non-empty
"""

with open("submission_prompt.txt", "w") as f:
    f.write(template)
print(f"Submission size: {len(template)} bytes")
```

## Key Differences from Original AutoResearch

1. **Two-level optimization** — outer agent modifies code structure, GEPA optimizes instructions within
2. **Master/student LLM split** — strong model (reflection_lm) teaches cheap model (student) via evolved instructions
3. **Feedback-driven** — GEPA uses per-predictor textual feedback, not just a scalar metric
4. **Evolutionary search** — GEPA uses Pareto-based selection and merging, not greedy hill climbing
5. **Size constraint** — final submission must be ≤10KB, so the export step compresses the optimized program
6. **Generalization** — eval set differs from training; GEPA's train/val split helps prevent overfitting
