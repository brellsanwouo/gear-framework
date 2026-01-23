from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Tuple

from .dotpath import get_by_dotpath, set_by_dotpath


@dataclass(frozen=True)
class MappingRule:
    from_path: Optional[str]
    to_path: Optional[str]
    kind: str = "direct"
    notes: str = ""
    value: Any = None


def load_rules(raw: Any) -> List[MappingRule]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise TypeError("Mapping file must be a list of rules")

    rules: List[MappingRule] = []
    for i, item in enumerate(raw):
        if not isinstance(item, dict):
            raise TypeError(f"Rule #{i} must be an object")
        rules.append(
            MappingRule(
                from_path=item.get("from"),
                to_path=item.get("to"),
                kind=item.get("kind", "direct"),
                notes=item.get("notes", ""),
                value=item.get("value"),
            )
        )
    return rules


def invert_rules(rules: Iterable[MappingRule]) -> List[MappingRule]:
    inverted: List[MappingRule] = []
    for r in rules:
        if r.kind in {"direct", "equivalent", "partial"} and r.from_path and r.to_path:
            inverted.append(
                MappingRule(
                    from_path=r.to_path,
                    to_path=r.from_path,
                    kind=r.kind,
                    notes=f"(inverted) {r.notes}".strip(),
                )
            )
    return inverted


def apply_rules(
    source: Dict[str, Any],
    rules: Iterable[MappingRule],
    *,
    dest: Optional[Dict[str, Any]] = None,
    strict: bool = False,
) -> Tuple[Dict[str, Any], List[str]]:
    """Apply mapping rules to `source` and write into `dest`.

    Returns: (dest, warnings)
    """
    if dest is None:
        dest = {}

    warnings: List[str] = []

    for r in rules:
        if r.kind == "not_mapped":
            continue

        if r.kind == "constant":
            if not r.to_path:
                warnings.append("Rule missing 'to'")
                continue
            set_by_dotpath(dest, r.to_path, r.value)
            continue

        if not r.from_path or not r.to_path:
            warnings.append("Rule missing 'from' or 'to'")
            continue

        found, value = get_by_dotpath(source, r.from_path)
        if not found:
            if r.kind == "partial":
                warnings.append(f"Missing source field: {r.from_path} ({r.notes})")
                continue
            if strict:
                raise KeyError(f"Missing source field: {r.from_path}")
            continue

        set_by_dotpath(dest, r.to_path, value)

    return dest, warnings
