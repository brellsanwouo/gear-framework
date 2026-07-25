#!/usr/bin/env python3
"""Run the reproducible, network-free GEAR tool-track benchmark."""

from __future__ import annotations

import argparse
import ast
import csv
import json
import os
import platform
import subprocess
import sys
import threading
import time
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Callable

import yaml
from jsonschema import Draft202012Validator

try:
    import psutil
except ImportError:  # memory remains explicitly unavailable outside the research environment
    psutil = None

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
TOOL_TRACK_ROOT = Path(__file__).resolve().parents[1]
if str(REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT))
if str(TOOL_TRACK_ROOT / "analysis") not in sys.path:
    sys.path.insert(0, str(TOOL_TRACK_ROOT / "analysis"))

from gear_sdk import GearProject, __version__, convert, load_project, validate_project  # noqa: E402
from gear_sdk.conversion import available_targets  # noqa: E402
from summarize import write_summaries  # noqa: E402


class _PeakMemorySampler:
    """Sample total resident memory for this process and its converter children."""

    def __init__(self, interval_seconds: float = 0.001):
        self.interval_seconds = interval_seconds
        self.peak_rss_bytes: int | None = None
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._process = psutil.Process() if psutil is not None else None

    def _sample(self) -> None:
        if self._process is None:
            return
        try:
            total = self._process.memory_info().rss
            for child in self._process.children(recursive=True):
                try:
                    total += child.memory_info().rss
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    continue
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            return
        self.peak_rss_bytes = max(self.peak_rss_bytes or 0, total)

    def _poll(self) -> None:
        while not self._stop.wait(self.interval_seconds):
            self._sample()

    def __enter__(self) -> "_PeakMemorySampler":
        self._sample()
        if self._process is not None:
            self._thread = threading.Thread(target=self._poll, daemon=True)
            self._thread.start()
        return self

    def __exit__(self, *args: Any) -> None:
        self._sample()
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=1)


def _read_yaml(path: Path) -> dict[str, Any]:
    value = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"Expected a YAML object in {path}")
    return value


def _csv_list(value: str | None) -> list[str] | None:
    if value is None:
        return None
    result = [item.strip() for item in value.split(",") if item.strip()]
    if not result:
        raise argparse.ArgumentTypeError("Expected at least one comma-separated value.")
    return result


def _int_csv(value: str | None) -> list[int] | None:
    values = _csv_list(value)
    if values is None:
        return None
    try:
        result = [int(item) for item in values]
    except ValueError as error:
        raise argparse.ArgumentTypeError("Sizes must be comma-separated integers.") from error
    if any(size < 1 for size in result):
        raise argparse.ArgumentTypeError("Sizes must be positive integers.")
    return result


def _command_output(command: list[str]) -> str | None:
    try:
        completed = subprocess.run(
            command,
            cwd=REPOSITORY_ROOT,
            capture_output=True,
            text=True,
            check=False,
            timeout=10,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    return completed.stdout.strip() if completed.returncode == 0 else None


def environment_metadata(argv: list[str]) -> dict[str, Any]:
    return {
        "created_at": datetime.now(UTC).isoformat(),
        "command": [sys.executable, str(Path(__file__).relative_to(REPOSITORY_ROOT)), *argv],
        "gear_version": __version__,
        "git_commit": _command_output(["git", "rev-parse", "HEAD"]),
        "git_dirty": bool(_command_output(["git", "status", "--porcelain"])),
        "python": sys.version.split()[0],
        "python_implementation": platform.python_implementation(),
        "node": _command_output(["node", "--version"]),
        "platform": platform.platform(),
        "machine": platform.machine(),
        "processor": platform.processor() or None,
        "cpu_count": os.cpu_count(),
    }


def _module_oracle(module: dict[str, Any]) -> dict[str, Any]:
    strategy = module["Strategy"]
    if "Parallel" in strategy:
        parallel = strategy["Parallel"]
        result: dict[str, Any] = {
            "name": module["ModuleName"],
            "strategy": "parallel",
            "agents": parallel["ParallelAgents"],
        }
        if parallel.get("Aggregator"):
            result["aggregator"] = parallel["Aggregator"]
        return result
    loop = strategy["Loop"]
    return {
        "name": module["ModuleName"],
        "strategy": "loop",
        "agents": loop["LoopAgents"],
        "turn_count": loop["TurnCount"],
    }


def source_topology(data: dict[str, Any]) -> dict[str, Any]:
    return {
        "nodes": data["workflow"]["nodes"],
        "edges": data["workflow"]["edges"],
        "modules": [_module_oracle(module) for module in data.get("modules", [])],
    }


def _project_from_blueprint(
    manifest: dict[str, Any], scenario_id: str, blueprint_id: str
) -> GearProject:
    catalog = _read_yaml(REPOSITORY_ROOT / manifest["corpus_blueprints"])
    blueprints = catalog.get("blueprints", {})
    blueprint = blueprints.get(blueprint_id)
    if not isinstance(blueprint, dict):
        raise ValueError(f"Unknown corpus blueprint: {blueprint_id}")
    names = blueprint.get("agents")
    if not isinstance(names, list) or not names or not all(isinstance(name, str) for name in names):
        raise ValueError(f"Blueprint {blueprint_id!r} must declare agent names.")
    project_name = str(blueprint.get("name") or scenario_id)
    agents = [
        {
            "AgentIdentity": {
                "Name": name,
                "Purpose": f"Perform the {name} responsibility in {project_name}.",
                "ContextDescription": (
                    f"A specialist contributing to the reproducible {project_name} benchmark scenario."
                ),
            },
            "LLMConfiguration": {"Provider": "openai", "Model": "benchmark-model"},
            "TaskSpecification": {
                "TaskName": f"{name}Task",
                "TaskDescription": f"Complete the {name} stage and pass its result forward.",
                "ExpectedOutput": f"A deterministic {name} stage result.",
            },
        }
        for name in names
    ]
    return GearProject(
        {
            "schema_version": "1.0",
            "project": {"id": scenario_id, "name": project_name},
            "agents": agents,
            "modules": deepcopy(blueprint.get("modules", [])),
            "workflow": deepcopy(blueprint["workflow"]),
        }
    )


def load_scenarios(
    manifest: dict[str, Any], selected_ids: list[str] | None
) -> dict[str, dict[str, Any]]:
    configured = {item["id"]: item for item in manifest["scenarios"]}
    unknown = sorted(set(selected_ids or []) - configured.keys())
    if unknown:
        raise ValueError(f"Unknown scenarios: {', '.join(unknown)}")
    ids = selected_ids or list(configured)
    oracles = _read_yaml(REPOSITORY_ROOT / manifest["oracles"]["topology"])["scenarios"]
    loaded: dict[str, dict[str, Any]] = {}
    for scenario_id in ids:
        config = configured[scenario_id]
        if "path" in config:
            project = load_project(REPOSITORY_ROOT / config["path"])
        elif "blueprint" in config:
            project = _project_from_blueprint(manifest, scenario_id, config["blueprint"])
        else:
            raise ValueError(f"Scenario {scenario_id!r} has neither a path nor a blueprint.")
        actual = source_topology(project.data)
        expected = oracles.get(scenario_id)
        if actual != expected:
            raise ValueError(
                f"Scenario {scenario_id!r} does not match its frozen topology oracle. "
                "Update the protocol version before collecting data."
            )
        loaded[scenario_id] = {"config": config, "project": project, "topology": actual}
    return loaded


def run_coverage(
    scenarios: dict[str, dict[str, Any]], targets: list[str], timeout: int
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for scenario_id, scenario in scenarios.items():
        project = scenario["project"]
        for target in targets:
            started = time.perf_counter()
            record: dict[str, Any] = {
                "scenario": scenario_id,
                "tier": scenario["config"].get("tier", "unclassified"),
                "patterns": scenario["config"]["patterns"],
                "target": target,
                "source_hash": project.source_hash,
                "source_agents": len(project.data["agents"]),
                "source_modules": len(project.data.get("modules", [])),
                "source_nodes": len(project.data["workflow"]["nodes"]),
                "oracle_match": True,
                "conversion_success": False,
                "python_parse_success": False,
                "duration_ms": None,
                "output_bytes": None,
                "mapping_counts": {},
                "property_count": 0,
                "consumed_property_count": 0,
                "diagnostics": [],
                "error": None,
            }
            try:
                build = convert(project, target, timeout=timeout)
                source = build.outputs.get("orchestration")
                if not isinstance(source, str):
                    raise ValueError("Connector did not return a Python orchestration artifact.")
                ast.parse(source)
                properties = [item for item in build.report.get("properties", []) if isinstance(item, dict)]
                counts: dict[str, int] = {}
                for item in properties:
                    status = str(item.get("status", "undeclared"))
                    counts[status] = counts.get(status, 0) + 1
                record.update(
                    {
                        "conversion_success": True,
                        "python_parse_success": True,
                        "duration_ms": build.duration_ms,
                        "output_bytes": len(source.encode("utf-8")),
                        "mapping_counts": counts,
                        "property_count": len(properties),
                        "consumed_property_count": sum(bool(item.get("consumed")) for item in properties),
                        "non_exact_mapping_without_notes": sum(
                            item.get("status") not in {"exact", "equivalent"}
                            and not str(item.get("notes") or "").strip()
                            for item in properties
                        ),
                        "diagnostics": build.report.get("diagnostics", []),
                        "connector_version": build.connector_version,
                    }
                )
            except Exception as error:  # preserve every connector failure in the raw evidence
                record["duration_ms"] = round((time.perf_counter() - started) * 1000, 3)
                record["error"] = f"{type(error).__name__}: {error}"
            records.append(record)
    return records


Mutation = Callable[[dict[str, Any]], None]


def _duplicate_agent_name(data: dict[str, Any]) -> None:
    data["agents"][1]["AgentIdentity"]["Name"] = data["agents"][0]["AgentIdentity"]["Name"]


def _remove_model(data: dict[str, Any]) -> None:
    del data["agents"][0]["LLMConfiguration"]["Model"]


def _unknown_module_agent(data: dict[str, Any]) -> None:
    data["modules"][0]["Strategy"]["Parallel"]["ParallelAgents"][0] = "MissingAgent"


def _invalid_loop_count(data: dict[str, Any]) -> None:
    data["modules"][0]["Strategy"]["Loop"]["TurnCount"] = 0


def _duplicate_workflow_node(data: dict[str, Any]) -> None:
    data["workflow"]["nodes"][1]["id"] = data["workflow"]["nodes"][0]["id"]


def _unknown_workflow_reference(data: dict[str, Any]) -> None:
    data["workflow"]["nodes"][0]["ref"] = "MissingAgent"


def _unknown_edge_target(data: dict[str, Any]) -> None:
    data["workflow"]["edges"][0]["to"] = "missing-node"


def _workflow_cycle(data: dict[str, Any]) -> None:
    nodes = data["workflow"]["nodes"]
    data["workflow"]["edges"].append({"from": nodes[-1]["id"], "to": nodes[0]["id"]})


MUTATIONS: dict[str, Mutation] = {
    "duplicate_agent_name": _duplicate_agent_name,
    "remove_model": _remove_model,
    "unknown_module_agent": _unknown_module_agent,
    "invalid_loop_count": _invalid_loop_count,
    "duplicate_workflow_node": _duplicate_workflow_node,
    "unknown_workflow_reference": _unknown_workflow_reference,
    "unknown_edge_target": _unknown_edge_target,
    "workflow_cycle": _workflow_cycle,
}


def run_robustness(
    manifest: dict[str, Any], scenarios: dict[str, dict[str, Any]]
) -> dict[str, list[dict[str, Any]]]:
    clean_records = []
    for scenario_id, scenario in scenarios.items():
        started = time.perf_counter()
        errors = validate_project(scenario["project"].data)
        clean_records.append(
            {
                "scenario": scenario_id,
                "accepted": not errors,
                "errors": errors,
                "duration_ms": round((time.perf_counter() - started) * 1000, 3),
            }
        )

    catalog = _read_yaml(REPOSITORY_ROOT / manifest["mutations"]["catalog"])
    all_scenarios = load_scenarios(manifest, None)
    mutation_records = []
    for mutation in catalog["mutations"]:
        operator = MUTATIONS.get(mutation["operator"])
        if operator is None:
            raise ValueError(f"Unknown mutation operator: {mutation['operator']}")
        data = deepcopy(all_scenarios[mutation["base"]]["project"].data)
        operator(data)
        started = time.perf_counter()
        errors = validate_project(data)
        duration_ms = round((time.perf_counter() - started) * 1000, 3)
        expected_fragment = mutation["expected_fragment"]
        diagnostic_match = expected_fragment.lower() in "\n".join(errors).lower()
        mutation_records.append(
            {
                "mutation": mutation["id"],
                "base": mutation["base"],
                "operator": mutation["operator"],
                "fault_class": mutation["fault_class"],
                "rejected": bool(errors),
                "diagnostic_match": diagnostic_match,
                "expected_fragment": expected_fragment,
                "errors": errors,
                "duration_ms": duration_ms,
            }
        )
    return {"clean": clean_records, "mutations": mutation_records}


def synthetic_project(size: int) -> dict[str, Any]:
    agents = []
    nodes = []
    edges = []
    for index in range(size):
        name = f"Agent{index:04d}"
        node_id = f"node-{index:04d}"
        agents.append(
            {
                "AgentIdentity": {
                    "Name": name,
                    "Purpose": f"Process step {index}.",
                    "ContextDescription": "A deterministic synthetic benchmark agent.",
                },
                "LLMConfiguration": {"Provider": "openai", "Model": "benchmark-model"},
                "TaskSpecification": {
                    "TaskName": f"Task{index:04d}",
                    "TaskDescription": f"Process synthetic benchmark step {index}.",
                    "ExpectedOutput": f"Synthetic result {index}.",
                },
            }
        )
        nodes.append({"id": node_id, "ref": name, "type": "agent"})
        if index:
            edges.append({"from": f"node-{index - 1:04d}", "to": node_id})
    return {
        "schema_version": "1.0",
        "project": {"id": f"scale-{size}", "name": f"Scale benchmark with {size} agents"},
        "agents": agents,
        "modules": [],
        "workflow": {"name": "ScaleWorkflow", "memory": False, "nodes": nodes, "edges": edges},
    }


def run_scalability(
    sizes: list[int], repetitions: int, targets: list[str], timeout: int
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for size in sizes:
        data = synthetic_project(size)
        for repetition in range(1, repetitions + 1):
            with _PeakMemorySampler() as memory:
                started = time.perf_counter()
                errors = validate_project(data)
                duration_ms = round((time.perf_counter() - started) * 1000, 3)
            records.append(
                {
                    "operation": "validate",
                    "target": None,
                    "size": size,
                    "repetition": repetition,
                    "success": not errors,
                    "duration_ms": duration_ms,
                    "peak_rss_bytes": memory.peak_rss_bytes,
                    "output_bytes": None,
                    "error": "; ".join(errors) or None,
                }
            )
            if errors:
                continue
            project = GearProject(data)
            for target in targets:
                with _PeakMemorySampler() as memory:
                    started = time.perf_counter()
                    try:
                        build = convert(project, target, timeout=timeout)
                        source = build.outputs.get("orchestration", "")
                        ast.parse(source)
                        record = {
                            "operation": "convert",
                            "target": target,
                            "size": size,
                            "repetition": repetition,
                            "success": True,
                            "duration_ms": build.duration_ms,
                            "output_bytes": len(source.encode("utf-8")),
                            "error": None,
                        }
                    except Exception as error:
                        record = {
                            "operation": "convert",
                            "target": target,
                            "size": size,
                            "repetition": repetition,
                            "success": False,
                            "duration_ms": round((time.perf_counter() - started) * 1000, 3),
                            "output_bytes": None,
                            "error": f"{type(error).__name__}: {error}",
                        }
                record["peak_rss_bytes"] = memory.peak_rss_bytes
                records.append(record)
    return records


def write_csv(path: Path, records: list[dict[str, Any]]) -> None:
    fields = sorted({key for record in records for key in record})
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        for record in records:
            writer.writerow(
                {
                    key: json.dumps(value, ensure_ascii=False, sort_keys=True)
                    if isinstance(value, (dict, list))
                    else value
                    for key, value in record.items()
                }
            )


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=TOOL_TRACK_ROOT / "benchmark.yml")
    parser.add_argument("--output", type=Path, default=TOOL_TRACK_ROOT / "results" / "latest")
    parser.add_argument("--quick", action="store_true", help="Use the smoke-test scalability profile.")
    parser.add_argument("--targets", type=_csv_list, help="Comma-separated connector filter.")
    parser.add_argument("--scenarios", type=_csv_list, help="Comma-separated scenario filter.")
    parser.add_argument("--sizes", type=_int_csv, help="Override scalability sizes.")
    parser.add_argument("--repetitions", type=int, help="Override scalability repetitions.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    raw_argv = list(sys.argv[1:] if argv is None else argv)
    args = parse_args(raw_argv)
    if args.repetitions is not None and args.repetitions < 1:
        raise ValueError("Repetitions must be a positive integer.")
    manifest = _read_yaml(args.manifest.resolve())
    installed = list(available_targets())
    configured_targets = manifest["targets"]
    missing = sorted(set(configured_targets) - set(installed))
    if missing:
        raise RuntimeError(f"Manifest targets are not installed: {', '.join(missing)}")
    targets = args.targets or configured_targets
    unknown_targets = sorted(set(targets) - set(configured_targets))
    if unknown_targets:
        raise ValueError(f"Targets are not in the benchmark manifest: {', '.join(unknown_targets)}")

    profile = manifest["quick_profile"] if args.quick else manifest["scalability"]
    sizes = args.sizes or profile["sizes"]
    repetitions = args.repetitions or profile["repetitions"]
    conversion_targets = [target for target in profile["conversion_targets"] if target in targets]
    timeout = int(manifest["scalability"]["timeout_seconds"])
    scenarios = load_scenarios(manifest, args.scenarios)

    results = {
        "schema_version": "1.0.0",
        "benchmark_version": manifest["benchmark_version"],
        "protocol_version": manifest["protocol_version"],
        "seed": manifest["seed"],
        "profile": "quick" if args.quick else "full",
        "environment": environment_metadata(raw_argv),
        "configuration": {
            "scenarios": list(scenarios),
            "targets": targets,
            "scalability_sizes": sizes,
            "scalability_repetitions": repetitions,
            "scalability_conversion_targets": conversion_targets,
            "timeout_seconds": timeout,
        },
        "coverage": run_coverage(scenarios, targets, timeout),
        "robustness": run_robustness(manifest, scenarios),
        "scalability": run_scalability(sizes, repetitions, conversion_targets, timeout),
    }

    result_schema = json.loads((REPOSITORY_ROOT / manifest["output_schema"]).read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(result_schema)
    validation_errors = sorted(
        Draft202012Validator(result_schema).iter_errors(results), key=lambda error: list(error.path)
    )
    if validation_errors:
        details = "; ".join(error.message for error in validation_errors)
        raise RuntimeError(f"Benchmark result does not satisfy result.schema.json: {details}")

    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    raw_path = output / "raw.json"
    raw_path.write_text(json.dumps(results, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    write_csv(output / "coverage.csv", results["coverage"])
    write_csv(output / "robustness-clean.csv", results["robustness"]["clean"])
    write_csv(output / "robustness-mutations.csv", results["robustness"]["mutations"])
    write_csv(output / "scalability.csv", results["scalability"])
    write_summaries(results, output)
    print(f"Benchmark complete: {raw_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
