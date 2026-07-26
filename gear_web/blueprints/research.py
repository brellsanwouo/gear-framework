from __future__ import annotations

import ast
import json
import os
import random
import time
import uuid
from contextlib import closing
from pathlib import Path
from typing import Any

import psycopg2
import yaml
from flask import Blueprint, jsonify, request
from markdown import markdown

from ..services.participants import current_participant


EXPERIENCE_LEVELS = {"none", "low", "medium", "high", "expert"}
AI_TOOL_FREQUENCIES = {"never", "rarely", "monthly", "weekly", "daily"}
PRIOR_GEAR_USE_LEVELS = {"no", "yes_once", "yes_regularly"}
MAX_QUESTIONNAIRE_FEEDBACK_LENGTH = 2000
MAX_SUBMISSION_LENGTH = 1_000_000


class ResearchStore:
    def __init__(self, database: dict[str, Any]):
        self.database = database

    def connect(self):
        if self.database.get("url"):
            return psycopg2.connect(self.database["url"])
        if not self.database.get("password"):
            raise ValueError("DB_PASSWORD missing")
        return psycopg2.connect(
            host=self.database["host"],
            port=self.database["port"],
            user=self.database["user"],
            password=self.database["password"],
            dbname=self.database["database"],
        )

    def initialize(self) -> None:
        try:
            with closing(self.connect()) as connection:
                cursor = connection.cursor()
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS users (
                        user_id VARCHAR(255) PRIMARY KEY,
                        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                        group_order TEXT,
                        current_task_index INT DEFAULT 0,
                        participant_id VARCHAR(255),
                        session_id VARCHAR(255)
                    )
                    """
                )
                # Existing deployments may already have the original users table.
                cursor.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS participant_id VARCHAR(255)")
                cursor.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS session_id VARCHAR(255)")
                cursor.execute(
                    "CREATE INDEX IF NOT EXISTS idx_experiment_users_participant_id ON users(participant_id)"
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS task_logs (
                        id BIGSERIAL PRIMARY KEY,
                        user_id VARCHAR(255),
                        task_id VARCHAR(255),
                        mode VARCHAR(50),
                        start_time DOUBLE PRECISION,
                        end_time DOUBLE PRECISION,
                        duration DOUBLE PRECISION,
                        completed BOOLEAN DEFAULT FALSE,
                        submission TEXT,
                        FOREIGN KEY (user_id) REFERENCES users(user_id)
                    )
                    """
                )
                cursor.execute("ALTER TABLE task_logs ADD COLUMN IF NOT EXISTS submission TEXT")
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS task_runs (
                        id BIGSERIAL PRIMARY KEY,
                        log_id BIGINT NOT NULL,
                        trace_id VARCHAR(64),
                        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                        trace_json TEXT,
                        FOREIGN KEY (log_id) REFERENCES task_logs(id)
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS experiment_questionnaire_responses (
                        user_id VARCHAR(255) PRIMARY KEY,
                        python_experience VARCHAR(32) NOT NULL,
                        multi_agent_experience VARCHAR(32) NOT NULL,
                        ai_tool_frequency VARCHAR(32) NOT NULL,
                        prior_gear_use VARCHAR(32) NOT NULL,
                        feedback TEXT NOT NULL DEFAULT '',
                        submitted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
                    )
                    """
                )
                connection.commit()
                cursor.close()
        except Exception as error:
            print(f"DB Error: {error}")

    def available(self) -> bool:
        try:
            with closing(self.connect()) as connection:
                cursor = connection.cursor()
                cursor.execute("SELECT 1")
                cursor.fetchone()
                cursor.close()
            return True
        except Exception:
            return False


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


def _validate_questionnaire(payload: Any) -> tuple[dict[str, str] | None, str | None]:
    if not isinstance(payload, dict):
        return None, "The questionnaire payload must be a JSON object."

    values = {
        "user_id": str(payload.get("user_id") or "").strip(),
        "python_experience": str(payload.get("python_experience") or "").strip(),
        "multi_agent_experience": str(payload.get("multi_agent_experience") or "").strip(),
        "ai_tool_frequency": str(payload.get("ai_tool_frequency") or "").strip(),
        "prior_gear_use": str(payload.get("prior_gear_use") or "").strip(),
        "feedback": str(payload.get("feedback") or "").strip(),
    }

    if not values["user_id"]:
        return None, "The participant identifier is required."
    if values["python_experience"] not in EXPERIENCE_LEVELS:
        return None, "Invalid Python experience level."
    if values["multi_agent_experience"] not in EXPERIENCE_LEVELS:
        return None, "Invalid multi-agent experience level."
    if values["ai_tool_frequency"] not in AI_TOOL_FREQUENCIES:
        return None, "Invalid AI tool usage frequency."
    if values["prior_gear_use"] not in PRIOR_GEAR_USE_LEVELS:
        return None, "Invalid prior Gear usage value."
    if len(values["feedback"]) > MAX_QUESTIONNAIRE_FEEDBACK_LENGTH:
        return None, f"Feedback must contain at most {MAX_QUESTIONNAIRE_FEEDBACK_LENGTH} characters."

    return values, None


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

    @blueprint.get("/api/experiment/status")
    def experiment_status():
        return jsonify({
            "tracking_enabled": tracking_enabled,
            "database_configured": bool(database.get("url") or database.get("password")),
            "database_available": store.available() if tracking_enabled else False,
        })

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
                    raise ValueError("Gear configuration must contain a mapping at its root.")
            else:
                raise ValueError("Unknown experiment mode.")
        except (SyntaxError, yaml.YAMLError, ValueError) as error:
            return jsonify({"valid": False, "message": str(error)}), 400
        return jsonify({"valid": True, "message": "Valid configuration."})

    @blueprint.post("/api/experiment/start")
    def start():
        user_id = str(uuid.uuid4())
        identity = current_participant()
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
                with closing(store.connect()) as connection:
                    cursor = connection.cursor()
                    cursor.execute(
                        """
                        INSERT INTO users (
                            user_id, group_order, current_task_index, participant_id, session_id
                        ) VALUES (%s, %s, %s, %s, %s)
                        """,
                        (
                            user_id,
                            json.dumps(sequence),
                            0,
                            identity.user_id,
                            identity.session_id,
                        ),
                    )
                    connection.commit()
                    cursor.close()
            except Exception as error:
                return jsonify({"error": str(error)}), 500
        return jsonify({
            "user_id": user_id,
            "participant_id": identity.user_id,
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
        started_at = time.time()
        try:
            with closing(store.connect()) as connection:
                cursor = connection.cursor()
                cursor.execute(
                    """
                    INSERT INTO task_logs (user_id, task_id, mode, start_time, completed)
                    VALUES (%s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (payload.get("user_id"), payload.get("task_id"), payload.get("mode"), started_at, False),
                )
                log_id = cursor.fetchone()[0]
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
        submission = str(payload.get("code") or "")[:MAX_SUBMISSION_LENGTH]
        ended_at = time.time()
        try:
            with closing(store.connect()) as connection:
                cursor = connection.cursor()
                cursor.execute("SELECT start_time FROM task_logs WHERE id=%s", (log_id,))
                row = cursor.fetchone()
                if not row:
                    cursor.close()
                    return jsonify({"error": "Log ID not found"}), 404
                started_at = float(row[0]) if row[0] is not None else ended_at
                duration = ended_at - started_at
                cursor.execute(
                    """
                    UPDATE task_logs
                    SET end_time=%s, duration=%s, completed=%s, submission=%s
                    WHERE id=%s
                    """,
                    (ended_at, duration, True, submission, log_id),
                )
                connection.commit()
                cursor.close()
            return jsonify({"success": True, "duration": duration})
        except Exception as error:
            return jsonify({"error": str(error)}), 500

    @blueprint.post("/api/experiment/questionnaire")
    def save_questionnaire():
        values, validation_error = _validate_questionnaire(request.get_json(silent=True))
        if validation_error:
            return jsonify({"error": validation_error}), 400
        assert values is not None

        # Keep the final form visible in local/development mode even when DB tracking is off.
        if not tracking_enabled:
            return jsonify({"success": True, "saved": False, "tracking": False})

        try:
            with closing(store.connect()) as connection:
                cursor = connection.cursor()
                cursor.execute("SELECT participant_id FROM users WHERE user_id=%s", (values["user_id"],))
                participant_row = cursor.fetchone()
                if participant_row is None:
                    cursor.close()
                    return jsonify({"error": "Unknown experiment participant."}), 404
                browser_participant_id = current_participant().user_id
                if participant_row[0] and participant_row[0] != browser_participant_id:
                    cursor.close()
                    return jsonify({"error": "This questionnaire belongs to another participant."}), 403
                cursor.execute(
                    """
                    INSERT INTO experiment_questionnaire_responses (
                        user_id,
                        python_experience,
                        multi_agent_experience,
                        ai_tool_frequency,
                        prior_gear_use,
                        feedback
                    ) VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (user_id) DO UPDATE SET
                        python_experience = EXCLUDED.python_experience,
                        multi_agent_experience = EXCLUDED.multi_agent_experience,
                        ai_tool_frequency = EXCLUDED.ai_tool_frequency,
                        prior_gear_use = EXCLUDED.prior_gear_use,
                        feedback = EXCLUDED.feedback,
                        updated_at = CURRENT_TIMESTAMP
                    """,
                    (
                        values["user_id"],
                        values["python_experience"],
                        values["multi_agent_experience"],
                        values["ai_tool_frequency"],
                        values["prior_gear_use"],
                        values["feedback"],
                    ),
                )
                connection.commit()
                cursor.close()
            return jsonify({"success": True, "saved": True, "tracking": True})
        except Exception as error:
            return jsonify({"error": str(error)}), 500

    return blueprint