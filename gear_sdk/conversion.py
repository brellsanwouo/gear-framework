from __future__ import annotations

import json
import shutil
import subprocess
import sys
import time
import uuid
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import yaml

from .project import GearProject

REPOSITORY_ROOT = Path(__file__).resolve().parent.parent
SOURCE_RUNTIME = Path(__file__).resolve().parent / "runtime"
INSTALLED_RUNTIME = Path(sys.prefix) / "share" / "gear-framework" / "runtime"
RUNTIME_DIR = SOURCE_RUNTIME if (SOURCE_RUNTIME / "node-convert.js").exists() else INSTALLED_RUNTIME
NODE_BRIDGE = RUNTIME_DIR / "node-convert.js"
SOURCE_CONNECTORS = REPOSITORY_ROOT / "connectors" / "frameworks"
CONNECTOR_DIR = SOURCE_CONNECTORS if SOURCE_CONNECTORS.exists() else INSTALLED_RUNTIME / "connectors"


@dataclass(frozen=True)
class BuildResult:
    id: str
    project_id: str
    target: str
    source_hash: str
    created_at: str
    schema_version: str
    connector_version: str
    duration_ms: int
    outputs: dict[str, Any]
    report: dict[str, Any]
    output_dir: Path | None = None


class ConversionBlockedError(ValueError):
    """Raised when a connector reports errors that make generation unsafe."""

    def __init__(self, target: str, diagnostics: list[dict[str, Any]] | None = None, message: str = ""):
        self.target = target
        self.diagnostics = diagnostics or []
        details = []
        for item in self.diagnostics:
            message_text = str(item.get("message", "")).strip()
            if not message_text:
                continue
            code = str(item.get("code", "")).strip()
            path = str(item.get("path", "")).strip()
            prefix = f"[{code}] " if code else ""
            suffix = f" ({path})" if path else ""
            details.append(f"{prefix}{message_text}{suffix}")
        if not details and message.strip():
            details = [line.removeprefix("#").strip() for line in message.splitlines() if line.strip()]
        self.errors = details or [f"The {target} connector rejected the project."]
        super().__init__(f"Conversion to {target} blocked:\n- " + "\n- ".join(self.errors))


def _load_mapping(path: Path) -> list[dict[str, Any]]:
    value = yaml.safe_load(path.read_text(encoding="utf-8"))
    return value if isinstance(value, list) else []


def available_targets() -> tuple[str, ...]:
    """Return installed, executable connector identifiers in stable order."""

    if not CONNECTOR_DIR.exists():
        return ()
    return tuple(
        path.name
        for path in sorted(CONNECTOR_DIR.iterdir(), key=lambda item: item.name)
        if path.is_dir()
        and not path.name.startswith("_")
        and (path / "connector.yml").is_file()
        and (path / "assembly.plugin.js").is_file()
    )


def _mappings(target: str) -> dict[str, list[dict[str, Any]]]:
    """Load conventional connector mappings while retaining legacy aliases."""

    connector = CONNECTOR_DIR / target
    mappings: dict[str, list[dict[str, Any]]] = {}
    for filename, suffix in (
        ("agent.mapping.yml", "Agent"),
        ("module.mapping.yml", "Module"),
        ("multiagent.mapping.yml", "Multi"),
    ):
        path = connector / filename
        if path.is_file():
            mappings[f"{target}{suffix}"] = _load_mapping(path)
    return mappings


def _connector_version(target: str) -> str:
    manifest_path = CONNECTOR_DIR / target / "connector.yml"
    if not manifest_path.exists():
        return "unknown"
    manifest = yaml.safe_load(manifest_path.read_text(encoding="utf-8")) or {}
    return str(manifest.get("version", "unknown"))


def _write_outputs(target: str, outputs: dict[str, Any], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    for name, value in outputs.items():
        if name == "orchestration" and isinstance(value, str):
            suffix = ".py"
            content = value.rstrip() + "\n"
        else:
            suffix = ".yml"
            content = yaml.safe_dump(value, sort_keys=False, allow_unicode=True)
        (output_dir / f"{name}{suffix}").write_text(content, encoding="utf-8")
    manifest = {"target": target, "artifacts": sorted(path.name for path in output_dir.iterdir())}
    (output_dir / "build.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")


def write_build_outputs(build: BuildResult, output_dir: str | Path) -> BuildResult:
    """Persist a successfully preflighted build and return it with its destination."""

    destination = Path(output_dir).resolve()
    _write_outputs(build.target, build.outputs, destination)
    return replace(build, output_dir=destination)


def convert(
    project: GearProject,
    target: str,
    output_dir: str | Path | None = None,
    *,
    timeout: int = 30,
) -> BuildResult:
    normalized_target = target.strip().lower()
    if normalized_target not in available_targets():
        raise ValueError(f"Unsupported target: {target}")
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Node.js is required by the current Gear conversion backend.")
    if not NODE_BRIDGE.exists():
        raise RuntimeError(f"Gear conversion runtime is missing: {NODE_BRIDGE}")
    bridge_input = project.runtime_input()
    bridge_input.update({"target": normalized_target, "mappings": _mappings(normalized_target), "connectorDir": str(CONNECTOR_DIR)})
    started = time.perf_counter()
    completed = subprocess.run(
        [node, str(NODE_BRIDGE)],
        input=json.dumps(bridge_input),
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
        cwd=REPOSITORY_ROOT,
    )
    if completed.returncode != 0:
        raise RuntimeError(f"Conversion backend failed: {completed.stderr.strip()}")
    result = json.loads(completed.stdout)
    if result.get("error"):
        raise ConversionBlockedError(
            normalized_target,
            diagnostics=result.get("diagnostics"),
            message=str(result["error"]),
        )
    outputs = result.get("outputs") or {}
    report = outputs.get("report") or {}
    blocking_diagnostics = [
        item for item in report.get("diagnostics", [])
        if isinstance(item, dict) and item.get("severity") == "error"
    ]
    if report.get("valid") is False or blocking_diagnostics:
        raise ConversionBlockedError(normalized_target, diagnostics=blocking_diagnostics)
    build = BuildResult(
        id=str(uuid.uuid4()),
        project_id=project.id,
        target=normalized_target,
        source_hash=project.source_hash,
        created_at=datetime.now(UTC).isoformat(),
        schema_version=str(project.data.get("schema_version", "1.0")),
        connector_version=_connector_version(normalized_target),
        duration_ms=round((time.perf_counter() - started) * 1000),
        outputs=outputs,
        report=report,
        output_dir=None,
    )
    return write_build_outputs(build, output_dir) if output_dir else build
