from __future__ import annotations

from flask import Blueprint, jsonify, request

from ..services.feature_models import FeatureModelService
from ..services.studio_llm import analyze_studio_llm_features
from ..services.studio_agent import analyze_studio_agent_features
from ..services.studio_module import analyze_studio_module_features
from ..services.studio_workflow import analyze_studio_workflow_features


def create_models_blueprint(service: FeatureModelService) -> Blueprint:
    blueprint = Blueprint("models", __name__)

    @blueprint.post("/api/analyze")
    def analyze():
        payload = request.get_json(silent=True) or {}
        try:
            return jsonify(service.analyze(str(payload.get("fm_type") or ""), payload.get("selected_features", []), payload.get("excluded_features", [])))
        except ValueError as error:
            return jsonify({"valid": False, "error": str(error)}), 400
        except Exception as error:
            return jsonify({"valid": False, "error": str(error)}), 500

    @blueprint.post("/api/feature-model")
    def feature_model():
        payload = request.get_json(silent=True) or {}
        try:
            return jsonify(service.image(str(payload.get("fm_type") or "agent")))
        except ValueError as error:
            return jsonify({"error": str(error)}), 400
        except FileNotFoundError as error:
            return jsonify({"error": str(error)}), 500

    @blueprint.post("/api/studio/validate-llm-features")
    def validate_studio_llm_features():
        payload = request.get_json(silent=True) or {}
        configuration = payload.get("configuration")
        if not isinstance(configuration, dict):
            return jsonify({"error": "LLM configuration must be an object."}), 400
        try:
            result = analyze_studio_llm_features(configuration)
        except ValueError as error:
            return jsonify({"error": str(error)}), 400
        return jsonify({"valid": result["valid"], "source": "gear/gear-agent.uvl"})

    @blueprint.post("/api/studio/validate-agent-features")
    def validate_studio_agent_features():
        payload = request.get_json(silent=True) or {}
        agent = payload.get("agent")
        if not isinstance(agent, dict):
            return jsonify({"error": "Agent must be an object."}), 400
        try:
            result = analyze_studio_agent_features(agent)
        except ValueError as error:
            return jsonify({"error": str(error)}), 400
        return jsonify({"valid": result["valid"], "source": "gear/gear-agent.uvl"})

    @blueprint.post("/api/studio/validate-module-features")
    def validate_studio_module_features():
        payload = request.get_json(silent=True) or {}
        module = payload.get("module")
        if not isinstance(module, dict):
            return jsonify({"error": "Module must be an object."}), 400
        try:
            result = analyze_studio_module_features(module)
        except ValueError as error:
            return jsonify({"error": str(error)}), 400
        return jsonify({"valid": result["valid"], "source": "gear/gear-module.uvl"})

    @blueprint.post("/api/studio/validate-workflow-features")
    def validate_studio_workflow_features():
        payload = request.get_json(silent=True) or {}
        workflow = payload.get("workflow")
        if not isinstance(workflow, dict):
            return jsonify({"error": "Workflow must be an object."}), 400
        try:
            result = analyze_studio_workflow_features(workflow)
        except ValueError as error:
            return jsonify({"error": str(error)}), 400
        return jsonify({"valid": result["valid"], "source": "gear/gear-multiagent.uvl"})

    return blueprint
