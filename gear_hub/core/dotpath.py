from __future__ import annotations

from typing import Any, Dict, Tuple


def get_by_dotpath(obj: Dict[str, Any], path: str) -> Tuple[bool, Any]:
    """Get value by dotted path. Returns (found, value)."""
    cur: Any = obj
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return False, None
        cur = cur[part]
    return True, cur


def set_by_dotpath(obj: Dict[str, Any], path: str, value: Any) -> None:
    """Set value by dotted path, creating intermediate objects."""
    parts = path.split(".")
    cur: Any = obj
    for part in parts[:-1]:
        if part not in cur or not isinstance(cur[part], dict):
            cur[part] = {}
        cur = cur[part]
    cur[parts[-1]] = value
