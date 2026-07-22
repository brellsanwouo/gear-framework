from __future__ import annotations

import re
import tomllib
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[1]


def _package_name(requirement: str) -> str:
    return re.split(r"[<>=!~;\[]", requirement, maxsplit=1)[0].strip().lower().replace("_", "-")


def test_production_execution_extra_installs_every_connector_package():
    project = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    execution = {
        _package_name(requirement)
        for requirement in project["project"]["optional-dependencies"]["execution"]
    }

    missing: dict[str, list[str]] = {}
    for connector_file in sorted((ROOT / "connectors" / "frameworks").glob("*/connector.yml")):
        connector = yaml.safe_load(connector_file.read_text(encoding="utf-8"))
        packages = connector.get("runtime", {}).get("packages", [])
        absent = [requirement for requirement in packages if _package_name(requirement) not in execution]
        if absent:
            missing[connector["id"]] = absent

    assert not missing, f"Production execution extra omits connector dependencies: {missing}"
