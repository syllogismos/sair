"""Export cheatsheet.txt to competition submission format.

The competition expects a Jinja2 template with {{ equation1 }} and {{ equation2 }}.

Usage:
    uv run export.py
    uv run export.py --cheatsheet best_cheatsheet.txt --output my_submission.txt
"""

import argparse
from pathlib import Path

MAX_SUBMISSION_BYTES = 10 * 1024  # 10KB competition limit

TEMPLATE_PREFIX = """You are a mathematician specializing in universal algebra.
You are given two equations over magmas (sets with a single binary operation *).
Determine whether Equation 1 ({{ equation1 }}) implies Equation 2 ({{ equation2 }}).
That is, does every magma satisfying Equation 1 necessarily satisfy Equation 2?

"""

TEMPLATE_SUFFIX = """

Equation 1: {{ equation1 }}
Equation 2: {{ equation2 }}

Analyze step by step, then give your verdict.

VERDICT: TRUE or FALSE
REASONING: [your reasoning]"""


def build_submission_template(cheatsheet: str) -> str:
    """Build the Jinja2 submission template with cheatsheet inlined."""
    return TEMPLATE_PREFIX + cheatsheet + TEMPLATE_SUFFIX


def main():
    parser = argparse.ArgumentParser(description="Export cheatsheet to competition submission")
    parser.add_argument("--cheatsheet", default="cheatsheet.txt", help="Path to cheatsheet file")
    parser.add_argument("--output", default="submission.txt", help="Output submission path")
    args = parser.parse_args()

    cheatsheet_path = Path(args.cheatsheet)
    if not cheatsheet_path.exists():
        print(f"ERROR: {args.cheatsheet} not found")
        return 1

    cheatsheet = cheatsheet_path.read_text(encoding="utf-8")
    template = build_submission_template(cheatsheet)

    size = len(template.encode("utf-8"))
    print(f"Cheatsheet:  {len(cheatsheet.encode('utf-8'))} bytes")
    print(f"Template:    {size} bytes ({size / 1024:.1f} KB)")

    if size > MAX_SUBMISSION_BYTES:
        over = size - MAX_SUBMISSION_BYTES
        print(f"WARNING: Exceeds 10KB limit by {over} bytes!")
    else:
        remaining = MAX_SUBMISSION_BYTES - size
        print(f"Under limit: {remaining} bytes remaining")

    Path(args.output).write_text(template, encoding="utf-8")
    print(f"Written to:  {args.output}")


if __name__ == "__main__":
    main()
