from __future__ import annotations

from pathlib import Path
from typing import Any

from flask import Blueprint, jsonify, redirect, send_from_directory


def create_pages_blueprint(base_dir: Path, ui_dir: Path, runtime_dir: Path) -> Blueprint:
    blueprint = Blueprint("pages", __name__)
    public_project_dirs = {
        "gear": {".uvl", ".yml", ".yaml"},
        "connectors": {".uvl", ".yml", ".yaml", ".js", ".tmpl"},
    }

    @blueprint.get("/experiment")
    def experiment_ui() -> Any:
        return send_from_directory(ui_dir, "experiment.html")

    @blueprint.get("/studio")
    def studio_ui() -> Any:
        return send_from_directory(ui_dir, "studio.html")

    @blueprint.get("/manual")
    def manual_ui() -> Any:
        return send_from_directory(ui_dir, "manual.html")

    @blueprint.get("/")
    def index() -> Any:
        return send_from_directory(ui_dir, "studio.html")

    @blueprint.get("/classic")
    def classic_ui() -> Any:
        return send_from_directory(ui_dir, "index.html")

    @blueprint.get("/ui")
    @blueprint.get("/ui/")
    def index_ui() -> Any:
        return redirect("/")

    @blueprint.get("/ui/<path:filename>")
    def ui_files(filename: str) -> Any:
        return send_from_directory(ui_dir, filename)

    @blueprint.get("/<public_dir>/<path:filename>")
    def public_project_file(public_dir: str, filename: str) -> Any:
        allowed = public_project_dirs.get(public_dir)
        if allowed is None or Path(filename).suffix.lower() not in allowed:
            return jsonify({"error": "Public file not found."}), 404
        return send_from_directory(base_dir / public_dir, filename)

    @blueprint.get("/runtime/<path:filename>")
    def public_runtime_file(filename: str) -> Any:
        if Path(filename).suffix.lower() != ".js":
            return jsonify({"error": "Public runtime file not found."}), 404
        return send_from_directory(runtime_dir, filename)

    @blueprint.get("/data/<experiment>/images/<path:filename>")
    def public_experiment_image(experiment: str, filename: str) -> Any:
        if experiment not in {"AgentGridPlanning", "ConferenceScheduling"}:
            return jsonify({"error": "Public image not found."}), 404
        if Path(filename).suffix.lower() not in {".png", ".jpg", ".jpeg", ".svg", ".webp"}:
            return jsonify({"error": "Public image not found."}), 404
        return send_from_directory(base_dir / "data" / experiment / "images", filename)

    @blueprint.get("/<filename>")
    def root_ui_file(filename: str) -> Any:
        if "/" in filename or Path(filename).suffix.lower() not in {".css", ".js", ".png", ".svg", ".ico"}:
            return jsonify({"error": "Public file not found."}), 404
        return send_from_directory(ui_dir, filename)

    return blueprint
