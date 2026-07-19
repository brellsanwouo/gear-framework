from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import yaml

from .conversion import CONNECTOR_DIR, ConversionBlockedError, available_targets, convert, write_build_outputs
from .project import GearProject, ProjectValidationError, load_project
from .store import BuildStore
from .templates import (
    DEFAULT_MODEL,
    DEFAULT_PROVIDER,
    PROJECT_TEMPLATES,
    PROVIDER_PRESETS,
    create_project_from_template,
    template_catalog,
)
from .version import __version__


def _print(value: Any, as_json: bool = False) -> None:
    if as_json:
        print(json.dumps(value, ensure_ascii=False, indent=2, default=str))
    elif isinstance(value, str):
        print(value)
    else:
        print(yaml.safe_dump(value, sort_keys=False, allow_unicode=True).rstrip())


def _choose(prompt: str, values: list[str], default: str) -> str:
    print(prompt)
    for index, value in enumerate(values, start=1):
        print(f"  {index}. {value}")
    answer = input(f"Select [{default}]: ").strip()
    if not answer:
        return default
    if answer.isdigit() and 1 <= int(answer) <= len(values):
        return values[int(answer) - 1]
    if answer in values:
        return answer
    raise ValueError(f"Unknown selection: {answer}")


def _interactive_init(template: str, provider: str, model: str | None) -> tuple[str, str, str]:
    template = _choose("Starter template:", list(PROJECT_TEMPLATES), template)
    provider = _choose(
        "LLM provider:", list(PROVIDER_PRESETS),
        provider if provider in PROVIDER_PRESETS else DEFAULT_PROVIDER,
    )
    suggested_model = model or PROVIDER_PRESETS[provider]
    selected_model = input(f"Model [{suggested_model}]: ").strip() or suggested_model
    return template, provider, selected_model


def build_parser() -> argparse.ArgumentParser:
    targets = available_targets()
    parser = argparse.ArgumentParser(prog="gear", description="Design, validate, and convert Gear projects.")
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    parser.add_argument("--store", default=".gear/gear.db", help="Build history SQLite database.")
    sub = parser.add_subparsers(dest="command", required=True)

    init = sub.add_parser("init", help="Create a starter Gear project.")
    init.add_argument("name")
    init.add_argument("--output")
    init.add_argument("--template", choices=PROJECT_TEMPLATES, default="minimal")
    init.add_argument("--provider", default=DEFAULT_PROVIDER)
    init.add_argument("--model")
    init.add_argument("--interactive", "-i", action="store_true", help="Select template, provider, and model interactively.")

    templates = sub.add_parser("templates", help="Inspect ready-to-use starter projects.")
    templates_sub = templates.add_subparsers(dest="templates_command", required=True)
    templates_sub.add_parser("list")
    template_show = templates_sub.add_parser("show")
    template_show.add_argument("template", choices=PROJECT_TEMPLATES)

    for command in ("validate", "inspect"):
        item = sub.add_parser(command, help=f"{command.title()} a Gear project.")
        item.add_argument("project")

    conversion = sub.add_parser("convert", aliases=["build"], help="Generate target artifacts.")
    conversion.add_argument("project")
    target_selection = conversion.add_mutually_exclusive_group()
    target_selection.add_argument("--target", choices=targets)
    target_selection.add_argument("--all-targets", action="store_true")
    conversion.add_argument("--output", default="dist")
    conversion.add_argument("--no-history", action="store_true")

    connectors = sub.add_parser("connectors", help="Inspect installed connectors.")
    connectors_sub = connectors.add_subparsers(dest="connectors_command", required=True)
    connectors_sub.add_parser("list")
    connector_show = connectors_sub.add_parser("show")
    connector_show.add_argument("target", choices=targets)

    builds = sub.add_parser("builds", help="Inspect conversion history.")
    builds_sub = builds.add_subparsers(dest="builds_command", required=True)
    builds_sub.add_parser("list")
    build_show = builds_sub.add_parser("show")
    build_show.add_argument("id")

    logs = sub.add_parser("logs", help="Inspect execution logs.")
    logs_sub = logs.add_subparsers(dest="logs_command", required=True)
    logs_sub.add_parser("list")
    log_show = logs_sub.add_parser("show")
    log_show.add_argument("id")

    run = sub.add_parser("run", help="Execute a previously generated local build.")
    run.add_argument("build_id")
    run.add_argument("--timeout", type=int, default=180)

    serve = sub.add_parser("serve", help="Start the local Gear web UI.")
    serve.add_argument("--host", default=None)
    serve.add_argument("--port", type=int, default=None)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "init":
            template, provider, model = args.template, args.provider.strip(), args.model
            if args.interactive:
                template, provider, model = _interactive_init(template, provider, model)
            model = (model or PROVIDER_PRESETS.get(provider) or DEFAULT_MODEL).strip()
            if not provider or not model:
                parser.error("Provider and model must not be empty.")
            target = Path(args.output or f"{args.name}.gear.yml")
            if target.exists():
                parser.error(f"Refusing to overwrite existing file: {target}")
            project = create_project_from_template(template, args.name, provider, model)
            GearProject.from_dict(project).save(target)
            _print({"project": str(target), "status": "created", "template": template,
                    "agents": len(project["agents"]), "modules": len(project["modules"]),
                    "provider": provider, "model": model,
                    "next": [f"gear validate {target}", f"gear convert {target} --all-targets"]}, args.json)
            return 0

        if args.command == "templates":
            if args.templates_command == "list":
                _print(template_catalog(), args.json)
            else:
                definition = PROJECT_TEMPLATES[args.template]
                _print({"id": definition.id, "name": definition.name, "description": definition.description,
                        "agents": definition.agent_count, "modules": definition.module_count,
                        "preview": create_project_from_template(definition.id, "preview")}, args.json)
            return 0

        if args.command in {"validate", "inspect"}:
            project = load_project(args.project)
            payload = (
                {"valid": True, "project_id": project.id, "source_hash": project.source_hash}
                if args.command == "validate"
                else project.data
            )
            _print(payload, args.json)
            return 0

        if args.command in {"convert", "build"}:
            project = load_project(args.project)
            targets = [args.target] if args.target else list(project.data.get("targets", []))
            if args.all_targets:
                targets = list(available_targets())
            if not targets:
                parser.error("Select --target, --all-targets, or declare project.targets.")
            targets = list(dict.fromkeys(targets))
            store = BuildStore(args.store) if not args.no_history else None
            summaries = []
            # Preflight every requested connector before writing anything. This
            # prevents a partially generated multi-target build.
            preflighted = [(target, convert(project, target)) for target in targets]
            for target, build in preflighted:
                output = Path(args.output) / project.id / target
                build = write_build_outputs(build, output)
                if store:
                    store.record_build(build)
                artifacts = sorted(path.name for path in output.iterdir())
                summaries.append(
                    {
                        "status": "succeeded",
                        "build_id": build.id,
                        "project_id": build.project_id,
                        "target": build.target,
                        "output": str(output),
                        "python_file": str(output / "orchestration.py"),
                        "artifacts": artifacts,
                        "duration_ms": build.duration_ms,
                        "connector_version": build.connector_version,
                        "report": build.report.get("summary", {}),
                    }
                )
            _print(summaries, args.json)
            return 0

        if args.command == "connectors":
            def connector_manifest(path: Path) -> dict[str, Any]:
                manifest_path = path / "connector.yml"
                manifest = yaml.safe_load(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
                return manifest if isinstance(manifest, dict) else {}

            if args.connectors_command == "list":
                values = []
                for item in CONNECTOR_DIR.iterdir():
                    if not item.is_dir() or item.name.startswith("_"):
                        continue
                    manifest = connector_manifest(item)
                    values.append({"id": manifest.get("id", item.name), "version": manifest.get("version", "unknown"),
                                   "label": manifest.get("label", item.name), "capabilities": manifest.get("capabilities", {})})
                _print(values, args.json)
            else:
                connector = CONNECTOR_DIR / args.target
                manifest = connector_manifest(connector)
                _print(
                    {
                        "id": args.target,
                        "version": manifest.get("version", "unknown"),
                        "capabilities": manifest.get("capabilities", {}),
                        "limitations": manifest.get("limitations", []),
                        "files": sorted(path.name for path in connector.iterdir()),
                    },
                    args.json,
                )
            return 0

        store = BuildStore(args.store)
        if args.command == "builds":
            value = store.list_builds() if args.builds_command == "list" else store.get_build(args.id)
            if value is None:
                raise KeyError(f"Unknown build: {args.id}")
            _print(value, args.json)
            return 0
        if args.command == "logs":
            value = store.list_runs() if args.logs_command == "list" else store.get_run(args.id)
            if value is None:
                raise KeyError(f"Unknown run: {args.id}")
            _print(value, args.json)
            return 0
        if args.command == "run":
            from .runner import run_python

            build = store.get_build(args.build_id)
            if build is None:
                raise KeyError(f"Unknown build: {args.build_id}")
            output_dir = Path(build.get("output_dir") or "")
            script = output_dir / "orchestration.py"
            if not script.is_file():
                raise ValueError(f"Generated workflow not found: {script}")
            completed = run_python(script.read_text(encoding="utf-8"), timeout=args.timeout)
            trace_id = None
            run_id = store.record_run(
                args.build_id,
                "succeeded" if completed.returncode == 0 else "failed",
                completed.stdout,
                completed.stderr,
                trace_id,
            )
            _print(
                {"run_id": run_id, "build_id": args.build_id, "returncode": completed.returncode,
                 "stdout": completed.stdout, "stderr": completed.stderr},
                args.json,
            )
            return completed.returncode
        if args.command == "serve":
            import server

            server.app.run(host=args.host or server.HOST, port=args.port or server.PORT, debug=False)
            return 0
    except ProjectValidationError as error:
        is_conversion = args.command in {"convert", "build"}
        if args.json:
            _print({"status": "blocked", "operation": "conversion" if is_conversion else args.command,
                    "stage": "validation", "errors": error.errors}, True)
        else:
            operation = "Conversion canceled" if is_conversion else "Validation failed"
            print(f"{operation}: {len(error.errors)} blocking issue(s).", file=sys.stderr)
            for index, message in enumerate(error.errors, start=1):
                print(f"  {index}. {message}", file=sys.stderr)
            if is_conversion:
                print("No new files were generated.", file=sys.stderr)
        return 2
    except ConversionBlockedError as error:
        if args.json:
            _print({"status": "blocked", "stage": "conversion", "target": error.target,
                    "errors": error.errors, "diagnostics": error.diagnostics}, True)
        else:
            print(f"Conversion to {error.target} canceled: {len(error.errors)} blocking issue(s).", file=sys.stderr)
            for index, message in enumerate(error.errors, start=1):
                print(f"  {index}. {message}", file=sys.stderr)
            print("No new files were generated.", file=sys.stderr)
        return 2
    except (ValueError, RuntimeError, KeyError) as error:
        if args.json:
            _print({"error": str(error)}, True)
        else:
            print(str(error), file=sys.stderr)
        return 2
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
