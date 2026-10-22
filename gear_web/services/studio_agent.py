"""Project Studio agent YAML onto every feature used by the agent UVL model."""

from __future__ import annotations

from ..settings import BASE_DIR, UI_DIR
from .feature_models import FeatureModelService


_feature_models = FeatureModelService(BASE_DIR, UI_DIR)
_MODEL_PARAMETER_FEATURES = (
    "Temperature", "MaxTokens", "TopP", "StopSequences", "AdditionalParams",
    "TopK", "FrequencyPenalty", "PresencePenalty", "Seed",
)
_EXECUTION_FEATURES = (
    "DelegationControl", "CodeExecutionControl", "AsyncExecutionControl",
    "HumanInteractionControl", "VerbosityControl", "CachingControl",
)


def _filled(value: object) -> bool:
    return bool(str(value).strip()) if value is not None else False


def analyze_studio_agent_features(agent: dict) -> dict:
    identity = agent.get("AgentIdentity") if isinstance(agent.get("AgentIdentity"), dict) else {}
    llm = agent.get("LLMConfiguration") if isinstance(agent.get("LLMConfiguration"), dict) else {}
    task = agent.get("TaskSpecification") if isinstance(agent.get("TaskSpecification"), dict) else {}
    provider = str(llm.get("Provider") or "").strip().lower()
    model = str(llm.get("Model") or "").strip()
    parameters = llm.get("ModelParameters") if isinstance(llm.get("ModelParameters"), dict) else {}
    execution = agent.get("ExecutionControl") if isinstance(agent.get("ExecutionControl"), dict) else {}
    choices = {
        "AgentIdentity": isinstance(agent.get("AgentIdentity"), dict),
        "Name": _filled(identity.get("Name")),
        "Purpose": _filled(identity.get("Purpose")),
        "ContextDescription": _filled(identity.get("ContextDescription")),
        "LLMConfiguration": isinstance(agent.get("LLMConfiguration"), dict),
        "Provider": bool(provider),
        "openai": provider == "openai",
        "ollama": provider == "ollama",
        "OtherProvider": bool(provider) and provider not in {"openai", "ollama"},
        "Model": bool(model),
        "gpt_5_1_codex_mini": model == "gpt-5.1-codex-mini",
        "OtherModel": bool(model) and model != "gpt-5.1-codex-mini",
        "APIKey": "APIKey" in llm,
        "BaseURL": _filled(llm.get("BaseURL")),
        "Timeout": "Timeout" in llm,
        "MaxRetries": "MaxRetries" in llm,
        "ModelParameters": "ModelParameters" in llm,
        "TaskSpecification": isinstance(agent.get("TaskSpecification"), dict),
        "TaskName": _filled(task.get("TaskName")),
        "TaskDescription": _filled(task.get("TaskDescription")),
        "ExpectedOutput": _filled(task.get("ExpectedOutput")),
        "Tools": "Tools" in agent,
        "Memory": "Memory" in agent,
        "Reasoning": "Reasoning" in agent,
        "ExecutionControl": "ExecutionControl" in agent,
    }
    choices.update({name: name in parameters for name in _MODEL_PARAMETER_FEATURES})
    choices.update({name: name in execution for name in _EXECUTION_FEATURES})
    selected = [name for name, enabled in choices.items() if enabled]
    excluded = [name for name, enabled in choices.items() if not enabled]
    return _feature_models.analyze("agent", selected, excluded)


def validate_studio_agent(agent: dict) -> None:
    if not analyze_studio_agent_features(agent)["valid"]:
        raise ValueError("Agent configuration violates gear/gear-agent.uvl; inspect the Studio UVL diagnostics.")
