from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal

AdapterKind = Literal["agent", "multiagent"]


@dataclass(frozen=True)
class AdapterPaths:
    framework: str
    kind: AdapterKind
    mapping_path: Path


def get_mapping_path(repo_root: Path, framework: str, kind: AdapterKind) -> Path:
    base = repo_root / "gear_hub" / "adapters" / framework.lower()
    filename = f"{kind}.mapping.yml"
    return base / filename
