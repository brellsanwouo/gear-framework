from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import yaml


REPOSITORY_ROOT = Path(__file__).resolve().parent.parent
RUNNER = REPOSITORY_ROOT / "research" / "tool-track" / "runners" / "run_benchmark.py"


def test_tool_track_benchmark_smoke_run(tmp_path):
    output = tmp_path / "benchmark"
    completed = subprocess.run(
        [
            sys.executable,
            str(RUNNER),
            "--quick",
            "--targets",
            "crewai",
            "--scenarios",
            "minimal,mixed",
            "--sizes",
            "1,2",
            "--repetitions",
            "1",
            "--output",
            str(output),
        ],
        cwd=REPOSITORY_ROOT,
        capture_output=True,
        text=True,
        check=False,
        timeout=30,
    )
    assert completed.returncode == 0, completed.stderr

    raw = json.loads((output / "raw.json").read_text(encoding="utf-8"))
    summary = json.loads((output / "summary.json").read_text(encoding="utf-8"))
    assert len(raw["coverage"]) == 2
    assert all(record["conversion_success"] for record in raw["coverage"])
    assert all(record["python_parse_success"] for record in raw["coverage"])
    assert len(raw["robustness"]["mutations"]) == 8
    assert all(record["rejected"] for record in raw["robustness"]["mutations"])
    assert all(record["diagnostic_match"] for record in raw["robustness"]["mutations"])
    assert summary["coverage"]["generation_rate"] == 1.0
    assert summary["corpus"]["systems"] == 2
    assert len(raw["scalability"]) == 4
    assert {record["size"] for record in raw["scalability"]} == {1, 2}
    assert all("peak_rss_bytes" in record for record in raw["scalability"])
    assert summary["robustness"]["seeded_fault_detection_rate"] == 1.0
    assert (output / "coverage.csv").is_file()
    assert (output / "scalability.csv").is_file()
    assert "does not establish runtime semantic equivalence" in (
        output / "summary.md"
    ).read_text(encoding="utf-8")


def test_tool_track_manifest_has_stratified_corpus_and_extended_scale():
    manifest = yaml.safe_load(
        (REPOSITORY_ROOT / "research" / "tool-track" / "benchmark.yml").read_text(
            encoding="utf-8"
        )
    )
    scenarios = manifest["scenarios"]
    assert len(scenarios) == 18
    assert {
        tier: sum(item["tier"] == tier for item in scenarios)
        for tier in ("simple", "intermediate", "complex")
    } == {"simple": 6, "intermediate": 6, "complex": 6}
    assert manifest["scalability"]["sizes"] == [1, 2, 4, 8, 16, 32, 64, 100, 128, 256]
    assert manifest["scalability"]["conversion_targets"] == manifest["targets"]
