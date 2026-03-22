# autoresearch: cheatsheet optimization

This is an experiment to have the LLM autonomously optimize a cheatsheet for the SAIR Mathematics Distillation Challenge — Equational Theories (Stage 1).

## Setup

To set up a new experiment run, work with the user to:

1. **Agree on a run tag**: propose a tag based on today's date (e.g., `mar22`). The branch `autoresearch/<tag>` must not already exist.
2. **Create the branch**: `git checkout -b autoresearch/<tag>` from current state.
3. **Read the in-scope files**: The repo is small. Read these files for full context:
   - `program.md` — these instructions (do not modify)
   - `prepare.py` — fixed constants, data loading, sampling (do not modify)
   - `evaluate.py` — fixed evaluation harness (do not modify)
   - `cheatsheet.txt` — **the file you optimize**. Your only output.
4. **Verify data exists**: Check that `../data/problems_normal.jsonl` exists.
5. **Establish baseline**: Run `uv run evaluate.py > run.log 2>&1` with the current cheatsheet. Record in results.tsv.
6. **Initialize results.tsv**: Create with the header row. The baseline is the first entry.
7. **Confirm and go**: Confirm setup looks good.

Once you get confirmation, kick off the experimentation.

## The Optimization Target

You are optimizing `cheatsheet.txt` — a plain text file (≤9,500 bytes UTF-8) that is injected into the system prompt when a weak LLM answers TRUE/FALSE questions about equational implications over magmas.

**The problem**: Given two equations over magmas (e.g., `x = x * (y * z)` and `x * y = y * x`), determine: does Equation 1 imply Equation 2 over all magmas?

**Your goal: maximize accuracy on the eval set.**

## What you CAN do

- Edit `cheatsheet.txt` — this is the ONLY file you modify. Everything about its content is fair game: structure, algorithms, examples, heuristics, lookup tables, decision trees.
- Read any file in this directory or `../data/`
- Read `../data/equations.txt` (all 4,694 equational laws) for insight
- Read `../data/problems_*.jsonl` for problem patterns
- Use `--verbose` flag on evaluate.py to see individual problem results
- Use `--subset hard2` to focus on the harder problems

## What you CANNOT do

- Modify `prepare.py`, `evaluate.py`, `export.py`, or `program.md`
- Install new packages or add dependencies
- Modify the evaluation harness or scoring logic
- Exceed 9,500 bytes in cheatsheet.txt

## Experimentation

Each evaluation runs against a fixed sample of 100 balanced problems (50 TRUE, 50 FALSE). The sampling is deterministic (seed=42), so comparisons are fair.

The evaluation is launched as: `uv run evaluate.py`

**Simplicity criterion**: All else being equal, shorter cheatsheet = better. A 0.72 score in 4KB beats 0.72 in 9KB. But 0.75 in 9KB beats 0.72 in 4KB. Every byte must earn its place.

## Output format

After `uv run evaluate.py`, the script prints:

```
---
accuracy:         0.620
total_problems:   100
correct:          62
true_accuracy:    0.640
false_accuracy:   0.600
unparsed:         0
cheatsheet_bytes: 4523
eval_seconds:     45.2
model:            vertex_ai/gemini-2.0-flash-lite
```

Extract the key metric: `grep "^accuracy:" run.log`

## Logging results

When an experiment is done, log it to `results.tsv` (tab-separated, NOT comma-separated).

The TSV has a header row and 5 columns:

```
commit	accuracy	cheatsheet_kb	status	description
```

1. git commit hash (short, 7 chars)
2. accuracy achieved (e.g., 0.620) — use 0.000 for errors
3. cheatsheet size in KB, 1 decimal (e.g., 2.4)
4. status: `keep`, `discard`, or `error`
5. short text description of what this experiment tried

Example:

```
commit	accuracy	cheatsheet_kb	status	description
a1b2c3d	0.540	2.4	keep	baseline
b2c3d4e	0.600	3.1	keep	added worked examples
c3d4e5f	0.580	4.2	discard	added equation lookup table
d4e5f6g	0.000	5.8	error	cheatsheet too large for context
```

## The experiment loop

The experiment runs on a dedicated branch (e.g., `autoresearch/mar22`).

LOOP FOREVER:

1. Read current `cheatsheet.txt` and `results.tsv` — understand what's been tried
2. Form a hypothesis about how to improve the cheatsheet
3. Edit `cheatsheet.txt`
4. git commit
5. Run the experiment: `uv run evaluate.py > run.log 2>&1` (redirect everything — do NOT use tee or let output flood your context)
6. Read out the results: `grep "^accuracy:\|^true_accuracy:\|^false_accuracy:" run.log`
7. If the grep output is empty, something crashed. Run `tail -30 run.log` to read the error and fix.
8. Record the results in the tsv (NOTE: do not commit results.tsv, leave it untracked)
9. If accuracy improved (higher) → **keep**, advance the branch
10. If accuracy is equal or worse → **discard**, revert: `git checkout cheatsheet.txt`

**Timeout**: Each evaluation should take ~30-60 seconds. If a run exceeds 5 minutes, kill it and treat as an error.

**Crashes**: If a run crashes (API error, parse issue, etc.), fix if simple. Otherwise log "error" and move on.

## Strategy hints

**Priority 1 — Trivializing detection**: Weak models default to FALSE. The cheatsheet MUST teach them to recognize trivializing equations (the main source of TRUE answers). This is the single biggest accuracy lever.

**Priority 2 — Counterexample library**: For FALSE cases, provide concrete small magmas (2-3 elements) that the model can test mentally.

**Priority 3 — Information density**: Every byte counts. Compress rules. Use tables instead of prose. Remove redundancy. The model reads every token — noise hurts.

**Approaches to try**:
- Algorithmic decision procedures (step-by-step instructions)
- Worked examples (3-5 solved problems inline)
- Compact lookup tables (equation patterns → TRUE/FALSE heuristics)
- Variable counting rules (equations with ≥4 vars that look like "x = f(y,z,w)" are usually trivializing)
- Specific equation family rules
- Combining approaches in labeled sections
- Removing content that doesn't help (simplification wins)
- Restructuring the same content (order matters for LLMs)

**Analyze failures**: After a run, use `uv run evaluate.py --verbose > run_verbose.log 2>&1` to see which problems fail. Look for patterns: are failures concentrated in TRUE or FALSE? Which equation structures cause errors? Use this to guide the next edit.

**Deeper analysis**: Periodically run `uv run evaluate.py --full --verbose > run_full.log 2>&1` to check performance on all 1,269 problems (takes longer). This helps catch overfitting to the 100-problem sample.

## NEVER STOP

Once the experiment loop has begun (after the initial setup), do NOT pause to ask the human if you should continue. Do NOT ask "should I keep going?" or "is this a good stopping point?". The human might be asleep, or gone from a computer and expects you to continue working *indefinitely* until you are manually stopped. You are autonomous. If you run out of ideas, think harder:
- Re-read the problem files for equation patterns
- Read `../data/equations.txt` for structural insights
- Try radically different cheatsheet formats
- Combine near-miss approaches from results.tsv
- Try removing content (simplification experiments)
- Try different orderings of the same content
- Focus on the weaker accuracy (TRUE vs FALSE) to balance performance

The loop runs until the human interrupts you, period.
