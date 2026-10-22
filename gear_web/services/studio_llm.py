from __future__ import annotations

from urllib.parse import urlparse

from ..settings import BASE_DIR, UI_DIR
from .feature_models import FeatureModelService


_feature_models = FeatureModelService(BASE_DIR, UI_DIR)


def analyze_studio_llm_features(configuration: dict) -> dict:
    """Check the LLM feature choices, including absent choices, against UVL."""
    provider = str(configuration.get("Provider") or "").strip().lower()
    model = str(configuration.get("Model") or "").strip()
    provider_feature = provider if provider in {"openai", "ollama"} else "OtherProvider"
    model_feature = "gpt_5_1_codex_mini" if model == "gpt-5.1-codex-mini" else "OtherModel"
    choices = {
        "openai": provider_feature == "openai",
        "ollama": provider_feature == "ollama",
        "OtherProvider": provider_feature == "OtherProvider",
        "gpt_5_1_codex_mini": model_feature == "gpt_5_1_codex_mini",
        "OtherModel": model_feature == "OtherModel",
        "BaseURL": bool(str(configuration.get("BaseURL") or "").strip()),
        "APIKey": "APIKey" in configuration,
    }
    selected = [name for name, enabled in choices.items() if enabled]
    excluded = [name for name, enabled in choices.items() if not enabled]
    return _feature_models.analyze("agent", selected, excluded)


def validate_studio_llm(configuration: dict, model_policy: dict) -> None:
    """Validate the provider branches of gear/gear-agent.uvl for Studio builds."""
    provider = str(configuration.get("Provider") or "").strip().lower()
    model = str(configuration.get("Model") or "").strip()
    base_url = str(configuration.get("BaseURL") or "").strip()

    if not provider or not model:
        raise ValueError("Provider and model are required.")
    if not analyze_studio_llm_features(configuration)["valid"]:
        if provider == "openai" and base_url:
            raise ValueError("UVL constraint BaseURL => ollama | OtherProvider: OpenAI agents cannot set BaseURL; use another provider for a custom endpoint.")
        if provider == "ollama" and "APIKey" in configuration:
            raise ValueError("UVL constraint ollama => !APIKey: Ollama agents cannot set APIKey.")
        if provider == "ollama" and not base_url:
            raise ValueError("UVL constraint ollama => BaseURL: Ollama agents require BaseURL.")
        raise ValueError("LLM configuration violates gear-agent.uvl.")
    if provider == "openai":
        allowed_models = set(model_policy.get("models") or [])
        if allowed_models and model not in allowed_models:
            raise ValueError("Every Studio OpenAI agent must use an available OpenAI mini model.")

    if base_url:
        parsed = urlparse(base_url)
        try:
            valid_port = parsed.port is None or parsed.port > 0
        except ValueError:
            valid_port = False
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or not valid_port:
            raise ValueError("BaseURL must be an absolute HTTP or HTTPS URL.")
