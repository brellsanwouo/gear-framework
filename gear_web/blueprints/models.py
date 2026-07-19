from __future__ import annotations

from flask import Blueprint, jsonify, request

from ..services.feature_models import FeatureModelService


def create_models_blueprint(service: FeatureModelService) -> Blueprint:
    blueprint = Blueprint("models", __name__)

    @blueprint.post("/api/analyze")
    def analyze():
        payload = request.get_json(silent=True) or {}
        try:
            return jsonify(service.analyze(str(payload.get("fm_type") or ""), payload.get("selected_features", [])))
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

    return blueprint
