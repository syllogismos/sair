"""Extract GEPA state bin data as JSON for the dashboard replay animation.

Usage:
    python src/extract_gepa_state.py gepa_logs/e79eb24037e1/gepa_state.bin
    python src/extract_gepa_state.py gepa_logs/e79eb24037e1/gepa_state.bin -o replay_data.json
"""
import argparse
import json
import pickle
import sys
from pathlib import Path


def extract_gepa_state(bin_path: str) -> dict:
    with open(bin_path, "rb") as f:
        state = pickle.load(f)

    # Candidate instructions (list of dicts: {predictor_name: instruction_text})
    candidates = []
    for c in state["program_candidates"]:
        if isinstance(c, dict):
            candidates.append(c)
        elif hasattr(c, "named_predictors"):
            candidates.append(
                {name: str(pred.signature.instructions) for name, pred in c.named_predictors()}
            )
        else:
            candidates.append({"unknown": str(c)[:500]})

    # Val subscores per candidate: {candidate_idx: {val_idx: score}}
    val_subscores = []
    for subscores in state["prog_candidate_val_subscores"]:
        # Convert int keys to strings for JSON
        val_subscores.append({str(k): v for k, v in subscores.items()})

    # Aggregate scores per candidate
    aggregate_scores = []
    for subscores in state["prog_candidate_val_subscores"]:
        total = sum(subscores.values())
        n = len(subscores)
        aggregate_scores.append(round(total / n, 4) if n > 0 else 0)

    # Parents
    parents = state["parent_program_for_candidate"]

    # Discovery metric calls
    discovery_calls = state["num_metric_calls_by_discovery"]

    # Full program trace (the iteration-by-iteration log)
    trace = []
    for entry in state["full_program_trace"]:
        t = {}
        for k, v in entry.items():
            if k == "evaluated_val_indices":
                t[k] = len(v)  # Just the count, not the full list
            elif isinstance(v, (set, frozenset)):
                t[k] = sorted(v)
            else:
                t[k] = v
        trace.append(t)

    # Pareto front: val_idx -> list of best candidate indices
    pareto_front = {}
    pf = state.get("program_at_pareto_front_valset", {})
    for val_idx, cand_set in pf.items():
        if isinstance(cand_set, (set, frozenset)):
            pareto_front[str(val_idx)] = sorted(cand_set)
        elif isinstance(cand_set, list):
            pareto_front[str(val_idx)] = sorted(cand_set)
        else:
            pareto_front[str(val_idx)] = [cand_set]

    # Pareto front scores
    pareto_scores = {}
    pfs = state.get("pareto_front_valset", {})
    for val_idx, score in pfs.items():
        pareto_scores[str(val_idx)] = score

    # Compute per-candidate Pareto dominance count
    pareto_dominance = [0] * len(candidates)
    for cand_list in pareto_front.values():
        for cand_idx in cand_list:
            if cand_idx < len(pareto_dominance):
                pareto_dominance[cand_idx] += 1

    return {
        "num_candidates": len(candidates),
        "num_iterations": state.get("i", len(trace)),
        "total_metric_calls": state.get("total_num_evals", 0),
        "num_val_instances": len(state["prog_candidate_val_subscores"][0]) if state["prog_candidate_val_subscores"] else 0,
        "candidates": candidates,
        "aggregate_scores": aggregate_scores,
        "parents": parents,
        "discovery_calls": discovery_calls,
        "val_subscores": val_subscores,
        "trace": trace,
        "pareto_front": pareto_front,
        "pareto_scores": pareto_scores,
        "pareto_dominance": pareto_dominance,
    }


def main():
    parser = argparse.ArgumentParser(description="Extract GEPA state bin as JSON")
    parser.add_argument("bin_path", help="Path to gepa_state.bin")
    parser.add_argument("-o", "--output", default=None, help="Output JSON path (default: stdout)")
    args = parser.parse_args()

    data = extract_gepa_state(args.bin_path)

    if args.output:
        Path(args.output).write_text(json.dumps(data, indent=2, default=str))
        print(f"Written to {args.output}", file=sys.stderr)
    else:
        json.dump(data, sys.stdout, indent=2, default=str)


if __name__ == "__main__":
    main()
