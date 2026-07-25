#!/usr/bin/env python3
"""Generate machine-readable and Markdown summaries from benchmark raw data."""

from __future__ import annotations

import argparse
import json
import math
import statistics
from collections import defaultdict
from pathlib import Path
from typing import Any


def _ratio(numerator: int, denominator: int) -> float | None:
    return round(numerator / denominator, 6) if denominator else None


def _latency_summary(values: list[float]) -> dict[str, float | int | None]:
    if not values:
        return {"n": 0, "min_ms": None, "median_ms": None, "p95_ms": None, "max_ms": None}
    ordered = sorted(values)
    p95_index = max(0, math.ceil(0.95 * len(ordered)) - 1)
    return {
        "n": len(ordered),
        "min_ms": round(ordered[0], 3),
        "median_ms": round(statistics.median(ordered), 3),
        "p95_ms": round(ordered[p95_index], 3),
        "max_ms": round(ordered[-1], 3),
    }


def summarize(results: dict[str, Any]) -> dict[str, Any]:
    coverage = results["coverage"]
    scenario_profiles: dict[str, dict[str, Any]] = {}
    target_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    mapping_totals: dict[str, int] = defaultdict(int)
    for record in coverage:
        scenario_profiles.setdefault(
            record["scenario"],
            {
                "tier": record.get("tier", "unclassified"),
                "agents": record.get("source_agents", 0),
                "modules": record.get("source_modules", 0),
                "nodes": record.get("source_nodes", 0),
                "patterns": record.get("patterns", []),
            },
        )
        target_groups[record["target"]].append(record)
        for status, count in record.get("mapping_counts", {}).items():
            mapping_totals[status] += count

    per_target = {}
    for target, records in target_groups.items():
        attempts = len(records)
        conversions = sum(bool(record["conversion_success"]) for record in records)
        parses = sum(bool(record["python_parse_success"]) for record in records)
        properties = sum(record.get("property_count", 0) for record in records)
        consumed = sum(record.get("consumed_property_count", 0) for record in records)
        per_target[target] = {
            "attempts": attempts,
            "conversion_successes": conversions,
            "generation_rate": _ratio(conversions, attempts),
            "parse_successes": parses,
            "parse_rate": _ratio(parses, attempts),
            "property_count": properties,
            "consumed_property_count": consumed,
            "property_consumption_rate": _ratio(consumed, properties),
            "non_exact_mapping_without_notes": sum(
                record.get("non_exact_mapping_without_notes", 0) for record in records
            ),
        }

    attempts = len(coverage)
    conversions = sum(bool(record["conversion_success"]) for record in coverage)
    parses = sum(bool(record["python_parse_success"]) for record in coverage)
    properties = sum(record.get("property_count", 0) for record in coverage)
    consumed = sum(record.get("consumed_property_count", 0) for record in coverage)
    clean = results["robustness"]["clean"]
    mutants = results["robustness"]["mutations"]

    scalability_groups: dict[tuple[str, str | None, int], list[dict[str, Any]]] = defaultdict(list)
    for record in results["scalability"]:
        scalability_groups[(record["operation"], record.get("target"), record["size"])].append(record)
    scalability = []
    for (operation, target, size), records in sorted(
        scalability_groups.items(), key=lambda item: (item[0][0], item[0][1] or "", item[0][2])
    ):
        successful = [record for record in records if record["success"]]
        latency = _latency_summary([float(record["duration_ms"]) for record in successful])
        output_sizes = [int(record["output_bytes"]) for record in successful if record.get("output_bytes")]
        peak_memory = [
            int(record["peak_rss_bytes"])
            for record in successful
            if record.get("peak_rss_bytes") is not None
        ]
        scalability.append(
            {
                "operation": operation,
                "target": target,
                "size": size,
                "attempts": len(records),
                "successes": len(successful),
                "failures": len(records) - len(successful),
                "median_output_bytes": (
                    round(statistics.median(output_sizes)) if output_sizes else None
                ),
                "median_peak_rss_mib": (
                    round(statistics.median(peak_memory) / (1024 * 1024), 3)
                    if peak_memory
                    else None
                ),
                **latency,
            }
        )

    tier_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for profile in scenario_profiles.values():
        tier_groups[profile["tier"]].append(profile)
    corpus = {
        "systems": len(scenario_profiles),
        "min_agents": min((profile["agents"] for profile in scenario_profiles.values()), default=None),
        "max_agents": max((profile["agents"] for profile in scenario_profiles.values()), default=None),
        "tiers": {
            tier: {
                "systems": len(profiles),
                "min_agents": min(profile["agents"] for profile in profiles),
                "max_agents": max(profile["agents"] for profile in profiles),
            }
            for tier, profiles in sorted(tier_groups.items())
        },
    }

    return {
        "schema_version": "1.0.0",
        "benchmark_version": results["benchmark_version"],
        "protocol_version": results["protocol_version"],
        "profile": results["profile"],
        "corpus": corpus,
        "coverage": {
            "attempts": attempts,
            "conversion_successes": conversions,
            "generation_rate": _ratio(conversions, attempts),
            "parse_successes": parses,
            "parse_rate": _ratio(parses, attempts),
            "property_count": properties,
            "consumed_property_count": consumed,
            "property_consumption_rate": _ratio(consumed, properties),
            "mapping_status_counts": dict(sorted(mapping_totals.items())),
            "per_target": per_target,
        },
        "robustness": {
            "clean_attempts": len(clean),
            "clean_accepted": sum(bool(record["accepted"]) for record in clean),
            "clean_acceptance_rate": _ratio(sum(bool(record["accepted"]) for record in clean), len(clean)),
            "mutants_attempted": len(mutants),
            "mutants_rejected": sum(bool(record["rejected"]) for record in mutants),
            "seeded_fault_detection_rate": _ratio(
                sum(bool(record["rejected"]) for record in mutants), len(mutants)
            ),
            "diagnostic_matches": sum(bool(record["diagnostic_match"]) for record in mutants),
            "diagnostic_match_rate": _ratio(
                sum(bool(record["diagnostic_match"]) for record in mutants), len(mutants)
            ),
        },
        "scalability": scalability,
    }


def _percent(value: float | None) -> str:
    return "n/a" if value is None else f"{value * 100:.1f}%"


def markdown(summary: dict[str, Any], results: dict[str, Any]) -> str:
    corpus = summary["corpus"]
    coverage = summary["coverage"]
    robustness = summary["robustness"]
    lines = [
        "# GEAR benchmark summary",
        "",
        f"- Benchmark: `{summary['benchmark_version']}`",
        f"- Protocol: `{summary['protocol_version']}`",
        f"- Profile: `{summary['profile']}`",
        f"- GEAR: `{results['environment']['gear_version']}`",
        f"- Commit: `{results['environment'].get('git_commit') or 'unavailable'}`",
        f"- Generated: `{results['environment']['created_at']}`",
        "",
        "> This static benchmark does not establish runtime semantic equivalence.",
        "",
        "## Scenario corpus",
        "",
        f"The selected corpus contains **{corpus['systems']} systems** spanning "
        f"**{corpus['min_agents']}–{corpus['max_agents']} agents**.",
        "",
        "| Tier | Systems | Agent range |",
        "| --- | ---: | ---: |",
    ]
    for tier, values in corpus["tiers"].items():
        lines.append(
            f"| {tier} | {values['systems']} | {values['min_agents']}–{values['max_agents']} |"
        )
    lines.extend(
        [
            "",
            "## Conversion coverage",
            "",
            "| Target | Pairs | Generated | Parsed | Property consumption | Undocumented non-direct mappings |",
            "| --- | ---: | ---: | ---: | ---: | ---: |",
        ]
    )
    for target, values in coverage["per_target"].items():
        lines.append(
            f"| {target} | {values['attempts']} | {_percent(values['generation_rate'])} | "
            f"{_percent(values['parse_rate'])} | {_percent(values['property_consumption_rate'])} | "
            f"{values['non_exact_mapping_without_notes']} |"
        )
    lines.extend(
        [
            "",
            f"Overall generation rate: **{_percent(coverage['generation_rate'])}** "
            f"({coverage['conversion_successes']}/{coverage['attempts']}).",
            "",
            "Mapping statuses: "
            + ", ".join(f"`{key}` {value}" for key, value in coverage["mapping_status_counts"].items())
            + ".",
            "",
            "## Seeded-fault robustness",
            "",
            f"- Clean acceptance: **{_percent(robustness['clean_acceptance_rate'])}** "
            f"({robustness['clean_accepted']}/{robustness['clean_attempts']}).",
            f"- Seeded-fault detection: **{_percent(robustness['seeded_fault_detection_rate'])}** "
            f"({robustness['mutants_rejected']}/{robustness['mutants_attempted']}).",
            f"- Expected diagnostic match: **{_percent(robustness['diagnostic_match_rate'])}** "
            f"({robustness['diagnostic_matches']}/{robustness['mutants_attempted']}).",
            "",
            "## Scalability",
            "",
            "| Operation | Target | Agents | Successful runs | Median ms | p95 ms | Median output bytes | Median peak RSS MiB |",
            "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
        ]
    )
    for record in summary["scalability"]:
        lines.append(
            f"| {record['operation']} | {record['target'] or '—'} | {record['size']} | "
            f"{record['successes']}/{record['attempts']} | {record['median_ms']} | {record['p95_ms']} | "
            f"{record['median_output_bytes'] or '—'} | {record['median_peak_rss_mib'] or '—'} |"
        )
    lines.extend(["", "See `raw.json` and the CSV files for complete observations and failures.", ""])
    return "\n".join(lines)


def write_summaries(results: dict[str, Any], output: Path) -> dict[str, Any]:
    summary = summarize(results)
    (output / "summary.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    (output / "summary.md").write_text(markdown(summary, results), encoding="utf-8")
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("raw", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    raw = args.raw.resolve()
    results = json.loads(raw.read_text(encoding="utf-8"))
    output = args.output.resolve() if args.output else raw.parent
    output.mkdir(parents=True, exist_ok=True)
    write_summaries(results, output)
    print(f"Summaries written to {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
