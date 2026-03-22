"""Export optimized DSPy solver to a competition submission prompt (<=10KB).

Usage:
    python src/export.py --solver-path optimized_solver.json --output submission.txt
"""
import argparse
from pathlib import Path

import dspy

from solver import SolverV1, SolverV2, SolverV3

MAX_SIZE = 10 * 1024  # 10KB


def export_submission(solver_path: str, solver_version: str, output_path: str, cheatsheet_path: str | None = None):
    # Load the optimized solver
    if solver_version == "v1":
        solver = SolverV1()
    elif solver_version == "v2":
        solver = SolverV2()
    elif solver_version == "v3":
        solver = SolverV3()
    else:
        raise ValueError(f"Unknown solver version: {solver_version}")

    solver.load(solver_path)

    # Extract optimized instructions
    instructions = {}
    for name, pred in solver.named_predictors():
        instructions[name] = pred.signature.instructions

    # Build the submission template
    # Uses Jinja2 placeholders {{ equation1 }} and {{ equation2 }} as required by competition
    parts = []

    parts.append("You are a mathematician specializing in equational theories of magmas.")
    parts.append(f"Your task is to determine whether Equation 1 ({{{{ equation1 }}}}) implies Equation 2 ({{{{ equation2 }}}}) over all magmas.")
    parts.append("")

    # Add cheatsheet if provided
    if cheatsheet_path:
        cheatsheet = Path(cheatsheet_path).read_text().strip()
        parts.append(cheatsheet)
        parts.append("")

    # Add the optimized instructions
    for name, inst in instructions.items():
        parts.append(inst.strip())
        parts.append("")

    parts.append("Output format (use exact headers without any additional text or formatting):")
    parts.append("VERDICT: must be exactly TRUE or FALSE (in the same line).")
    parts.append("REASONING: must be non-empty.")

    template = "\n".join(parts)

    # Check size
    size = len(template.encode("utf-8"))
    print(f"Submission size: {size} bytes ({size / 1024:.1f} KB)")
    if size > MAX_SIZE:
        print(f"WARNING: Exceeds 10KB limit by {size - MAX_SIZE} bytes!")
    else:
        print(f"Under limit by {MAX_SIZE - size} bytes")

    # Write
    Path(output_path).write_text(template)
    print(f"Written to: {output_path}")
    print(f"\nPreview (first 500 chars):\n{template[:500]}")


def main():
    parser = argparse.ArgumentParser(description="Export optimized solver to competition submission")
    parser.add_argument("--solver-path", required=True, help="Path to optimized_solver.json")
    parser.add_argument("--solver-version", default="v1", choices=["v1", "v2", "v3"])
    parser.add_argument("--output", default="submission.txt")
    parser.add_argument("--cheatsheet", default=None, help="Path to cheatsheet file")
    args = parser.parse_args()

    export_submission(args.solver_path, args.solver_version, args.output, args.cheatsheet)


if __name__ == "__main__":
    main()
