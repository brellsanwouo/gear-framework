from __future__ import annotations

from typing import Any

from flask import Blueprint, jsonify, request

from gear_sdk.templates import PROJECT_TEMPLATES, create_project_from_template, template_catalog
from gear_sdk.version import __studio_version__, __version__
from ..services.participants import current_participant


def create_system_blueprint(studio_model_policy: dict[str, Any], studio_revision: str) -> Blueprint:
    blueprint = Blueprint("system", __name__)

    @blueprint.get("/api/version")
    def version():
        return jsonify({"name": "gear-framework", "version": __version__, "studio_version": __studio_version__, "studio_revision": studio_revision})

    @blueprint.get("/api/session")
    def participant_session():
        identity = current_participant()
        return jsonify({
            "anonymous": True,
            "user_id": identity.user_id,
            "session_id": identity.session_id,
        })

    @blueprint.get("/api/studio/config")
    def studio_config():
        return jsonify({"model": studio_model_policy})

    @blueprint.get("/api/studio/templates")
    def studio_templates():
        return jsonify({"templates": template_catalog()})

    @blueprint.get("/api/studio/templates/<template_id>")
    def studio_template(template_id: str):
        if template_id not in PROJECT_TEMPLATES:
            return jsonify({"error": "Unknown starter template."}), 404
        project_id = str(request.args.get("project_id") or "studio-project").strip() or "studio-project"
        provider = "openai"
        model = (
            str(studio_model_policy["model"])
            if studio_model_policy.get("locked")
            else str(request.args.get("model") or studio_model_policy["model"]).strip()
        )
        allowed_models = set(studio_model_policy.get("models") or [])
        if not model or (allowed_models and model not in allowed_models):
            return jsonify({"error": "Select an available OpenAI mini model."}), 400
        return jsonify(create_project_from_template(template_id, project_id, provider, model))

    return blueprint
