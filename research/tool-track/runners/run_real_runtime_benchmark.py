#!/usr/bin/env python3
"""Run RQ5 on real framework runtimes with deterministic local model adapters."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from collections import defaultdict
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
TOOL_TRACK_ROOT = Path(__file__).resolve().parents[1]
if str(REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT))

from gear_sdk import convert  # noqa: E402
from real_runtime_fidelity import execute_real_runtime  # noqa: E402
from run_benchmark import _csv_list, _read_yaml, environment_metadata, load_scenarios, write_csv  # noqa: E402
from runtime_fidelity import compare_trace, execute_native  # noqa: E402


def installed_versions(environment: dict[str, Any], targets: list[str]) -> dict[str, dict[str, Any]]:
    result = {}
    for target in targets:
        distributions = environment["targets"][target]["distributions"]
        actual = {}
        for distribution, expected in distributions.items():
            try:
                found = version(distribution)
            except PackageNotFoundError:
                found = None
            actual[distribution] = {
                "expected": expected,
                "actual": found,
                "matches": found == expected,
            }
        result[target] = actual
    return result


def _freeze() -> list[str]:
    completed = subprocess.run(
        [sys.executable, "-m", "pip", "freeze", "--all"],
        capture_output=True,
        text=True,
        check=False,
        timeout=30,
    )
    return sorted(line for line in completed.stdout.splitlines() if line.strip()) if completed.returncode == 0 else []


def _record(
    scenario: str,
    target: str | None,
    implementation: str,
    repetition: int,
    events: list[dict[str, Any]],
    oracle: dict[str, Any],
    duration_ms: float,
) -> dict[str, Any]:
    violations = compare_trace(events, oracle)
    return {
        "scenario": scenario,
        "target": target,
        "implementation": implementation,
        "repetition": repetition,
        "passed": not violations,
        "violations": violations,
        "duration_ms": round(duration_ms, 3),
        "event_count": len(events),
        "events": events,
    }


def summarize(results: dict[str, Any]) -> dict[str, Any]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in results["records"]:
        groups[record["target"] or "native-baseline"].append(record)
    values = {}
    for label, records in sorted(groups.items()):
        passed = sum(record["passed"] for record in records)
        values[label] = {
            "attempts": len(records),
            "passed": passed,
            "pass_rate": round(passed / len(records), 6),
            "violations": sum(len(record["violations"]) for record in records),
        }
    return {
        "schema_version": "1.0.0",
        "benchmark_version": results["benchmark_version"],
        "oracle_version": results["oracle_version"],
        "mode": results["mode"],
        "per_runtime": values,
    }


def _markdown(summary: dict[str, Any], results: dict[str, Any]) -> str:
    lines = [
        "# GEAR real-runtime fidelity summary",
        "",
        f"- Benchmark: `{summary['benchmark_version']}`",
        f"- Oracle: `{summary['oracle_version']}`",
        f"- Mode: `{summary['mode']}`",
        f"- Python: `{results['environment']['python']}`",
        f"- Commit: `{results['environment'].get('git_commit') or 'unavailable'}`",
        "",
        "> Framework orchestration is real; only provider/model responses are deterministic local substitutes.",
        "",
        "| Runtime | Attempts | Passed | Violations |",
        "| --- | ---: | ---: | ---: |",
    ]
    for label, values in summary["per_runtime"].items():
        lines.append(
            f"| {label} | {values['attempts']} | {values['passed']} "
            f"({values['pass_rate'] * 100:.1f}%) | {values['violations']} |"
        )
    lines.extend(["", "## Pinned runtime versions", ""])
    for target, distributions in results["configuration"]["runtime_versions"].items():
        rendered = ", ".join(
            f"`{name}=={details['actual'] or 'missing'}`" for name, details in distributions.items()
        )
        lines.append(f"- {target}: {rendered}")
    lines.extend(["", "See `real-runtime-raw.json` for complete traces and the transitive environment lock.", ""])
    return "\n".join(lines)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=TOOL_TRACK_ROOT / "benchmark.yml")
    parser.add_argument(
        "--output", type=Path, default=TOOL_TRACK_ROOT / "results" / "real-runtime-latest"
    )
    parser.add_argument("--quick", action="store_true", help="Use one deterministic repetition.")
    parser.add_argument("--targets", type=_csv_list, help="Comma-separated real-runtime targets.")
    parser.add_argument("--scenarios", type=_csv_list, help="Comma-separated runtime scenarios.")
    parser.add_argument("--repetitions", type=int, help="Override configured repetitions.")
    parser.add_argument(
        "--allow-version-mismatch",
        action="store_true",
        help="Development only: run with versions that differ from the frozen environment.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    raw_argv = list(sys.argv[1:] if argv is None else argv)
    args = parse_args(raw_argv)
    manifest = _read_yaml(args.manifest.resolve())
    config = manifest["real_runtime_fidelity"]
    targets = args.targets or config["targets"]
    scenarios_ids = args.scenarios or config["scenarios"]
    if unknown := sorted(set(targets) - set(config["targets"])):
        raise ValueError(f"No real-runtime adapter for: {', '.join(unknown)}")
    if unknown := sorted(set(scenarios_ids) - set(config["scenarios"])):
        raise ValueError(f"Scenarios are not in the real-runtime protocol: {', '.join(unknown)}")
    repetitions = args.repetitions or (1 if args.quick else config["repetitions"])
    if repetitions < 1:
        raise ValueError("Repetitions must be positive.")

    environment_config = _read_yaml(REPOSITORY_ROOT / config["environments"])
    runtime_versions = installed_versions(environment_config, targets)
    mismatches = [
        f"{target}:{name} expected {details['expected']}, found {details['actual'] or 'missing'}"
        for target, distributions in runtime_versions.items()
        for name, details in distributions.items()
        if not details["matches"]
    ]
    if mismatches and not args.allow_version_mismatch:
        raise RuntimeError(
            "Runtime environment does not match the frozen protocol:\n- "
            + "\n- ".join(mismatches)
            + "\nRun prepare_real_runtime.py and use its Python interpreter."
        )

    scenarios = load_scenarios(manifest, scenarios_ids)
    oracle_file = _read_yaml(REPOSITORY_ROOT / manifest["runtime_fidelity"]["oracle"])
    records = []
    for scenario_id, scenario in scenarios.items():
        project = scenario["project"]
        oracle = oracle_file["scenarios"][scenario_id]
        builds = {target: convert(project, target) for target in targets}
        for repetition in range(1, repetitions + 1):
            started = time.perf_counter()
            native_events = execute_native(project, config["input"])
            records.append(
                _record(
                    scenario_id,
                    None,
                    "native-baseline",
                    repetition,
                    native_events,
                    oracle,
                    (time.perf_counter() - started) * 1000,
                )
            )
            for target, build in builds.items():
                started = time.perf_counter()
                try:
                    events = execute_real_runtime(
                        build.outputs["orchestration"], target, project, config["input"]
                    )
                    record = _record(
                        scenario_id,
                        target,
                        "generated",
                        repetition,
                        events,
                        oracle,
                        (time.perf_counter() - started) * 1000,
                    )
                except Exception as error:
                    record = {
                        "scenario": scenario_id,
                        "target": target,
                        "implementation": "generated",
                        "repetition": repetition,
                        "passed": False,
                        "violations": [
                            {"code": "EXECUTION-ERROR", "message": f"{type(error).__name__}: {error}"}
                        ],
                        "duration_ms": round((time.perf_counter() - started) * 1000, 3),
                        "event_count": 0,
                        "events": [],
                    }
                records.append(record)

    metadata = environment_metadata(raw_argv)
    metadata["pip_freeze"] = _freeze()
    results = {
        "schema_version": "1.0.0",
        "benchmark_version": manifest["benchmark_version"],
        "oracle_version": oracle_file["oracle_version"],
        "mode": "real-runtime-deterministic-model",
        "environment": metadata,
        "configuration": {
            "environment_version": environment_config["environment_version"],
            "runtime_versions": runtime_versions,
            "version_mismatch_allowed": args.allow_version_mismatch,
            "targets": targets,
            "scenarios": scenarios_ids,
            "repetitions": repetitions,
        },
        "records": records,
    }
    schema = json.loads((REPOSITORY_ROOT / config["result_schema"]).read_text(encoding="utf-8"))
    errors = list(Draft202012Validator(schema).iter_errors(results))
    if errors:
        raise RuntimeError("Invalid real-runtime result: " + "; ".join(error.message for error in errors))

    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    (output / "real-runtime-raw.json").write_text(
        json.dumps(results, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    summary = summarize(results)
    (output / "real-runtime-summary.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    (output / "real-runtime-summary.md").write_text(_markdown(summary, results), encoding="utf-8")
    write_csv(
        output / "real-runtime-records.csv",
        [{key: value for key, value in record.items() if key != "events"} for record in records],
    )
    print(f"Real-runtime benchmark complete: {output / 'real-runtime-raw.json'}")
    return 0 if all(record["passed"] for record in records) else 1


if __name__ == "__main__":
    raise SystemExit(main())
