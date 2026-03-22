"""Build a stratified sample of runs with full responses across all benchmarks."""
import json
from collections import defaultdict

DATA = "/Volumes/ssd/c/sair/data"
OUT = "/Volumes/ssd/c/sair/dashboard/public/data"

# Target: ~2000 runs total, spread across all benchmarks
PER_BENCHMARK = 500

benchmark_runs = defaultdict(list)

with open(f"{DATA}/benchmark_runs.jsonl") as f:
    for line in f:
        if not line.strip():
            continue
        row = json.loads(line)
        bm = row.get("benchmark_id", "")
        if len(benchmark_runs[bm]) < PER_BENCHMARK:
            benchmark_runs[bm].append(row)

sample = []
for bm, runs in sorted(benchmark_runs.items()):
    sample.extend(runs)
    print(f"{bm}: {len(runs)} runs")

with open(f"{OUT}/runs_sample.json", "w") as f:
    json.dump(sample, f)

print(f"\nTotal: {len(sample)} runs saved to runs_sample.json")
