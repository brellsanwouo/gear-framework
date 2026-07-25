#!/usr/bin/env python3
"""Run RQ5 against generated orchestration using deterministic contract doubles."""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections import defaultdict
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
TOOL_TRACK_ROOT = Path(__file__).resolve().parents[1]
if str(REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT))

from gear_sdk import convert  # noqa: E402
from run_benchmark import _csv_list, _read_yaml, environment_metadata, load_scenarios, write_csv  # noqa: E402
from runtime_fidelity import compare_trace, execute_generated, execute_native  # noqa: E402


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
    groups: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for record in results["records"]:
        label = record["target"] or "native"
        groups[(record["implementation"], label)].append(record)
    per_implementation = {}
    for (implementation, label), records in sorted(groups.items()):
        key = label if implementation == "generated" else "native-baseline"
        passed = sum(record["passed"] for record in records)
        per_implementation[key] = {
            "implementation": implementation,
            "attempts": len(records),
            "passed": passed,
            "pass_rate": round(passed / len(records), 6) if records else None,
            "violations": sum(len(record["violations"]) for record in records),
        }
    return {
        "schema_version": "1.0.0",
        "benchmark_version": results["benchmark_version"],
        "oracle_version": results["oracle_version"],
        "mode": results["mode"],
        "per_implementation": per_implementation,
    }


def _markdown(summary: dict[str, Any], results: dict[str, Any]) -> str:
    lines = [
        "# GEAR runtime-fidelity summary",
        "",
        f"- Benchmark: `{summary['benchmark_version']}`",
        f"- Oracle: `{summary['oracle_version']}`",
        f"- Mode: `{summary['mode']}`",
        f"- Commit: `{results['environment'].get('git_commit') or 'unavailable'}`",
        "",
        "> Contract-double results validate generated orchestration logic, not compatibility with installed framework releases.",
        "",
        "| Implementation | Attempts | Passed | Violations |",
        "| --- | ---: | ---: | ---: |",
    ]
    for label, values in summary["per_implementation"].items():
        lines.append(
            f"| {label} | {values['attempts']} | {values['passed']} "
            f"({values['pass_rate'] * 100:.1f}%) | {values['violations']} |"
        )
    lines.extend(["", "See `runtime-raw.json` for normalized events and individual oracle violations.", ""])
    return "\n".join(lines)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=TOOL_TRACK_ROOT / "benchmark.yml")
    parser.add_argument("--output", type=Path, default=TOOL_TRACK_ROOT / "results" / "runtime-latest")
    parser.add_argument("--quick", action="store_true", help="Use one deterministic repetition.")
    parser.add_argument("--targets", type=_csv_list, help="Comma-separated contract-double targets.")
    parser.add_argument("--scenarios", type=_csv_list, help="Comma-separated runtime scenarios.")
    parser.add_argument("--repetitions", type=int, help="Override the configured repetitions.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    raw_argv = list(sys.argv[1:] if argv is None else argv)
    args = parse_args(raw_argv)
    manifest = _read_yaml(args.manifest.resolve())
    config = manifest["runtime_fidelity"]
    targets = args.targets or config["targets"]
    scenarios_ids = args.scenarios or config["scenarios"]
    unknown_targets = sorted(set(targets) - set(config["targets"]))
    unknown_scenarios = sorted(set(scenarios_ids) - set(config["scenarios"]))
    if unknown_targets:
        raise ValueError(f"No contract double for: {', '.join(unknown_targets)}")
    if unknown_scenarios:
        raise ValueError(f"Scenarios are not in the RQ5 protocol: {', '.join(unknown_scenarios)}")
    repetitions = args.repetitions or (1 if args.quick else config["repetitions"])
    if repetitions < 1:
        raise ValueError("Repetitions must be positive.")

    scenarios = load_scenarios(manifest, scenarios_ids)
    oracle_file = _read_yaml(REPOSITORY_ROOT / config["oracle"])
    records = []
    for scenario_id, scenario in scenarios.items():
        project = scenario["project"]
        oracle = oracle_file["scenarios"][scenario_id]
        builds = {target: convert(project, target) for target in targets}
        for repetition in range(1, repetitions + 1):
            started = time.perf_counter()
            events = execute_native(project, config["input"])
            records.append(
                _record(
                    scenario_id,
                    None,
                    "native-baseline",
                    repetition,
                    events,
                    oracle,
                    (time.perf_counter() - started) * 1000,
                )
            )
            for target, build in builds.items():
                started = time.perf_counter()
                try:
                    events = execute_generated(
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

    results = {
        "schema_version": "1.0.0",
        "benchmark_version": manifest["benchmark_version"],
        "oracle_version": oracle_file["oracle_version"],
        "mode": "contract-double",
        "environment": environment_metadata(raw_argv),
        "configuration": {
            "targets": targets,
            "scenarios": scenarios_ids,
            "repetitions": repetitions,
            "input_digest": __import__("hashlib").sha256(config["input"].encode()).hexdigest(),
        },
        "records": records,
    }
    schema = json.loads((REPOSITORY_ROOT / config["result_schema"]).read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    errors = list(Draft202012Validator(schema).iter_errors(results))
    if errors:
        raise RuntimeError("Invalid trace result: " + "; ".join(error.message for error in errors))

    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    (output / "runtime-raw.json").write_text(
        json.dumps(results, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    summary = summarize(results)
    (output / "runtime-summary.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    (output / "runtime-summary.md").write_text(_markdown(summary, results), encoding="utf-8")
    write_csv(
        output / "runtime-records.csv",
        [{key: value for key, value in record.items() if key != "events"} for record in records],
    )
    print(f"Runtime-fidelity benchmark complete: {output / 'runtime-raw.json'}")
    return 0 if all(record["passed"] for record in records) else 1


if __name__ == "__main__":
    raise SystemExit(main())
