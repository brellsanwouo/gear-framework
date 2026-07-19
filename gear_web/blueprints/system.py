from __future__ import annotations

from typing import Any

from flask import Blueprint, jsonify, request

from gear_sdk.templates import PROJECT_TEMPLATES, create_project_from_template, template_catalog
from gear_sdk.version import __studio_version__, __version__


def create_system_blueprint(studio_model_policy: dict[str, Any]) -> Blueprint:
    blueprint = Blueprint("system", __name__)

    @blueprint.get("/api/version")
    def version():
        return jsonify({"name": "gear-framework", "version": __version__, "studio_version": __studio_version__})

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
        if studio_model_policy.get("locked"):
            provider = str(studio_model_policy["provider"])
            model = str(studio_model_policy["model"])
        else:
            provider = str(request.args.get("provider") or studio_model_policy["provider"]).strip()
            model = str(request.args.get("model") or studio_model_policy["model"]).strip()
        if not provider or not model:
            return jsonify({"error": "Provider and model must not be empty."}), 400
        return jsonify(create_project_from_template(template_id, project_id, provider, model))

    return blueprint
