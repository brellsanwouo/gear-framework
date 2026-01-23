from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any, Dict

from gear_hub.core.adapters import AdapterKind, get_mapping_path
from gear_hub.core.io_utils import dump_data, ensure_object, load_data
from gear_hub.core.mapping import apply_rules, invert_rules, load_rules


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _load_mapping(repo_root: Path, framework: str, kind: AdapterKind):
    mapping_path = get_mapping_path(repo_root, framework, kind)
    raw = load_data(mapping_path)
    return load_rules(raw)


def cmd_export(args: argparse.Namespace) -> int:
    repo_root = _repo_root()
    rules = _load_mapping(repo_root, args.to, args.kind)

    source = ensure_object(load_data(args.input), label="input")
    out, warnings = apply_rules(source, rules, strict=args.strict)

    if warnings and not args.quiet:
        for w in warnings:
            print(f"[warn] {w}")

    dump_data(out, args.output)
    return 0


def cmd_import(args: argparse.Namespace) -> int:
    repo_root = _repo_root()
    rules = _load_mapping(repo_root, args.from_framework, args.kind)
    inv = invert_rules(rules)

    source = ensure_object(load_data(args.input), label="input")
    out, warnings = apply_rules(source, inv, strict=args.strict)

    if warnings and not args.quiet:
        for w in warnings:
            print(f"[warn] {w}")

    dump_data(out, args.output)
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="gear-hub", description="Gear as pivot converter")
    sub = p.add_subparsers(dest="cmd", required=True)

    exp = sub.add_parser("export", help="Export Gear -> framework")
    exp.add_argument("--to", required=True, help="Target framework (e.g., crewai, adk)")
    exp.add_argument("--kind", required=True, choices=["agent", "multiagent"], help="Document kind")
    exp.add_argument("--in", dest="input", required=True, help="Input file (Gear)")
    exp.add_argument("--out", dest="output", required=True, help="Output file (framework)")
    exp.add_argument("--strict", action="store_true", help="Fail if a mapped source field is missing")
    exp.add_argument("--quiet", action="store_true", help="Silence warnings")
    exp.set_defaults(func=cmd_export)

    imp = sub.add_parser("import", help="Import framework -> Gear")
    imp.add_argument("--from", dest="from_framework", required=True, help="Source framework (e.g., crewai, adk)")
    imp.add_argument("--kind", required=True, choices=["agent", "multiagent"], help="Document kind")
    imp.add_argument("--in", dest="input", required=True, help="Input file (framework)")
    imp.add_argument("--out", dest="output", required=True, help="Output file (Gear)")
    imp.add_argument("--strict", action="store_true", help="Fail if a mapped source field is missing")
    imp.add_argument("--quiet", action="store_true", help="Silence warnings")
    imp.set_defaults(func=cmd_import)

    return p


def main(argv: list[str] | None = None) -> int:
    p = build_parser()
    args = p.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
