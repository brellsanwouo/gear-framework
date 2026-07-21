from __future__ import annotations

import ast
import json
import os
import random
import time
import uuid
from pathlib import Path
from typing import Any

import mysql.connector
import yaml
from flask import Blueprint, jsonify, request
from markdown import markdown


class ResearchStore:
    def __init__(self, database: dict[str, Any]):
        self.database = database

    def connect(self):
        if not self.database.get("password"):
            raise ValueError("DB_PASSWORD missing")
        return mysql.connector.connect(**self.database)

    def initialize(self) -> None:
        try:
            with self.connect() as connection:
                cursor = connection.cursor()
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS users (
                        user_id VARCHAR(255) PRIMARY KEY,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        group_order TEXT,
                        current_task_index INT DEFAULT 0
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS task_logs (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        user_id VARCHAR(255),
                        task_id VARCHAR(255),
                        mode VARCHAR(50),
                        start_time DOUBLE,
                        end_time DOUBLE,
                        duration DOUBLE,
                        completed BOOLEAN DEFAULT FALSE,
                        FOREIGN KEY (user_id) REFERENCES users(user_id)
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS task_runs (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        log_id INT NOT NULL,
                        trace_id VARCHAR(64) NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        trace_json LONGTEXT NULL,
                        FOREIGN KEY (log_id) REFERENCES task_logs(id)
                    )
                    """
                )
                connection.commit()
                cursor.close()
        except Exception as error:
            print(f"DB Error: {error}")


def _load_tasks(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def _markdown_description(base_dir: Path, path: str) -> str:
    if not path:
        return ""
    source = Path(path) if os.path.isabs(path) else base_dir / path
    try:
        content = source.read_text(encoding="utf-8")
    except OSError:
        return ""
    return markdown(content, extensions=["fenced_code", "tables", "toc"])


def create_research_blueprint(
    *,
    base_dir: Path,
    tasks_path: Path,
    experiment_config: dict[str, Any],
    database: dict[str, Any],
    tracking_enabled: bool,
) -> Blueprint:
    blueprint = Blueprint("research", __name__)
    tasks = _load_tasks(tasks_path)
    store = ResearchStore(database)
    if tracking_enabled:
        store.initialize()

    @blueprint.get("/api/experiment/task_info/<task_id>")
    def task_info(task_id: str):
        task = tasks.get(task_id)
        if not task:
            return jsonify({"error": "Task unknown"}), 404
        output = dict(task)
        description_path = output.get("description", "")
        output["description"] = _markdown_description(base_dir, description_path)
        output["description_path"] = description_path
        return jsonify(output)

    @blueprint.post("/api/experiment/validate_task")
    def validate_task():
        payload = request.get_json(silent=True) or {}
        task_id = payload.get("task_id")
        code = str(payload.get("code") or "")
        mode = str(payload.get("mode") or "").upper()
        if task_id not in tasks:
            return jsonify({"valid": False, "message": "Unknown task."}), 404
        if not code.strip():
            return jsonify({"valid": False, "message": "The submitted configuration is empty."}), 400
        try:
            if mode == "MANUAL":
                ast.parse(code)
            elif mode == "GEAR":
                if not isinstance(yaml.safe_load(code), dict):
                    raise ValueError("Gear YAML must contain a mapping at its root.")
            else:
                raise ValueError("Unknown experiment mode.")
        except (SyntaxError, yaml.YAMLError, ValueError) as error:
            return jsonify({"valid": False, "message": str(error)}), 400
        return jsonify({"valid": True, "message": "Valid configuration."})

    @blueprint.post("/api/experiment/start")
    def start():
        user_id = str(uuid.uuid4())
        first_mode = random.choice(["GEAR", "MANUAL"])
        second_mode = "MANUAL" if first_mode == "GEAR" else "GEAR"
        group_a = list(experiment_config.get("group_a", []))
        group_b = list(experiment_config.get("group_b", []))
        random.shuffle(group_a)
        random.shuffle(group_b)
        sequence = (
            [{"id": task_id, "mode": first_mode} for task_id in group_a]
            + [{"id": task_id, "mode": second_mode} for task_id in group_b]
        )
        if not sequence:
            return jsonify({"error": "No research tasks are configured."}), 503
        if tracking_enabled:
            try:
                with store.connect() as connection:
                    cursor = connection.cursor()
                    cursor.execute(
                        "INSERT INTO users (user_id, group_order, current_task_index) VALUES (%s, %s, %s)",
                        (user_id, json.dumps(sequence), 0),
                    )
                    connection.commit()
                    cursor.close()
            except Exception as error:
                return jsonify({"error": str(error)}), 500
        return jsonify({
            "user_id": user_id,
            "mode": "MIXED",
            "sequence": sequence,
            "first_task": sequence[0],
            "total_tasks": len(sequence),
            "tracking": tracking_enabled,
        })

    @blueprint.post("/api/experiment/log_start")
    def log_start():
        if not tracking_enabled:
            return jsonify({"log_id": None, "tracking": False})
        payload = request.get_json(silent=True) or {}
        user_id = payload.get("user_id")
        task_id = payload.get("task_id")
        mode = str(payload.get("mode") or "").upper()
        if mode not in ("GEAR", "MANUAL"):
            return jsonify({"error": "Invalid mode"}), 400
        if task_id not in tasks:
            return jsonify({"error": "Invalid task_id"}), 400
        try:
            uuid.UUID(str(user_id or ""))
        except ValueError:
            return jsonify({"error": "Invalid user_id"}), 400
        started_at = time.time()
        try:
            with store.connect() as connection:
                cursor = connection.cursor()
                cursor.execute(
                    "INSERT INTO task_logs (user_id, task_id, mode, start_time, completed) VALUES (%s, %s, %s, %s, %s)",
                    (user_id, task_id, mode, started_at, False),
                )
                log_id = cursor.lastrowid
                connection.commit()
                cursor.close()
            return jsonify({"log_id": log_id, "start_time": started_at})
        except Exception as error:
            return jsonify({"error": str(error)}), 500

    @blueprint.post("/api/experiment/log_end")
    def log_end():
        if not tracking_enabled:
            return jsonify({"success": True, "tracking": False})
        payload = request.get_json(silent=True) or {}
        log_id = payload.get("log_id")
        ended_at = time.time()
        try:
            with store.connect() as connection:
                cursor = connection.cursor()
                cursor.execute("SELECT start_time FROM task_logs WHERE id=%s", (log_id,))
                row = cursor.fetchone()
                if not row:
                    cursor.close()
                    return jsonify({"error": "Log ID not found"}), 404
                started_at = float(row[0]) if row[0] is not None else ended_at
                duration = ended_at - started_at
                cursor.execute(
                    "UPDATE task_logs SET end_time=%s, duration=%s, completed=%s WHERE id=%s",
                    (ended_at, duration, True, log_id),
                )
                connection.commit()
                cursor.close()
            return jsonify({"success": True, "duration": duration})
        except Exception as error:
            return jsonify({"error": str(error)}), 500

    return blueprint
