from __future__ import annotations

import ast
import hmac
import json
import os
import random
import secrets
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
EXPERIMENT_MODES = ("GEAR", "MANUAL")
SUPPORTED_EXPERIMENT_FRAMEWORKS = ("crewai", "adk")
COMPLETION_REASONS = {"confirmed", "timeout", "technical_failure", "withdrawal"}
MAX_QUESTIONNAIRE_FEEDBACK_LENGTH = 2000
MAX_SUBMISSION_LENGTH = 1_000_000
MAX_INCIDENT_NOTE_LENGTH = 1000
STUDY_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
OPERATOR_PIN_HEADER = "X-Gear-Operator-Pin"


def _generate_study_code() -> str:
    """Generate a short pseudonymous code that is easy to copy to operator notes."""
    suffix = "".join(secrets.choice(STUDY_CODE_ALPHABET) for _ in range(6))
    return f"GEAR-{suffix}"



def _operator_pin_matches(configured_pin: str, provided_pin: str) -> bool:
    """Compare an operator PIN without leaking timing information."""
    return bool(configured_pin) and hmac.compare_digest(
        configured_pin.encode("utf-8"),
        provided_pin.encode("utf-8"),
    )


def _task_durations(
    *,
    started_at: float,
    ended_at: float,
    paused_duration: float = 0.0,
    paused_at: float | None = None,
) -> tuple[float, float, float]:
    """Return active, wall-clock, and total paused duration in seconds."""
    wall_duration = max(0.0, ended_at - started_at)
    total_paused = max(0.0, paused_duration)
    if paused_at is not None:
        total_paused += max(0.0, ended_at - paused_at)
    active_duration = max(0.0, wall_duration - total_paused)
    return active_duration, wall_duration, total_paused


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
                        session_id VARCHAR(255),
                        study_code VARCHAR(32),
                        assigned_mode VARCHAR(16),
                        framework_order VARCHAR(64),
                        task_order VARCHAR(128)
                    )
                    """
                )
                cursor.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS participant_id VARCHAR(255)")
                cursor.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS session_id VARCHAR(255)")
                cursor.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS study_code VARCHAR(32)")
                cursor.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS assigned_mode VARCHAR(16)")
                cursor.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS framework_order VARCHAR(64)")
                cursor.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS task_order VARCHAR(128)")
                cursor.execute(
                    "CREATE INDEX IF NOT EXISTS idx_experiment_users_participant_id ON users(participant_id)"
                )
                cursor.execute(
                    "CREATE INDEX IF NOT EXISTS idx_experiment_users_mode ON users(assigned_mode)"
                )
                cursor.execute(
                    "CREATE UNIQUE INDEX IF NOT EXISTS idx_experiment_users_study_code "
                    "ON users(study_code) WHERE study_code IS NOT NULL"
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS task_logs (
                        id BIGSERIAL PRIMARY KEY,
                        user_id VARCHAR(255),
                        task_id VARCHAR(255),
                        mode VARCHAR(50),
                        framework VARCHAR(50),
                        sequence_index INT,
                        start_time DOUBLE PRECISION,
                        end_time DOUBLE PRECISION,
                        duration DOUBLE PRECISION,
                        wall_duration DOUBLE PRECISION,
                        paused_at DOUBLE PRECISION,
                        paused_duration DOUBLE PRECISION NOT NULL DEFAULT 0,
                        pause_count INT NOT NULL DEFAULT 0,
                        completed BOOLEAN DEFAULT FALSE,
                        completion_reason VARCHAR(32),
                        completion_note TEXT,
                        study_phase VARCHAR(32),
                        included_in_primary_analysis BOOLEAN DEFAULT FALSE,
                        submission TEXT,
                        FOREIGN KEY (user_id) REFERENCES users(user_id)
                    )
                    """
                )
                cursor.execute("ALTER TABLE task_logs ADD COLUMN IF NOT EXISTS framework VARCHAR(50)")
                cursor.execute("ALTER TABLE task_logs ADD COLUMN IF NOT EXISTS sequence_index INT")
                cursor.execute("ALTER TABLE task_logs ADD COLUMN IF NOT EXISTS completion_reason VARCHAR(32)")
                cursor.execute("ALTER TABLE task_logs ADD COLUMN IF NOT EXISTS completion_note TEXT")
                cursor.execute("ALTER TABLE task_logs ADD COLUMN IF NOT EXISTS wall_duration DOUBLE PRECISION")
                cursor.execute("ALTER TABLE task_logs ADD COLUMN IF NOT EXISTS paused_at DOUBLE PRECISION")
                cursor.execute(
                    "ALTER TABLE task_logs ADD COLUMN IF NOT EXISTS "
                    "paused_duration DOUBLE PRECISION NOT NULL DEFAULT 0"
                )
                cursor.execute(
                    "ALTER TABLE task_logs ADD COLUMN IF NOT EXISTS "
                    "pause_count INT NOT NULL DEFAULT 0"
                )
                cursor.execute("ALTER TABLE task_logs ADD COLUMN IF NOT EXISTS study_phase VARCHAR(32)")
                cursor.execute(
                    "ALTER TABLE task_logs ADD COLUMN IF NOT EXISTS "
                    "included_in_primary_analysis BOOLEAN DEFAULT FALSE"
                )
                cursor.execute("ALTER TABLE task_logs ADD COLUMN IF NOT EXISTS submission TEXT")
                cursor.execute(
                    "CREATE INDEX IF NOT EXISTS idx_task_logs_user_task ON task_logs(user_id, task_id)"
                )
                cursor.execute(
                    "CREATE INDEX IF NOT EXISTS idx_task_logs_user_sequence "
                    "ON task_logs(user_id, sequence_index)"
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS task_pause_events (
                        id BIGSERIAL PRIMARY KEY,
                        task_log_id BIGINT NOT NULL REFERENCES task_logs(id) ON DELETE CASCADE,
                        started_at DOUBLE PRECISION NOT NULL,
                        ended_at DOUBLE PRECISION,
                        duration DOUBLE PRECISION,
                        reason TEXT NOT NULL DEFAULT ''
                    )
                    """
                )
                cursor.execute(
                    "CREATE INDEX IF NOT EXISTS idx_task_pause_events_log "
                    "ON task_pause_events(task_log_id, started_at)"
                )

                cursor.execute("DROP TABLE IF EXISTS task_runs")
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS experiment_questionnaire_responses (
                        user_id VARCHAR(255) PRIMARY KEY,
                        python_experience VARCHAR(32) NOT NULL,
                        multi_agent_experience VARCHAR(32) NOT NULL,
                        crewai_experience VARCHAR(32),
                        adk_experience VARCHAR(32),
                        ai_tool_frequency VARCHAR(32) NOT NULL,
                        prior_gear_use VARCHAR(32) NOT NULL,
                        method_ease SMALLINT,
                        mental_effort SMALLINT,
                        confidence SMALLINT,
                        framework_switch_ease SMALLINT,
                        reuse_helpfulness SMALLINT,
                        error_clarity SMALLINT,
                        future_use SMALLINT,
                        framework_transition_feedback TEXT NOT NULL DEFAULT '',
                        feedback TEXT NOT NULL DEFAULT '',
                        submitted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
                    )
                    """
                )
                questionnaire_columns = {
                    "crewai_experience": "VARCHAR(32)",
                    "adk_experience": "VARCHAR(32)",
                    "method_ease": "SMALLINT",
                    "mental_effort": "SMALLINT",
                    "confidence": "SMALLINT",
                    "framework_switch_ease": "SMALLINT",
                    "reuse_helpfulness": "SMALLINT",
                    "error_clarity": "SMALLINT",
                    "future_use": "SMALLINT",
                    "framework_transition_feedback": "TEXT NOT NULL DEFAULT ''",
                }
                for column, definition in questionnaire_columns.items():
                    cursor.execute(
                        f"ALTER TABLE experiment_questionnaire_responses "
                        f"ADD COLUMN IF NOT EXISTS {column} {definition}"
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


def _balanced_choice(counts: dict[str, int], values: tuple[str, ...]) -> str:
    minimum = min(counts.get(value, 0) for value in values)
    candidates = [value for value in values if counts.get(value, 0) == minimum]
    return random.choice(candidates)


def _experiment_plan(
    experiment_config: dict[str, Any],
    tasks: dict[str, Any],
) -> tuple[str | None, str | None, list[str]]:
    training_task = str(experiment_config.get("training_task") or "T1")
    familiarization_task = str(experiment_config.get("familiarization_task") or "T2")
    configured_measured = experiment_config.get("measured_tasks")
    if not isinstance(configured_measured, list) or not configured_measured:
        configured_measured = ["T3", "T4"]

    training = training_task if training_task in tasks else None
    familiarization = familiarization_task if familiarization_task in tasks else None
    measured = []
    for task_id in configured_measured:
        value = str(task_id)
        if value in tasks and value not in measured:
            measured.append(value)
    return training, familiarization, measured


def _experiment_frameworks(experiment_config: dict[str, Any]) -> tuple[str, str]:
    configured = experiment_config.get("frameworks")
    values = [str(value).strip().lower() for value in (configured or SUPPORTED_EXPERIMENT_FRAMEWORKS)]
    values = [value for value in values if value in SUPPORTED_EXPERIMENT_FRAMEWORKS]
    if len(values) < 2:
        return SUPPORTED_EXPERIMENT_FRAMEWORKS
    return values[0], values[1]


def _task_order_options(measured_tasks: list[str]) -> tuple[str, ...]:
    forward = ",".join(measured_tasks)
    reverse = ",".join(reversed(measured_tasks))
    return (forward,) if forward == reverse else (forward, reverse)


def _build_sequence(
    *,
    training_task: str | None,
    familiarization_task: str | None,
    measured_task_order: list[str],
    mode: str,
    framework_order: tuple[str, str],
) -> list[dict[str, Any]]:
    first_framework, second_framework = framework_order
    sequence: list[dict[str, Any]] = []

    if training_task:
        sequence.append({
            "id": training_task,
            "mode": mode,
            "framework": first_framework,
            "framework_round": 1,
            "study_phase": "training",
            "collect_metrics": False,
            "included_in_primary_analysis": False,
            "seed_from_previous_framework": False,
        })

    if familiarization_task:
        sequence.append({
            "id": familiarization_task,
            "mode": mode,
            "framework": first_framework,
            "framework_round": 1,
            "study_phase": "familiarization",
            "collect_metrics": True,
            "included_in_primary_analysis": False,
            "seed_from_previous_framework": False,
        })

    for task_id in measured_task_order:
        sequence.append({
            "id": task_id,
            "mode": mode,
            "framework": first_framework,
            "framework_round": 1,
            "study_phase": "first_implementation",
            "collect_metrics": True,
            "included_in_primary_analysis": True,
            "seed_from_previous_framework": False,
        })

    for task_id in measured_task_order:
        sequence.append({
            "id": task_id,
            "mode": mode,
            "framework": second_framework,
            "framework_round": 2,
            "study_phase": "translation",
            "collect_metrics": True,
            "included_in_primary_analysis": True,
            "seed_from_previous_framework": True,
        })

    return sequence


def _stored_sequence(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return []
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def _sequence_entry(value: Any, sequence_index: int | None) -> dict[str, Any] | None:
    sequence = _stored_sequence(value)
    if sequence_index is None or not 0 <= sequence_index < len(sequence):
        return None
    return sequence[sequence_index]


def _likert_value(payload: dict[str, Any], name: str, *, allow_not_applicable: bool = False) -> int:
    try:
        value = int(payload.get(name))
    except (TypeError, ValueError) as error:
        raise ValueError(f"A valid answer is required for '{name}'.") from error
    minimum = 0 if allow_not_applicable else 1
    if not minimum <= value <= 7:
        raise ValueError(f"'{name}' must be between {minimum} and 7.")
    return value


def _validate_questionnaire(payload: Any) -> tuple[dict[str, Any] | None, str | None]:
    if not isinstance(payload, dict):
        return None, "The questionnaire payload must be a JSON object."

    values: dict[str, Any] = {
        "user_id": str(payload.get("user_id") or "").strip(),
        "python_experience": str(payload.get("python_experience") or "").strip(),
        "multi_agent_experience": str(payload.get("multi_agent_experience") or "").strip(),
        "crewai_experience": str(payload.get("crewai_experience") or "").strip(),
        "adk_experience": str(payload.get("adk_experience") or "").strip(),
        "ai_tool_frequency": str(payload.get("ai_tool_frequency") or "").strip(),
        "prior_gear_use": str(payload.get("prior_gear_use") or "").strip(),
        "framework_transition_feedback": str(payload.get("framework_transition_feedback") or "").strip(),
        "feedback": str(payload.get("feedback") or "").strip(),
    }

    if not values["user_id"]:
        return None, "The participant identifier is required."
    for key in ("python_experience", "multi_agent_experience", "crewai_experience", "adk_experience"):
        if values[key] not in EXPERIENCE_LEVELS:
            return None, f"Invalid value for {key}."
    if values["ai_tool_frequency"] not in AI_TOOL_FREQUENCIES:
        return None, "Invalid AI tool usage frequency."
    if values["prior_gear_use"] not in PRIOR_GEAR_USE_LEVELS:
        return None, "Invalid prior Gear usage value."

    try:
        values.update({
            "method_ease": _likert_value(payload, "method_ease"),
            "mental_effort": _likert_value(payload, "mental_effort"),
            "confidence": _likert_value(payload, "confidence"),
            "framework_switch_ease": _likert_value(payload, "framework_switch_ease"),
            "reuse_helpfulness": _likert_value(payload, "reuse_helpfulness"),
            "error_clarity": _likert_value(payload, "error_clarity", allow_not_applicable=True),
            "future_use": _likert_value(payload, "future_use"),
        })
    except ValueError as error:
        return None, str(error)

    for key in ("framework_transition_feedback", "feedback"):
        if len(values[key]) > MAX_QUESTIONNAIRE_FEEDBACK_LENGTH:
            return None, f"{key} must contain at most {MAX_QUESTIONNAIRE_FEEDBACK_LENGTH} characters."

    return values, None


def create_research_blueprint(
    *,
    base_dir: Path,
    tasks_path: Path,
    experiment_config: dict[str, Any],
    database: dict[str, Any],
    tracking_enabled: bool,
    operator_pin: str = "",
) -> Blueprint:
    blueprint = Blueprint("research", __name__)
    tasks = _load_tasks(tasks_path)
    store = ResearchStore(database)
    if tracking_enabled:
        store.initialize()

    operator_controls_available = bool(operator_pin)

    def require_operator_pin():
        if not operator_controls_available:
            return jsonify({
                "error": "Operator controls are unavailable because GEAR_OPERATOR_PIN is not configured."
            }), 503
        provided_pin = request.headers.get(OPERATOR_PIN_HEADER, "")
        if not _operator_pin_matches(operator_pin, provided_pin):
            return jsonify({"error": "Incorrect operator PIN."}), 403
        return None

    @blueprint.get("/api/experiment/status")
    def experiment_status():
        return jsonify({
            "tracking_enabled": tracking_enabled,
            "database_configured": bool(database.get("url") or database.get("password")),
            "database_available": store.available() if tracking_enabled else False,
            "operator_controls_available": operator_controls_available,
        })

    @blueprint.post("/api/experiment/operator/verify")
    def verify_operator_pin():
        authorization_error = require_operator_pin()
        if authorization_error is not None:
            return authorization_error
        return jsonify({"success": True})

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

    @blueprint.get("/api/experiment/task_seed")
    def task_seed():
        if not tracking_enabled:
            return jsonify({"submission": "", "source_framework": None, "tracking": False})

        user_id = str(request.args.get("user_id") or "").strip()
        task_id = str(request.args.get("task_id") or "").strip()
        framework = str(request.args.get("framework") or "").strip().lower()
        try:
            sequence_index = int(request.args.get("sequence_index"))
        except (TypeError, ValueError):
            sequence_index = None

        if not user_id or task_id not in tasks or framework not in SUPPORTED_EXPERIMENT_FRAMEWORKS:
            return jsonify({"error": "Invalid experiment task seed request."}), 400

        try:
            with closing(store.connect()) as connection:
                cursor = connection.cursor()
                cursor.execute(
                    "SELECT participant_id, group_order FROM users WHERE user_id=%s",
                    (user_id,),
                )
                participant_row = cursor.fetchone()
                if participant_row is None:
                    cursor.close()
                    return jsonify({"error": "Unknown experiment participant."}), 404
                if participant_row[0] and participant_row[0] != current_participant().user_id:
                    cursor.close()
                    return jsonify({"error": "This experiment belongs to another participant."}), 403

                entry = _sequence_entry(participant_row[1], sequence_index)
                if not entry:
                    cursor.close()
                    return jsonify({"error": "Invalid experiment sequence position."}), 400
                if str(entry.get("id")) != task_id or str(entry.get("framework")) != framework:
                    cursor.close()
                    return jsonify({"error": "The requested seed does not match the assigned task."}), 400
                if not bool(entry.get("seed_from_previous_framework")):
                    cursor.close()
                    return jsonify({"submission": "", "source_framework": None, "tracking": True})

                cursor.execute(
                    """
                    SELECT submission, framework
                    FROM task_logs
                    WHERE user_id=%s
                      AND task_id=%s
                      AND completed=TRUE
                      AND submission IS NOT NULL
                      AND submission <> ''
                      AND framework IS NOT NULL
                      AND framework <> %s
                      AND sequence_index < %s
                    ORDER BY sequence_index DESC, id DESC
                    LIMIT 1
                    """,
                    (user_id, task_id, framework, sequence_index),
                )
                row = cursor.fetchone()
                cursor.close()
            if not row:
                return jsonify({"submission": "", "source_framework": None, "tracking": True})
            return jsonify({"submission": row[0] or "", "source_framework": row[1], "tracking": True})
        except Exception as error:
            return jsonify({"error": str(error)}), 500

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
        training_task, familiarization_task, measured_tasks = _experiment_plan(experiment_config, tasks)
        frameworks = _experiment_frameworks(experiment_config)
        if not measured_tasks:
            return jsonify({"error": "No measured research tasks are configured."}), 503

        assigned_mode = random.choice(EXPERIMENT_MODES)
        framework_order = frameworks if random.choice((True, False)) else tuple(reversed(frameworks))
        task_order_values = _task_order_options(measured_tasks)
        selected_task_order = random.choice(task_order_values)
        measured_task_order = selected_task_order.split(",")
        study_code = _generate_study_code()

        if tracking_enabled:
            try:
                with closing(store.connect()) as connection:
                    cursor = connection.cursor()
                    cursor.execute("LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE")
                    for _ in range(20):
                        candidate = _generate_study_code()
                        cursor.execute("SELECT 1 FROM users WHERE study_code=%s", (candidate,))
                        if cursor.fetchone() is None:
                            study_code = candidate
                            break
                    else:
                        raise RuntimeError("Unable to allocate a unique study code.")
                    cursor.execute(
                        """
                        SELECT assigned_mode, COUNT(*)
                        FROM users
                        WHERE assigned_mode IN ('GEAR', 'MANUAL')
                        GROUP BY assigned_mode
                        """
                    )
                    mode_counts = {str(row[0]): int(row[1]) for row in cursor.fetchall()}
                    assigned_mode = _balanced_choice(mode_counts, EXPERIMENT_MODES)

                    order_values = (",".join(frameworks), ",".join(reversed(frameworks)))
                    cursor.execute(
                        """
                        SELECT framework_order, COUNT(*)
                        FROM users
                        WHERE assigned_mode=%s AND framework_order = ANY(%s)
                        GROUP BY framework_order
                        """,
                        (assigned_mode, list(order_values)),
                    )
                    order_counts = {str(row[0]): int(row[1]) for row in cursor.fetchall()}
                    selected_order = _balanced_choice(order_counts, order_values)
                    framework_order = tuple(selected_order.split(","))

                    cursor.execute(
                        """
                        SELECT task_order, COUNT(*)
                        FROM users
                        WHERE assigned_mode=%s
                          AND framework_order=%s
                          AND task_order = ANY(%s)
                        GROUP BY task_order
                        """,
                        (assigned_mode, selected_order, list(task_order_values)),
                    )
                    task_order_counts = {str(row[0]): int(row[1]) for row in cursor.fetchall()}
                    selected_task_order = _balanced_choice(task_order_counts, task_order_values)
                    measured_task_order = selected_task_order.split(",")

                    sequence = _build_sequence(
                        training_task=training_task,
                        familiarization_task=familiarization_task,
                        measured_task_order=measured_task_order,
                        mode=assigned_mode,
                        framework_order=framework_order,
                    )

                    cursor.execute(
                        """
                        INSERT INTO users (
                            user_id, group_order, current_task_index, participant_id, session_id,
                            study_code, assigned_mode, framework_order, task_order
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            user_id,
                            json.dumps(sequence),
                            0,
                            identity.user_id,
                            identity.session_id,
                            study_code,
                            assigned_mode,
                            ",".join(framework_order),
                            selected_task_order,
                        ),
                    )
                    connection.commit()
                    cursor.close()
            except Exception as error:
                return jsonify({"error": str(error)}), 500
        else:
            sequence = _build_sequence(
                training_task=training_task,
                familiarization_task=familiarization_task,
                measured_task_order=measured_task_order,
                mode=assigned_mode,
                framework_order=framework_order,
            )

        return jsonify({
            "user_id": user_id,
            "participant_id": identity.user_id,
            "study_code": study_code,
            "mode": assigned_mode,
            "framework_order": list(framework_order),
            "task_order": measured_task_order,
            "sequence": sequence,
            "first_task": sequence[0],
            "total_tasks": len(sequence),
            "tracking": tracking_enabled,
        })

    @blueprint.post("/api/experiment/log_start")
    def log_start():
        if not tracking_enabled:
            return jsonify({
                "log_id": None,
                "tracking": False,
                "operator_controls_available": operator_controls_available,
            })
        payload = request.get_json(silent=True) or {}
        user_id = str(payload.get("user_id") or "").strip()
        task_id = str(payload.get("task_id") or "").strip()
        mode = str(payload.get("mode") or "").strip().upper()
        framework = str(payload.get("framework") or "").strip().lower()
        try:
            sequence_index = int(payload.get("sequence_index"))
        except (TypeError, ValueError):
            sequence_index = None
        started_at = time.time()

        if task_id not in tasks or mode not in EXPERIMENT_MODES or framework not in SUPPORTED_EXPERIMENT_FRAMEWORKS:
            return jsonify({"error": "Invalid experiment task metadata."}), 400

        try:
            with closing(store.connect()) as connection:
                cursor = connection.cursor()
                cursor.execute(
                    "SELECT participant_id, assigned_mode, group_order FROM users WHERE user_id=%s",
                    (user_id,),
                )
                user_row = cursor.fetchone()
                if not user_row:
                    cursor.close()
                    return jsonify({"error": "Unknown experiment participant."}), 404
                if user_row[0] and user_row[0] != current_participant().user_id:
                    cursor.close()
                    return jsonify({"error": "This experiment belongs to another participant."}), 403
                if user_row[1] and str(user_row[1]).upper() != mode:
                    cursor.close()
                    return jsonify({"error": "The submitted mode does not match the participant assignment."}), 400

                entry = _sequence_entry(user_row[2], sequence_index)
                if not entry:
                    cursor.close()
                    return jsonify({"error": "Invalid experiment sequence position."}), 400
                if (
                    str(entry.get("id")) != task_id
                    or str(entry.get("mode")).upper() != mode
                    or str(entry.get("framework")).lower() != framework
                ):
                    cursor.close()
                    return jsonify({"error": "The task does not match the participant sequence."}), 400

                if not bool(entry.get("collect_metrics", True)):
                    cursor.close()
                    return jsonify({
                        "log_id": None,
                        "tracking": False,
                        "study_phase": str(entry.get("study_phase") or "training"),
                        "operator_controls_available": operator_controls_available,
                    })

                study_phase = str(entry.get("study_phase") or "measured")
                included_in_primary_analysis = bool(entry.get("included_in_primary_analysis"))

                cursor.execute(
                    """
                    SELECT id, start_time, completed, paused_at, paused_duration, pause_count
                    FROM task_logs
                    WHERE user_id=%s AND sequence_index=%s
                    ORDER BY id DESC
                    LIMIT 1
                    """,
                    (user_id, sequence_index),
                )
                existing_log = cursor.fetchone()
                if existing_log:
                    if bool(existing_log[2]):
                        cursor.close()
                        return jsonify({"error": "This experiment task is already completed."}), 409
                    cursor.close()
                    started_at_value = float(existing_log[1])
                    paused_at_value = float(existing_log[3]) if existing_log[3] is not None else None
                    paused_duration_value = float(existing_log[4] or 0.0)
                    active_elapsed, _, _ = _task_durations(
                        started_at=started_at_value,
                        ended_at=time.time(),
                        paused_duration=paused_duration_value,
                        paused_at=paused_at_value,
                    )
                    return jsonify({
                        "log_id": int(existing_log[0]),
                        "start_time": started_at_value,
                        "study_phase": study_phase,
                        "included_in_primary_analysis": included_in_primary_analysis,
                        "resumed": True,
                        "paused": paused_at_value is not None,
                        "paused_duration": paused_duration_value,
                        "pause_count": int(existing_log[5] or 0),
                        "active_elapsed_seconds": active_elapsed,
                        "operator_controls_available": operator_controls_available,
                    })

                cursor.execute(
                    """
                    INSERT INTO task_logs (
                        user_id, task_id, mode, framework, sequence_index, start_time, completed,
                        study_phase, included_in_primary_analysis
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        user_id, task_id, mode, framework, sequence_index, started_at, False,
                        study_phase, included_in_primary_analysis,
                    ),
                )
                log_id = cursor.fetchone()[0]
                connection.commit()
                cursor.close()
            return jsonify({
                "log_id": log_id,
                "start_time": started_at,
                "study_phase": study_phase,
                "included_in_primary_analysis": included_in_primary_analysis,
                "paused": False,
                "paused_duration": 0.0,
                "pause_count": 0,
                "active_elapsed_seconds": 0.0,
                "operator_controls_available": operator_controls_available,
            })
        except Exception as error:
            return jsonify({"error": str(error)}), 500

    @blueprint.post("/api/experiment/pause")
    def update_pause():
        authorization_error = require_operator_pin()
        if authorization_error is not None:
            return authorization_error
        if not tracking_enabled:
            return jsonify({"success": True, "tracking": False})
        payload = request.get_json(silent=True) or {}
        log_id = payload.get("log_id")
        action = str(payload.get("action") or "").strip().lower()
        reason = str(payload.get("reason") or "technical interruption").strip()[:MAX_INCIDENT_NOTE_LENGTH]
        if action not in {"pause", "resume"}:
            return jsonify({"error": "Invalid pause action."}), 400
        now = time.time()
        try:
            with closing(store.connect()) as connection:
                cursor = connection.cursor()
                cursor.execute(
                    """
                    SELECT task_logs.start_time, task_logs.completed, task_logs.paused_at,
                           task_logs.paused_duration, task_logs.pause_count
                    FROM task_logs
                    JOIN users ON users.user_id = task_logs.user_id
                    WHERE task_logs.id=%s AND users.participant_id=%s
                    FOR UPDATE
                    """,
                    (log_id, current_participant().user_id),
                )
                row = cursor.fetchone()
                if not row:
                    cursor.close()
                    return jsonify({"error": "Log ID not found"}), 404
                if bool(row[1]):
                    cursor.close()
                    return jsonify({"error": "This task is already completed."}), 409

                started_at = float(row[0]) if row[0] is not None else now
                paused_at = float(row[2]) if row[2] is not None else None
                paused_duration = float(row[3] or 0.0)
                pause_count = int(row[4] or 0)

                if action == "pause" and paused_at is None:
                    paused_at = now
                    pause_count += 1
                    cursor.execute(
                        "UPDATE task_logs SET paused_at=%s, pause_count=%s WHERE id=%s",
                        (paused_at, pause_count, log_id),
                    )
                    cursor.execute(
                        "INSERT INTO task_pause_events (task_log_id, started_at, reason) "
                        "VALUES (%s, %s, %s)",
                        (log_id, paused_at, reason),
                    )
                elif action == "resume" and paused_at is not None:
                    pause_delta = max(0.0, now - paused_at)
                    paused_duration += pause_delta
                    cursor.execute(
                        "UPDATE task_logs SET paused_at=NULL, paused_duration=%s WHERE id=%s",
                        (paused_duration, log_id),
                    )
                    cursor.execute(
                        """
                        UPDATE task_pause_events
                        SET ended_at=%s, duration=%s
                        WHERE id=(
                            SELECT id FROM task_pause_events
                            WHERE task_log_id=%s AND ended_at IS NULL
                            ORDER BY id DESC LIMIT 1
                        )
                        """,
                        (now, pause_delta, log_id),
                    )
                    paused_at = None

                connection.commit()
                active_elapsed, _, total_paused = _task_durations(
                    started_at=started_at,
                    ended_at=now,
                    paused_duration=paused_duration,
                    paused_at=paused_at,
                )
                cursor.close()
            return jsonify({
                "success": True,
                "paused": paused_at is not None,
                "active_elapsed_seconds": active_elapsed,
                "paused_duration": total_paused,
                "pause_count": pause_count,
            })
        except Exception as error:
            return jsonify({"error": str(error)}), 500

    @blueprint.post("/api/experiment/log_end")
    def log_end():
        if not tracking_enabled:
            return jsonify({"success": True, "tracking": False})
        payload = request.get_json(silent=True) or {}
        log_id = payload.get("log_id")
        submission = str(payload.get("code") or "")[:MAX_SUBMISSION_LENGTH]
        completion_reason = str(payload.get("completion_reason") or "confirmed").strip().lower()
        completion_note = str(payload.get("completion_note") or "").strip()[:MAX_INCIDENT_NOTE_LENGTH]
        if completion_reason not in COMPLETION_REASONS:
            return jsonify({"error": "Invalid completion reason."}), 400
        if completion_reason == "technical_failure":
            authorization_error = require_operator_pin()
            if authorization_error is not None:
                return authorization_error
        ended_at = time.time()
        try:
            with closing(store.connect()) as connection:
                cursor = connection.cursor()
                cursor.execute(
                    """
                    SELECT task_logs.start_time, task_logs.completed, task_logs.paused_at,
                           task_logs.paused_duration
                    FROM task_logs
                    JOIN users ON users.user_id = task_logs.user_id
                    WHERE task_logs.id=%s AND users.participant_id=%s
                    FOR UPDATE
                    """,
                    (log_id, current_participant().user_id),
                )
                row = cursor.fetchone()
                if not row:
                    cursor.close()
                    return jsonify({"error": "Log ID not found"}), 404
                if bool(row[1]):
                    cursor.close()
                    return jsonify({"success": True, "already_completed": True})
                started_at = float(row[0]) if row[0] is not None else ended_at
                paused_at = float(row[2]) if row[2] is not None else None
                previous_paused_duration = float(row[3] or 0.0)
                duration, wall_duration, total_paused_duration = _task_durations(
                    started_at=started_at,
                    ended_at=ended_at,
                    paused_duration=previous_paused_duration,
                    paused_at=paused_at,
                )
                if paused_at is not None:
                    pause_delta = max(0.0, ended_at - paused_at)
                    cursor.execute(
                        """
                        UPDATE task_pause_events
                        SET ended_at=%s, duration=%s
                        WHERE id=(
                            SELECT id FROM task_pause_events
                            WHERE task_log_id=%s AND ended_at IS NULL
                            ORDER BY id DESC LIMIT 1
                        )
                        """,
                        (ended_at, pause_delta, log_id),
                    )
                cursor.execute(
                    """
                    UPDATE task_logs
                    SET end_time=%s, duration=%s, wall_duration=%s, paused_at=NULL,
                        paused_duration=%s, completed=%s, completion_reason=%s,
                        completion_note=%s, submission=%s
                    WHERE id=%s AND completed=FALSE
                    """,
                    (
                        ended_at, duration, wall_duration, total_paused_duration, True,
                        completion_reason, completion_note, submission, log_id,
                    ),
                )
                connection.commit()
                cursor.close()
            return jsonify({
                "success": True,
                "duration": duration,
                "wall_duration": wall_duration,
                "paused_duration": total_paused_duration,
                "completion_reason": completion_reason,
            })
        except Exception as error:
            return jsonify({"error": str(error)}), 500

    @blueprint.post("/api/experiment/questionnaire")
    def save_questionnaire():
        values, validation_error = _validate_questionnaire(request.get_json(silent=True))
        if validation_error:
            return jsonify({"error": validation_error}), 400
        assert values is not None

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
                if participant_row[0] and participant_row[0] != current_participant().user_id:
                    cursor.close()
                    return jsonify({"error": "This questionnaire belongs to another participant."}), 403
                cursor.execute(
                    """
                    INSERT INTO experiment_questionnaire_responses (
                        user_id,
                        python_experience,
                        multi_agent_experience,
                        crewai_experience,
                        adk_experience,
                        ai_tool_frequency,
                        prior_gear_use,
                        method_ease,
                        mental_effort,
                        confidence,
                        framework_switch_ease,
                        reuse_helpfulness,
                        error_clarity,
                        future_use,
                        framework_transition_feedback,
                        feedback
                    ) VALUES (
                        %s, %s, %s, %s, %s, %s, %s, %s,
                        %s, %s, %s, %s, %s, %s, %s, %s
                    )
                    ON CONFLICT (user_id) DO UPDATE SET
                        python_experience = EXCLUDED.python_experience,
                        multi_agent_experience = EXCLUDED.multi_agent_experience,
                        crewai_experience = EXCLUDED.crewai_experience,
                        adk_experience = EXCLUDED.adk_experience,
                        ai_tool_frequency = EXCLUDED.ai_tool_frequency,
                        prior_gear_use = EXCLUDED.prior_gear_use,
                        method_ease = EXCLUDED.method_ease,
                        mental_effort = EXCLUDED.mental_effort,
                        confidence = EXCLUDED.confidence,
                        framework_switch_ease = EXCLUDED.framework_switch_ease,
                        reuse_helpfulness = EXCLUDED.reuse_helpfulness,
                        error_clarity = EXCLUDED.error_clarity,
                        future_use = EXCLUDED.future_use,
                        framework_transition_feedback = EXCLUDED.framework_transition_feedback,
                        feedback = EXCLUDED.feedback,
                        updated_at = CURRENT_TIMESTAMP
                    """,
                    (
                        values["user_id"],
                        values["python_experience"],
                        values["multi_agent_experience"],
                        values["crewai_experience"],
                        values["adk_experience"],
                        values["ai_tool_frequency"],
                        values["prior_gear_use"],
                        values["method_ease"],
                        values["mental_effort"],
                        values["confidence"],
                        values["framework_switch_ease"],
                        values["reuse_helpfulness"],
                        values["error_clarity"],
                        values["future_use"],
                        values["framework_transition_feedback"],
                        values["feedback"],
                    ),
                )
                connection.commit()
                cursor.close()
            return jsonify({"success": True, "saved": True, "tracking": True})
        except Exception as error:
            return jsonify({"error": str(error)}), 500

    return blueprint