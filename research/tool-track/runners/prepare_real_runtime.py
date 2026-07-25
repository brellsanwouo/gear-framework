#!/usr/bin/env python3
"""Create an isolated environment for the pinned RQ5 real-runtime study."""

from __future__ import annotations

import argparse
import subprocess
import sys
import venv
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
TOOL_TRACK_ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--venv",
        type=Path,
        default=REPOSITORY_ROOT / ".gear" / "research-real-runtime",
    )
    args = parser.parse_args()
    destination = args.venv.resolve()
    if not (destination / "bin" / "python").is_file():
        destination.parent.mkdir(parents=True, exist_ok=True)
        venv.EnvBuilder(with_pip=True, clear=False).create(destination)
    python = destination / "bin" / "python"
    subprocess.run(
        [str(python), "-m", "pip", "install", "--upgrade", "pip"],
        check=True,
        cwd=REPOSITORY_ROOT,
    )
    subprocess.run(
        [str(python), "-m", "pip", "install", "-e", str(REPOSITORY_ROOT)],
        check=True,
        cwd=REPOSITORY_ROOT,
    )
    subprocess.run(
        [
            str(python),
            "-m",
            "pip",
            "install",
            "--requirement",
            str(TOOL_TRACK_ROOT / "runtime-requirements.txt"),
        ],
        check=True,
        cwd=REPOSITORY_ROOT,
    )
    print(f"RQ5 real-runtime environment ready: {python}")
    print(f"Run: {python} research/tool-track/runners/run_real_runtime_benchmark.py --quick")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
