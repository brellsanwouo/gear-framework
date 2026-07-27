#!/usr/bin/env python3
"""Display token usage and estimated cost for one MLflow trace."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


# Allow execution from the repository without installing the package first.
_REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
if str(_REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPOSITORY_ROOT))

from gear_web.services.observability import summarize_trace_usage  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Read an MLflow trace and print its LLM token/cost summary as JSON."
    )
    parser.add_argument("trace_id", help="MLflow trace ID, for example tr-abc123...")
    parser.add_argument(
        "--tracking-uri",
        default=os.environ.get("MLFLOW_TRACKING_URI", ""),
        help="MLflow tracking URI; defaults to MLFLOW_TRACKING_URI.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    tracking_uri = args.tracking_uri.strip()
    if not tracking_uri:
        print(
            "Missing tracking URI. Set MLFLOW_TRACKING_URI or pass --tracking-uri.",
            file=sys.stderr,
        )
        return 2

    try:
        import mlflow

        mlflow.set_tracking_uri(tracking_uri)
        trace = mlflow.get_trace(trace_id=args.trace_id)
        if trace is None:
            print(f"Trace not found: {args.trace_id}", file=sys.stderr)
            return 1
        print(
            json.dumps(
                summarize_trace_usage(trace, args.trace_id),
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0
    except Exception as error:
        print(f"Unable to read MLflow trace {args.trace_id}: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
