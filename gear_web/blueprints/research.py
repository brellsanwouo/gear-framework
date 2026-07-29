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
from ..services.questionnaires import (
    QUESTIONNAIRE_VERSION,
    validate_background_response,
    validate_final_response,
    validate_framework_response,
    validate_operator_report,
    validate_task_response,
)


EXPERIMENT_MODES = ("GEAR", "MANUAL")
SUPPORTED_EXPERIMENT_FRAMEWORKS = ("crewai", "adk")
COMPLETION_REASONS = {"confirmed", "timeout", "technical_failure", "withdrawal"}
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

                # Questionnaire data is split by measurement level: background, task,
                # framework, final debriefing, and operator report.
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS experiment_background_responses (
                        user_id VARCHAR(255) PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
                        "current_role" VARCHAR(40) NOT NULL,
                        python_duration VARCHAR(40) NOT NULL,
                        python_frequency VARCHAR(40) NOT NULL,
                        mas_experience VARCHAR(40) NOT NULL,
                        crewai_experience VARCHAR(40) NOT NULL,
                        adk_experience VARCHAR(40) NOT NULL,
                        ai_coding_frequency VARCHAR(40) NOT NULL,
                        prior_gear_use VARCHAR(40) NOT NULL,
                        technical_english SMALLINT NOT NULL,
                        questionnaire_version VARCHAR(32) NOT NULL,
                        submitted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS experiment_task_responses (
                        task_log_id BIGINT PRIMARY KEY REFERENCES task_logs(id) ON DELETE CASCADE,
                        user_id VARCHAR(255) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
                        seq_ease SMALLINT NOT NULL,
                        technical_impact SMALLINT NOT NULL,
                        reuse_extent SMALLINT,
                        previous_solution_help SMALLINT,
                        translation_rework SMALLINT,
                        questionnaire_version VARCHAR(32) NOT NULL,
                        submitted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
                    )
                    """
                )
                cursor.execute(
                    "CREATE INDEX IF NOT EXISTS idx_experiment_task_responses_user "
                    "ON experiment_task_responses(user_id)"
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS experiment_framework_responses (
                        id BIGSERIAL PRIMARY KEY,
                        user_id VARCHAR(255) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
                        framework VARCHAR(32) NOT NULL,
                        mental_demand SMALLINT NOT NULL,
                        physical_demand SMALLINT NOT NULL,
                        temporal_demand SMALLINT NOT NULL,
                        performance SMALLINT NOT NULL,
                        effort SMALLINT NOT NULL,
                        frustration SMALLINT NOT NULL,
                        raw_tlx_score NUMERIC(6,2) NOT NULL,
                        concept_clarity SMALLINT NOT NULL,
                        error_feedback_clarity SMALLINT,
                        questionnaire_version VARCHAR(32) NOT NULL,
                        submitted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE(user_id, framework)
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS experiment_final_responses (
                        user_id VARCHAR(255) PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
                        sus_1 SMALLINT NOT NULL, sus_2 SMALLINT NOT NULL,
                        sus_3 SMALLINT NOT NULL, sus_4 SMALLINT NOT NULL,
                        sus_5 SMALLINT NOT NULL, sus_6 SMALLINT NOT NULL,
                        sus_7 SMALLINT NOT NULL, sus_8 SMALLINT NOT NULL,
                        sus_9 SMALLINT NOT NULL, sus_10 SMALLINT NOT NULL,
                        sus_score NUMERIC(6,2) NOT NULL,
                        usefulness_1 SMALLINT NOT NULL, usefulness_2 SMALLINT NOT NULL,
                        usefulness_3 SMALLINT NOT NULL, usefulness_4 SMALLINT NOT NULL,
                        transfer_1 SMALLINT NOT NULL, transfer_2 SMALLINT NOT NULL,
                        transfer_3 SMALLINT NOT NULL, transfer_4 SMALLINT NOT NULL,
                        transfer_5 SMALLINT NOT NULL,
                        easier_framework VARCHAR(40) NOT NULL,
                        preferred_framework VARCHAR(40) NOT NULL,
                        preference_reason TEXT NOT NULL,
                        design_strategy TEXT NOT NULL,
                        translation_strategy TEXT NOT NULL,
                        main_difficulty TEXT NOT NULL,
                        main_help TEXT NOT NULL,
                        feedback_effect TEXT NOT NULL,
                        missing_support TEXT NOT NULL,
                        additional_feedback TEXT NOT NULL DEFAULT '',
                        technical_impact_overall SMALLINT NOT NULL,
                        technical_issue_description TEXT NOT NULL DEFAULT '',
                        experimenter_help VARCHAR(16) NOT NULL,
                        experimenter_help_description TEXT NOT NULL DEFAULT '',
                        questionnaire_version VARCHAR(32) NOT NULL,
                        submitted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS experiment_operator_reports (
                        user_id VARCHAR(255) PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
                        study_code VARCHAR(32) NOT NULL,
                        operator_id VARCHAR(16) NOT NULL,
                        protocol_followed BOOLEAN NOT NULL,
                        conceptual_help VARCHAR(16) NOT NULL,
                        technical_incidents VARCHAR(32) NOT NULL,
                        data_quality VARCHAR(40) NOT NULL,
                        incident_notes TEXT NOT NULL DEFAULT '',
                        quality_notes TEXT NOT NULL,
                        questionnaire_version VARCHAR(32) NOT NULL,
                        submitted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
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

    def owned_user_row(cursor, user_id: str):
        cursor.execute(
            """
            SELECT participant_id, study_code, assigned_mode, framework_order, task_order
            FROM users
            WHERE user_id=%s
            """,
            (user_id,),
        )
        row = cursor.fetchone()
        if row is None:
            return None, (jsonify({"error": "Unknown experiment participant."}), 404)
        if row[0] and row[0] != current_participant().user_id:
            return None, (jsonify({"error": "This experiment belongs to another participant."}), 403)
        return row, None

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

    @blueprint.get("/api/experiment/questionnaire_progress")
    def questionnaire_progress():
        user_id = str(request.args.get("user_id") or "").strip()
        if not user_id:
            return jsonify({"error": "The participant identifier is required."}), 400
        if not tracking_enabled:
            return jsonify({
                "tracking": False,
                "background_submitted": False,
                "task_log_ids": [],
                "frameworks": [],
                "final_submitted": False,
                "operator_report_submitted": False,
            })
        try:
            with closing(store.connect()) as connection:
                cursor = connection.cursor()
                _, ownership_error = owned_user_row(cursor, user_id)
                if ownership_error is not None:
                    cursor.close()
                    return ownership_error
                cursor.execute(
                    "SELECT 1 FROM experiment_background_responses WHERE user_id=%s",
                    (user_id,),
                )
                background_submitted = cursor.fetchone() is not None
                cursor.execute(
                    "SELECT task_log_id FROM experiment_task_responses WHERE user_id=%s",
                    (user_id,),
                )
                task_log_ids = [int(row[0]) for row in cursor.fetchall()]
                cursor.execute(
                    "SELECT framework FROM experiment_framework_responses WHERE user_id=%s",
                    (user_id,),
                )
                frameworks = [str(row[0]) for row in cursor.fetchall()]
                cursor.execute(
                    "SELECT 1 FROM experiment_final_responses WHERE user_id=%s",
                    (user_id,),
                )
                final_submitted = cursor.fetchone() is not None
                cursor.execute(
                    "SELECT 1 FROM experiment_operator_reports WHERE user_id=%s",
                    (user_id,),
                )
                operator_report_submitted = cursor.fetchone() is not None
                cursor.close()
            return jsonify({
                "tracking": True,
                "background_submitted": background_submitted,
                "task_log_ids": task_log_ids,
                "frameworks": frameworks,
                "final_submitted": final_submitted,
                "operator_report_submitted": operator_report_submitted,
            })
        except Exception as error:
            return jsonify({"error": str(error)}), 500

    @blueprint.post("/api/experiment/background_questionnaire")
    def save_background_questionnaire():
        try:
            values = validate_background_response(request.get_json(silent=True))
        except ValueError as error:
            return jsonify({"error": str(error)}), 400
        if not tracking_enabled:
            return jsonify({"success": True, "saved": False, "tracking": False})
        try:
            with closing(store.connect()) as connection:
                cursor = connection.cursor()
                _, ownership_error = owned_user_row(cursor, values["user_id"])
                if ownership_error is not None:
                    cursor.close()
                    return ownership_error
                cursor.execute(
                    """
                    INSERT INTO experiment_background_responses (
                        user_id, "current_role", python_duration, python_frequency,
                        mas_experience, crewai_experience, adk_experience,
                        ai_coding_frequency, prior_gear_use, technical_english,
                        questionnaire_version
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (user_id) DO UPDATE SET
                        "current_role"=EXCLUDED."current_role",
                        python_duration=EXCLUDED.python_duration,
                        python_frequency=EXCLUDED.python_frequency,
                        mas_experience=EXCLUDED.mas_experience,
                        crewai_experience=EXCLUDED.crewai_experience,
                        adk_experience=EXCLUDED.adk_experience,
                        ai_coding_frequency=EXCLUDED.ai_coding_frequency,
                        prior_gear_use=EXCLUDED.prior_gear_use,
                        technical_english=EXCLUDED.technical_english,
                        questionnaire_version=EXCLUDED.questionnaire_version,
                        updated_at=CURRENT_TIMESTAMP
                    """,
                    (
                        values["user_id"], values["current_role"], values["python_duration"],
                        values["python_frequency"], values["mas_experience"],
                        values["crewai_experience"], values["adk_experience"],
                        values["ai_coding_frequency"], values["prior_gear_use"],
                        values["technical_english"], QUESTIONNAIRE_VERSION,
                    ),
                )
                connection.commit()
                cursor.close()
            return jsonify({"success": True, "saved": True, "tracking": True})
        except Exception as error:
            return jsonify({"error": str(error)}), 500

    @blueprint.post("/api/experiment/task_questionnaire")
    def save_task_questionnaire():
        payload = request.get_json(silent=True) or {}
        if not tracking_enabled:
            return jsonify({"success": True, "saved": False, "tracking": False})
        user_id = str(payload.get("user_id") or "").strip()
        try:
            task_log_id = int(payload.get("task_log_id"))
        except (TypeError, ValueError):
            return jsonify({"error": "A valid task_log_id is required."}), 400
        try:
            with closing(store.connect()) as connection:
                cursor = connection.cursor()
                _, ownership_error = owned_user_row(cursor, user_id)
                if ownership_error is not None:
                    cursor.close()
                    return ownership_error
                cursor.execute(
                    """
                    SELECT study_phase, completed
                    FROM task_logs
                    WHERE id=%s AND user_id=%s
                    """,
                    (task_log_id, user_id),
                )
                task_row = cursor.fetchone()
                if task_row is None:
                    cursor.close()
                    return jsonify({"error": "Unknown task log."}), 404
                if not bool(task_row[1]):
                    cursor.close()
                    return jsonify({"error": "The task must be completed before answering."}), 409
                values = validate_task_response(
                    payload,
                    translation=str(task_row[0] or "") == "translation",
                )
                cursor.execute(
                    """
                    INSERT INTO experiment_task_responses (
                        task_log_id, user_id, seq_ease, technical_impact,
                        reuse_extent, previous_solution_help, translation_rework,
                        questionnaire_version
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (task_log_id) DO UPDATE SET
                        seq_ease=EXCLUDED.seq_ease,
                        technical_impact=EXCLUDED.technical_impact,
                        reuse_extent=EXCLUDED.reuse_extent,
                        previous_solution_help=EXCLUDED.previous_solution_help,
                        translation_rework=EXCLUDED.translation_rework,
                        questionnaire_version=EXCLUDED.questionnaire_version,
                        updated_at=CURRENT_TIMESTAMP
                    """,
                    (
                        values["task_log_id"], values["user_id"], values["seq_ease"],
                        values["technical_impact"], values["reuse_extent"],
                        values["previous_solution_help"], values["translation_rework"],
                        QUESTIONNAIRE_VERSION,
                    ),
                )
                connection.commit()
                cursor.close()
            return jsonify({"success": True, "saved": True, "tracking": True})
        except ValueError as error:
            return jsonify({"error": str(error)}), 400
        except Exception as error:
            return jsonify({"error": str(error)}), 500

    @blueprint.post("/api/experiment/framework_questionnaire")
    def save_framework_questionnaire():
        try:
            values = validate_framework_response(request.get_json(silent=True))
        except ValueError as error:
            return jsonify({"error": str(error)}), 400
        if not tracking_enabled:
            return jsonify({"success": True, "saved": False, "tracking": False})
        try:
            with closing(store.connect()) as connection:
                cursor = connection.cursor()
                user_row, ownership_error = owned_user_row(cursor, values["user_id"])
                if ownership_error is not None:
                    cursor.close()
                    return ownership_error
                assigned_frameworks = set(str(user_row[3] or "").split(","))
                if values["framework"] not in assigned_frameworks:
                    cursor.close()
                    return jsonify({"error": "This framework was not assigned to the participant."}), 400
                cursor.execute(
                    """
                    INSERT INTO experiment_framework_responses (
                        user_id, framework, mental_demand, physical_demand,
                        temporal_demand, performance, effort, frustration,
                        raw_tlx_score, concept_clarity, error_feedback_clarity,
                        questionnaire_version
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (user_id, framework) DO UPDATE SET
                        mental_demand=EXCLUDED.mental_demand,
                        physical_demand=EXCLUDED.physical_demand,
                        temporal_demand=EXCLUDED.temporal_demand,
                        performance=EXCLUDED.performance,
                        effort=EXCLUDED.effort,
                        frustration=EXCLUDED.frustration,
                        raw_tlx_score=EXCLUDED.raw_tlx_score,
                        concept_clarity=EXCLUDED.concept_clarity,
                        error_feedback_clarity=EXCLUDED.error_feedback_clarity,
                        questionnaire_version=EXCLUDED.questionnaire_version,
                        updated_at=CURRENT_TIMESTAMP
                    """,
                    (
                        values["user_id"], values["framework"], values["mental_demand"],
                        values["physical_demand"], values["temporal_demand"],
                        values["performance"], values["effort"], values["frustration"],
                        values["raw_tlx_score"], values["concept_clarity"],
                        values["error_feedback_clarity"], QUESTIONNAIRE_VERSION,
                    ),
                )
                connection.commit()
                cursor.close()
            return jsonify({
                "success": True,
                "saved": True,
                "tracking": True,
                "raw_tlx_score": values["raw_tlx_score"],
            })
        except Exception as error:
            return jsonify({"error": str(error)}), 500

    @blueprint.post("/api/experiment/final_questionnaire")
    def save_final_questionnaire():
        try:
            values = validate_final_response(request.get_json(silent=True))
        except ValueError as error:
            return jsonify({"error": str(error)}), 400
        if not tracking_enabled:
            return jsonify({"success": True, "saved": False, "tracking": False})
        columns = [
            *(f"sus_{index}" for index in range(1, 11)), "sus_score",
            *(f"usefulness_{index}" for index in range(1, 5)),
            *(f"transfer_{index}" for index in range(1, 6)),
            "easier_framework", "preferred_framework", "preference_reason",
            "design_strategy", "translation_strategy", "main_difficulty",
            "main_help", "feedback_effect", "missing_support", "additional_feedback",
            "technical_impact_overall", "technical_issue_description",
            "experimenter_help", "experimenter_help_description",
        ]
        try:
            with closing(store.connect()) as connection:
                cursor = connection.cursor()
                _, ownership_error = owned_user_row(cursor, values["user_id"])
                if ownership_error is not None:
                    cursor.close()
                    return ownership_error
                insert_columns = ["user_id", *columns, "questionnaire_version"]
                placeholders = ", ".join(["%s"] * len(insert_columns))
                updates = ", ".join(
                    f"{column}=EXCLUDED.{column}" for column in [*columns, "questionnaire_version"]
                )
                cursor.execute(
                    f"""
                    INSERT INTO experiment_final_responses ({', '.join(insert_columns)})
                    VALUES ({placeholders})
                    ON CONFLICT (user_id) DO UPDATE SET
                        {updates}, updated_at=CURRENT_TIMESTAMP
                    """,
                    (
                        values["user_id"],
                        *(values[column] for column in columns),
                        QUESTIONNAIRE_VERSION,
                    ),
                )
                connection.commit()
                cursor.close()
            return jsonify({
                "success": True,
                "saved": True,
                "tracking": True,
                "sus_score": values["sus_score"],
            })
        except Exception as error:
            return jsonify({"error": str(error)}), 500

    @blueprint.post("/api/experiment/operator_report")
    def save_operator_report():
        authorization_error = require_operator_pin()
        if authorization_error is not None:
            return authorization_error
        try:
            values = validate_operator_report(request.get_json(silent=True))
        except ValueError as error:
            return jsonify({"error": str(error)}), 400
        if not tracking_enabled:
            return jsonify({"success": True, "saved": False, "tracking": False})
        try:
            with closing(store.connect()) as connection:
                cursor = connection.cursor()
                user_row, ownership_error = owned_user_row(cursor, values["user_id"])
                if ownership_error is not None:
                    cursor.close()
                    return ownership_error
                cursor.execute(
                    """
                    INSERT INTO experiment_operator_reports (
                        user_id, study_code, operator_id, protocol_followed,
                        conceptual_help, technical_incidents, data_quality,
                        incident_notes, quality_notes, questionnaire_version
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (user_id) DO UPDATE SET
                        study_code=EXCLUDED.study_code,
                        operator_id=EXCLUDED.operator_id,
                        protocol_followed=EXCLUDED.protocol_followed,
                        conceptual_help=EXCLUDED.conceptual_help,
                        technical_incidents=EXCLUDED.technical_incidents,
                        data_quality=EXCLUDED.data_quality,
                        incident_notes=EXCLUDED.incident_notes,
                        quality_notes=EXCLUDED.quality_notes,
                        questionnaire_version=EXCLUDED.questionnaire_version,
                        updated_at=CURRENT_TIMESTAMP
                    """,
                    (
                        values["user_id"], str(user_row[1] or ""), values["operator_id"],
                        values["protocol_followed"], values["conceptual_help"],
                        values["technical_incidents"], values["data_quality"],
                        values["incident_notes"], values["quality_notes"],
                        QUESTIONNAIRE_VERSION,
                    ),
                )
                connection.commit()
                cursor.close()
            return jsonify({"success": True, "saved": True, "tracking": True})
        except Exception as error:
            return jsonify({"error": str(error)}), 500

    @blueprint.post("/api/experiment/questionnaire")
    def legacy_questionnaire_endpoint():
        return jsonify({
            "error": "This endpoint was replaced by the versioned experiment questionnaires."
        }), 410

    return blueprint