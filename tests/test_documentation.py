from __future__ import annotations

import json
from pathlib import Path

import yaml

from gear_sdk.conversion import available_targets
from gear_sdk.project import GearProject


ROOT = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((ROOT / "schemas/project.gear.schema.json").read_text(encoding="utf-8"))


def _documented_keys(definition_names: tuple[str, ...], page: str) -> None:
    content = (ROOT / "docs" / page).read_text(encoding="utf-8")
    keys: set[str] = set()
    for definition_name in definition_names:
        definition = SCHEMA["$defs"][definition_name]
        stack = [definition]
        while stack:
            current = stack.pop()
            for key, value in current.get("properties", {}).items():
                keys.add(key)
                if isinstance(value, dict):
                    stack.append(value)
    missing = sorted(key for key in keys if f"`{key}`" not in content)
    assert not missing, f"{page} does not document schema keys: {missing}"


def test_schema_registry_and_yaml_reference_share_target_identifiers():
    schema_targets = set(SCHEMA["properties"]["targets"]["items"]["enum"])
    runtime_targets = set(available_targets())
    registry = yaml.safe_load((ROOT / "connectors/registry.yml").read_text(encoding="utf-8"))
    registry_targets = {
        item["id"]
        for item in registry["frameworks"]
        if item["id"] != "custom"
    }
    reference = (ROOT / "docs/yaml-reference.md").read_text(encoding="utf-8")

    assert schema_targets == runtime_targets == registry_targets
    for target in schema_targets:
        assert f"  - {target}" in reference


def test_agent_module_and_workflow_schema_keys_are_documented():
    _documented_keys(("agent", "modelParameters", "executionControl"), "yaml-agent.md")
    _documented_keys(("module",), "yaml-module.md")
    _documented_keys(("workflow", "workflowNode", "workflowEdge"), "yaml-workflow.md")


def test_every_documented_example_is_a_valid_project():
    examples = sorted((ROOT / "examples").glob("*.gear.yml"))
    assert examples
    examples_page = (ROOT / "docs/yaml-examples.md").read_text(encoding="utf-8")
    for example in examples:
        GearProject.load(example)
        assert example.name in examples_page

    aggregator = GearProject.load(ROOT / "examples/parallel-aggregator.gear.yml")
    strategy = aggregator.data["modules"][0]["Strategy"]["Parallel"]
    assert strategy["Aggregator"] == "Reviewer"
