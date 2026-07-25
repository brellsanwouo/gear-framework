from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
RUNNER = (
    REPOSITORY_ROOT
    / "research"
    / "tool-track"
    / "runners"
    / "run_real_runtime_benchmark.py"
)


def test_pinned_real_runtime_fidelity(tmp_path):
    python = os.environ.get("GEAR_REAL_RUNTIME_PYTHON")
    if not python:
        pytest.skip("Set GEAR_REAL_RUNTIME_PYTHON to the pinned research environment interpreter.")
    completed = subprocess.run(
        [python, str(RUNNER), "--quick", "--output", str(tmp_path / "result")],
        cwd=REPOSITORY_ROOT,
        capture_output=True,
        text=True,
        check=False,
        timeout=60,
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr
    raw = json.loads(
        (tmp_path / "result" / "real-runtime-raw.json").read_text(encoding="utf-8")
    )
    assert len(raw["records"]) == 44
    assert all(record["passed"] for record in raw["records"])
    assert raw["configuration"]["version_mismatch_allowed"] is False
    assert all(
        details["matches"]
        for distributions in raw["configuration"]["runtime_versions"].values()
        for details in distributions.values()
    )
    assert raw["environment"]["pip_freeze"]
