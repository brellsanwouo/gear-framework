"""Feature-model checks for module strategy choices in Studio."""

from ..settings import BASE_DIR, UI_DIR
from .feature_models import FeatureModelService


_feature_models = FeatureModelService(BASE_DIR, UI_DIR)


def analyze_studio_module_features(module: dict) -> dict:
    strategy = module.get("Strategy")
    strategy = strategy if isinstance(strategy, dict) else {}
    parallel = strategy.get("Parallel") if isinstance(strategy.get("Parallel"), dict) else {}
    loop = strategy.get("Loop") if isinstance(strategy.get("Loop"), dict) else {}
    choices = {
        "ModuleName": bool(str(module.get("ModuleName") or "").strip()),
        "Strategy": isinstance(module.get("Strategy"), dict),
        "Parallel": isinstance(strategy.get("Parallel"), dict),
        "ParallelAgents": isinstance(parallel.get("ParallelAgents"), list) and bool(parallel["ParallelAgents"]),
        "Aggregator": "Aggregator" in parallel,
        "Loop": isinstance(strategy.get("Loop"), dict),
        "TurnCount": "TurnCount" in loop,
        "LoopAgents": isinstance(loop.get("LoopAgents"), list) and bool(loop["LoopAgents"]),
        "StopCondition": "StopCondition" in loop,
    }
    selected = [name for name, enabled in choices.items() if enabled]
    excluded = [name for name, enabled in choices.items() if not enabled]
    return _feature_models.analyze("module", selected, excluded)


def validate_studio_module(module: dict) -> None:
    if not analyze_studio_module_features(module)["valid"]:
        raise ValueError("Module configuration violates gear/gear-module.uvl; inspect the Studio UVL diagnostics.")
