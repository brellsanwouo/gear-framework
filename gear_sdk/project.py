from __future__ import annotations

import hashlib
import json
import sys
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator


class ProjectValidationError(ValueError):
    """Raised when a Gear project does not satisfy the stable project contract."""

    def __init__(self, errors: list[str]):
        self.errors = errors
        super().__init__("Invalid Gear project:\n- " + "\n- ".join(errors))


def _non_empty(value: Any) -> str:
    return "" if value is None else str(value).strip()


SOURCE_ROOT = Path(__file__).resolve().parent.parent
INSTALLED_ROOT = Path(sys.prefix) / "share" / "gear-framework"
SCHEMA_PATH = (
    SOURCE_ROOT / "schemas" / "project.gear.schema.json"
    if (SOURCE_ROOT / "schemas" / "project.gear.schema.json").exists()
    else INSTALLED_ROOT / "schemas" / "project.gear.schema.json"
)


@lru_cache(maxsize=1)
def _project_validator() -> Draft202012Validator:
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


def _format_schema_path(parts: Any) -> str:
    output = ""
    for part in parts:
        output += f"[{part}]" if isinstance(part, int) else ("." if output else "") + str(part)
    return output or "project"


def _schema_errors(data: Any) -> list[str]:
    errors = sorted(_project_validator().iter_errors(data), key=lambda error: list(error.absolute_path))
    return [f"{_format_schema_path(error.absolute_path)}: {error.message}" for error in errors]


def _has_cycle(node_ids: set[str], edges: list[dict[str, Any]]) -> bool:
    adjacency = {node_id: [] for node_id in node_ids}
    indegree = {node_id: 0 for node_id in node_ids}
    for edge in edges:
        source, target = edge["from"], edge["to"]
        if source in adjacency and target in indegree:
            adjacency[source].append(target)
            indegree[target] += 1
    pending = [node_id for node_id, degree in indegree.items() if degree == 0]
    visited = 0
    while pending:
        node_id = pending.pop()
        visited += 1
        for target in adjacency[node_id]:
            indegree[target] -= 1
            if indegree[target] == 0:
                pending.append(target)
    return visited != len(node_ids)


def validate_project(data: dict[str, Any]) -> list[str]:
    if not isinstance(data, dict):
        return ["The project root must be an object."]
    errors = _schema_errors(data)
    if errors:
        return errors

    agents = data["agents"]
    agent_ids: set[str] = set()
    for index, agent in enumerate(agents):
        name = _non_empty(agent["AgentIdentity"]["Name"])
        if name in agent_ids:
            errors.append(f"Duplicate agent name: {name}.")
        agent_ids.add(name)

    modules = data.get("modules", [])
    module_ids: set[str] = set()
    for index, module in enumerate(modules):
        name = _non_empty(module["ModuleName"])
        if name in module_ids:
            errors.append(f"Duplicate module name: {name}.")
        module_ids.add(name)
        strategy = module["Strategy"]
        references = (
            strategy["Parallel"]["ParallelAgents"]
            if "Parallel" in strategy
            else strategy["Loop"]["LoopAgents"]
        )
        for reference in references:
            if reference not in agent_ids:
                errors.append(f"Module {name!r} references unknown agent {reference!r}.")
        aggregator = strategy.get("Parallel", {}).get("Aggregator")
        if aggregator and aggregator not in agent_ids:
            errors.append(f"Module {name!r} references unknown aggregator {aggregator!r}.")

    workflow = data["workflow"]
    nodes = workflow["nodes"]
    node_ids: set[str] = set()
    for index, node in enumerate(nodes):
        node_id = _non_empty(node["id"])
        ref = _non_empty(node["ref"])
        node_type = node["type"]
        if node_id in node_ids:
            errors.append(f"Duplicate workflow node id: {node_id}.")
        node_ids.add(node_id)
        if ref not in (agent_ids if node_type == "agent" else module_ids):
            errors.append(f"workflow node {node_id or index} references unknown {node_type} {ref!r}.")

    edges = workflow["edges"]
    for index, edge in enumerate(edges):
        source = _non_empty(edge["from"])
        target = _non_empty(edge["to"])
        if source not in node_ids:
            errors.append(f"workflow.edges[{index}].from references unknown node {source!r}.")
        if target not in node_ids:
            errors.append(f"workflow.edges[{index}].to references unknown node {target!r}.")
    if not errors and _has_cycle(node_ids, edges):
        errors.append("workflow contains a cycle; use an explicit Loop module for repetition.")
    return errors


@dataclass(frozen=True)
class GearProject:
    data: dict[str, Any]
    source_path: Path | None = None

    @classmethod
    def load(cls, path: str | Path) -> "GearProject":
        source = Path(path).resolve()
        try:
            content = source.read_text(encoding="utf-8")
        except OSError as error:
            raise ProjectValidationError([f"Cannot read project {source}: {error.strerror or error}."]) from error
        try:
            raw = yaml.safe_load(content)
        except yaml.YAMLError as error:
            problem = getattr(error, "problem", None) or str(error).splitlines()[0]
            mark = getattr(error, "problem_mark", None)
            location = f" at line {mark.line + 1}, column {mark.column + 1}" if mark else ""
            raise ProjectValidationError([f"Invalid YAML{location}: {problem}."]) from error
        errors = validate_project(raw)
        if errors:
            raise ProjectValidationError(errors)
        return cls(raw, source)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "GearProject":
        errors = validate_project(data)
        if errors:
            raise ProjectValidationError(errors)
        return cls(data)

    @property
    def id(self) -> str:
        return str(self.data["project"]["id"])

    @property
    def source_hash(self) -> str:
        canonical = json.dumps(self.data, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    def save(self, path: str | Path) -> Path:
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(yaml.safe_dump(self.data, sort_keys=False, allow_unicode=True), encoding="utf-8")
        return target

    def runtime_input(self) -> dict[str, Any]:
        workflow = self.data["workflow"]
        nodes = workflow.get("nodes", [])
        return {
            "gearAgents": self.data.get("agents", []),
            "gearModules": self.data.get("modules", []),
            "workflowItems": [
                {"id": node["id"], "label": node["ref"], "type": node.get("type", "agent")}
                for node in nodes
            ],
            "workflowYaml": {
                "WorkflowName": workflow.get("name", self.id),
                "Memory": workflow.get("memory", False),
                "Items": {
                    "Agents": [node["ref"] for node in nodes if node.get("type", "agent") == "agent"],
                    "Modules": [node["ref"] for node in nodes if node.get("type") == "module"],
                },
                "Edges": [
                    {"From": edge["from"], "To": edge["to"]} for edge in workflow.get("edges", [])
                ],
            },
        }


def load_project(path: str | Path) -> GearProject:
    return GearProject.load(path)
