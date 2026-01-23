from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict


def load_data(path: str | Path) -> Any:
    path = Path(path)
    suffix = path.suffix.lower()

    if suffix in {".yml", ".yaml"}:
        try:
            import yaml  # type: ignore
        except Exception as exc:  # pragma: no cover
            raise RuntimeError("PyYAML is required to load YAML files") from exc

        with path.open("r", encoding="utf-8") as f:
            return yaml.safe_load(f)

    if suffix == ".json":
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)

    raise ValueError(f"Unsupported input format: {suffix} ({path})")


def dump_data(data: Any, path: str | Path) -> None:
    path = Path(path)
    suffix = path.suffix.lower()

    if suffix in {".yml", ".yaml"}:
        try:
            import yaml  # type: ignore
        except Exception as exc:  # pragma: no cover
            raise RuntimeError("PyYAML is required to write YAML files") from exc

        with path.open("w", encoding="utf-8") as f:
            yaml.safe_dump(data, f, sort_keys=False, allow_unicode=True)
        return

    if suffix == ".json":
        with path.open("w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        return

    raise ValueError(f"Unsupported output format: {suffix} ({path})")


def ensure_object(value: Any, *, label: str) -> Dict[str, Any]:
    if not isinstance(value, dict):
        raise TypeError(f"Expected object for {label}, got {type(value).__name__}")
    return value
