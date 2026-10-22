from __future__ import annotations

from typing import Any

from flask import Blueprint, jsonify, request

from gear_sdk.templates import PROJECT_TEMPLATES, create_project_from_template, template_catalog
from gear_sdk.version import __studio_version__, __version__
from ..services.participants import current_participant
from ..services.studio_llm import validate_studio_llm


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
        provider = (
            str(studio_model_policy.get("provider") or "openai")
            if studio_model_policy.get("locked")
            else str(request.args.get("provider") or studio_model_policy.get("provider") or "openai").strip()
        )
        model = (
            str(studio_model_policy["model"])
            if studio_model_policy.get("locked")
            else str(request.args.get("model") or studio_model_policy["model"]).strip()
        )
        base_url = "" if studio_model_policy.get("locked") else str(request.args.get("base_url") or "").strip()
        configuration = {"Provider": provider, "Model": model}
        if base_url:
            configuration["BaseURL"] = base_url
        try:
            validate_studio_llm(configuration, studio_model_policy)
        except ValueError as error:
            return jsonify({"error": str(error)}), 400
        project = create_project_from_template(template_id, project_id, provider, model)
        if base_url:
            for agent in project["agents"]:
                agent["LLMConfiguration"]["BaseURL"] = base_url
        return jsonify(project)

    return blueprint
