"""CLI for running the reproducible S4A scenario model."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .model import ModelInputError, evaluate_bundle, json_safe


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path, help="scenario bundle JSON")
    parser.add_argument("--output", type=Path, help="write machine-readable result JSON")
    args = parser.parse_args(argv)
    try:
        bundle = json.loads(args.input.read_text(encoding="utf-8"))
        result = json.dumps(json_safe(evaluate_bundle(bundle)), indent=2, sort_keys=True) + "\n"
    except (OSError, json.JSONDecodeError, ModelInputError) as exc:
        print(f"economics model: {exc}", file=sys.stderr)
        return 2
    if args.output:
        args.output.write_text(result, encoding="utf-8")
    else:
        sys.stdout.write(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
