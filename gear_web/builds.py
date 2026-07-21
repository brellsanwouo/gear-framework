from __future__ import annotations

import hashlib
import json
import uuid
from datetime import UTC, datetime

import yaml
from flask import Blueprint, current_app, jsonify, request

from gear_sdk.conversion import BuildResult, available_targets, convert
from gear_sdk.project import GearProject, ProjectValidationError
from gear_sdk.store import BuildStore
from gear_sdk.conversion import CONNECTOR_DIR


def _load_studio_document(value, root_name: str) -> dict:
    if isinstance(value, str):
        value = yaml.safe_load(value) or {}
    if not isinstance(value, dict):
        raise ValueError(f"{root_name} document must be an object.")
    nested = value.get(root_name)
    return nested if isinstance(nested, dict) else value


def _studio_project(payload: dict, model_policy: dict | None = None) -> GearProject:
    agents = [_load_studio_document(value, "GearAgent") for value in payload.get("agents", [])]
    if model_policy and model_policy.get("locked"):
        provider = str(model_policy.get("provider") or "openai")
        model = str(model_policy.get("model") or "").strip()
        for agent in agents:
            configuration = agent.get("LLMConfiguration")
            if not isinstance(configuration, dict):
                configuration = {}
                agent["LLMConfiguration"] = configuration
            configuration["Provider"] = provider
            configuration["Model"] = model
    modules = [_load_studio_document(value, "GearModule") for value in payload.get("modules", [])]
    workflow_source = payload.get("workflow")
    if workflow_source is None:
        workflows = payload.get("workflows", [])
        workflow_source = workflows[0] if workflows else {}
    workflow = _load_studio_document(workflow_source, "GearMultiAgent")
    if "GearWorkflow" in workflow and isinstance(workflow["GearWorkflow"], dict):
        workflow = workflow["GearWorkflow"]

    items = workflow.get("Items") if isinstance(workflow.get("Items"), dict) else {}
    requested_sequence = payload.get("workflow_sequence")
    if isinstance(requested_sequence, list):
        ordered_items = [
            ("module" if item.get("kind") == "module" else "agent", str(item.get("name") or "").strip())
            for item in requested_sequence if isinstance(item, dict) and str(item.get("name") or "").strip()
        ]
    else:
        ordered_items = [
            *(("agent", str(name)) for name in items.get("Agents", []) if str(name).strip()),
            *(("module", str(name)) for name in items.get("Modules", []) if str(name).strip()),
        ]
    nodes = [
        {"id": f"step-{index + 1}", "type": kind, "ref": reference}
        for index, (kind, reference) in enumerate(ordered_items)
    ]
    node_ids = {node["id"] for node in nodes}
    reference_ids = {node["ref"]: node["id"] for node in nodes}

    def resolve_node(value) -> str:
        name = str(value or "").strip()
        return name if name in node_ids else reference_ids.get(name, name)

    edges = [
        {"from": nodes[index]["id"], "to": nodes[index + 1]["id"]}
        for index in range(len(nodes) - 1)
    ]
    if not isinstance(requested_sequence, list):
        edges = []
        for edge in workflow.get("Edges", []) or []:
            if not isinstance(edge, dict):
                continue
            edges.append({"from": resolve_node(edge.get("From", edge.get("from"))),
                          "to": resolve_node(edge.get("To", edge.get("to")))})

    project_id = str(payload.get("project_id") or "studio-project").strip() or "studio-project"
    return GearProject.from_dict({
        "schema_version": "1.0",
        "project": {"id": project_id, "name": str(payload.get("project_name") or project_id)},
        "agents": agents,
        "modules": modules,
        "workflow": {
            "name": str(workflow.get("WorkflowName") or "MainWorkflow"),
            "memory": bool(workflow.get("Memory", False)),
            "nodes": nodes,
            "edges": edges,
        },
    })


def create_builds_blueprint(store_path: str, studio_model_policy: dict | None = None) -> Blueprint:
    blueprint = Blueprint("builds", __name__)

    @blueprint.get("/api/builds")
    def list_builds():
        limit = min(max(request.args.get("limit", 50, type=int), 1), 200)
        return jsonify(BuildStore(store_path).list_builds(limit))

    @blueprint.post("/api/builds")
    def record_browser_build():
        payload = request.get_json(silent=True) or {}
        target = str(payload.get("target") or "").lower()
        if target not in available_targets():
            return jsonify({"error": "Unsupported build target."}), 400
        outputs = payload.get("outputs")
        source = payload.get("source")
        if not isinstance(outputs, dict) or not isinstance(source, dict):
            return jsonify({"error": "source and outputs must be objects."}), 400
        canonical = json.dumps(source, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        raw_report = outputs.get("report", {})
        if isinstance(raw_report, str):
            try:
                raw_report = yaml.safe_load(raw_report) or {}
            except yaml.YAMLError:
                raw_report = {"raw": raw_report}
        build = BuildResult(
            id=str(uuid.uuid4()),
            project_id=str(payload.get("project_id") or "ui-project"),
            target=target,
            source_hash=hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
            created_at=datetime.now(UTC).isoformat(),
            schema_version="1.0",
            connector_version=str((yaml.safe_load((CONNECTOR_DIR / target / "connector.yml").read_text(encoding="utf-8")) or {}).get("version", "unknown")),
            duration_ms=max(int(payload.get("duration_ms") or 0), 0),
            outputs=outputs,
            report=raw_report if isinstance(raw_report, dict) else {"value": raw_report},
        )
        BuildStore(store_path).record_build(build)
        return jsonify({"build_id": build.id, "target": target}), 201

    @blueprint.post("/api/studio/builds")
    def build_studio_project():
        payload = request.get_json(silent=True) or {}
        target = str(payload.get("target") or "").lower()
        if target not in available_targets():
            return jsonify({"error": "Unsupported build target."}), 400
        try:
            project = _studio_project(payload, studio_model_policy)
            build = convert(project, target)
            BuildStore(store_path).record_build(build, server_generated=True)
        except (ProjectValidationError, ValueError, yaml.YAMLError) as error:
            details = error.errors if isinstance(error, ProjectValidationError) else [str(error)]
            return jsonify({"error": "Studio project is invalid.", "details": details}), 422
        except RuntimeError as error:
            return jsonify({"error": str(error)}), 500
        except Exception as error:
            current_app.logger.exception("Studio build failed")
            return jsonify({"error": f"Unable to store generated code: {error}"}), 500
        return jsonify({
            "build_id": build.id,
            "project_id": build.project_id,
            "target": build.target,
            "duration_ms": build.duration_ms,
            "report": build.report,
            "outputs": build.outputs,
        }), 201

    @blueprint.get("/api/builds/<build_id>")
    def get_build(build_id: str):
        build = BuildStore(store_path).get_build(build_id)
        return (jsonify(build), 200) if build else (jsonify({"error": "Build not found."}), 404)

    @blueprint.get("/api/logs")
    def list_logs():
        limit = min(max(request.args.get("limit", 50, type=int), 1), 200)
        return jsonify(BuildStore(store_path).list_runs(limit))

    @blueprint.get("/api/logs/<run_id>")
    def get_log(run_id: str):
        run = BuildStore(store_path).get_run(run_id)
        return (jsonify(run), 200) if run else (jsonify({"error": "Run not found."}), 404)

    return blueprint
