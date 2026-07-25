from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import yaml

from gear_sdk import convert, load_project


REPOSITORY_ROOT = Path(__file__).resolve().parent.parent
TOOL_TRACK = REPOSITORY_ROOT / "research" / "tool-track"
RUNTIME_FIDELITY_PATH = TOOL_TRACK / "runners" / "runtime_fidelity.py"
TRACE_RUNNER = TOOL_TRACK / "runners" / "run_trace_benchmark.py"


def _runtime_module():
    spec = importlib.util.spec_from_file_location("gear_runtime_fidelity_test", RUNTIME_FIDELITY_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_generated_orchestration_satisfies_runtime_oracles():
    runtime = _runtime_module()
    manifest = yaml.safe_load((TOOL_TRACK / "benchmark.yml").read_text(encoding="utf-8"))
    oracle_file = yaml.safe_load(
        (REPOSITORY_ROOT / manifest["runtime_fidelity"]["oracle"]).read_text(encoding="utf-8")
    )
    scenario_paths = {
        item["id"]: REPOSITORY_ROOT / item["path"]
        for item in manifest["scenarios"]
        if "path" in item
    }
    for scenario in manifest["runtime_fidelity"]["scenarios"]:
        project = load_project(scenario_paths[scenario])
        oracle = oracle_file["scenarios"][scenario]
        native_events = runtime.execute_native(project, "deterministic input")
        assert runtime.compare_trace(native_events, oracle) == []
        for target in manifest["runtime_fidelity"]["targets"]:
            source = convert(project, target).outputs["orchestration"]
            events = runtime.execute_generated(source, target, project, "deterministic input")
            assert runtime.compare_trace(events, oracle) == [], (scenario, target, events)


def test_runtime_fidelity_runner_writes_passing_evidence(tmp_path):
    output = tmp_path / "runtime"
    completed = subprocess.run(
        [sys.executable, str(TRACE_RUNNER), "--quick", "--output", str(output)],
        cwd=REPOSITORY_ROOT,
        capture_output=True,
        text=True,
        check=False,
        timeout=30,
    )
    assert completed.returncode == 0, completed.stderr
    raw = json.loads((output / "runtime-raw.json").read_text(encoding="utf-8"))
    assert len(raw["records"]) == 16
    assert all(record["passed"] for record in raw["records"])
    assert {record["target"] for record in raw["records"] if record["target"]} == {
        "crewai",
        "adk",
        "langgraph",
    }
    assert all("input_digest" in record["events"][0] for record in raw["records"])
    assert (output / "runtime-records.csv").is_file()
