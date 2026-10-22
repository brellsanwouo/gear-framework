from __future__ import annotations

from ..settings import BASE_DIR, UI_DIR
from .feature_models import FeatureModelService


_feature_models = FeatureModelService(BASE_DIR, UI_DIR)


def analyze_studio_workflow_features(workflow: dict) -> dict:
    """Project populated workflow item groups into the UVL Items or group."""
    items = workflow.get("Items") if isinstance(workflow.get("Items"), dict) else {}
    choices = {
        "WorkflowName": bool(str(workflow.get("WorkflowName") or "").strip()),
        "Items": isinstance(workflow.get("Items"), dict),
        "Agents": isinstance(items.get("Agents"), list) and bool(items["Agents"]),
        "Modules": isinstance(items.get("Modules"), list) and bool(items["Modules"]),
        "Memory": "Memory" in workflow,
    }
    selected = [name for name, enabled in choices.items() if enabled]
    excluded = [name for name, enabled in choices.items() if not enabled]
    return _feature_models.analyze("workflow", selected, excluded)


def validate_studio_workflow(workflow: dict) -> None:
    if not analyze_studio_workflow_features(workflow)["valid"]:
        raise ValueError("Workflow configuration violates gear/gear-multiagent.uvl; inspect the Studio UVL diagnostics.")
