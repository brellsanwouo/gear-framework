from __future__ import annotations

import hashlib
from contextlib import closing
from dataclasses import dataclass
from typing import Any

import psycopg2


class ExperimentContextError(ValueError):
    """Raised when an execution cannot be linked to the active experiment task."""


@dataclass(frozen=True)
class ExperimentRunContext:
    task_log_id: int
    experiment_user_id: str
    task_id: str
    mode: str
    framework: str
    sequence_index: int
    study_phase: str
    included_in_primary_analysis: bool
    study_code: str = ""

    def mlflow_tags(self) -> dict[str, str]:
        return {
            "gear.experiment_user_id": self.experiment_user_id,
            "gear.task_log_id": str(self.task_log_id),
            "gear.task_id": self.task_id,
            "gear.mode": self.mode,
            "gear.framework": self.framework,
            "gear.study_phase": self.study_phase,
            "gear.sequence_index": str(self.sequence_index),
            "gear.primary_analysis": (
                "true" if self.included_in_primary_analysis else "false"
            ),
            "gear.study_code": self.study_code,
        }


def _connect(database: dict[str, Any]):
    if database.get("url"):
        return psycopg2.connect(database["url"])
    if not database.get("password"):
        raise ExperimentContextError("The research database is not configured.")
    return psycopg2.connect(
        host=database["host"],
        port=database["port"],
        user=database["user"],
        password=database["password"],
        dbname=database["database"],
    )


def load_experiment_run_context(
    database: dict[str, Any],
    *,
    task_log_id: int,
    participant_id: str,
    expected_mode: str,
    expected_framework: str,
) -> ExperimentRunContext:
    """Load and validate the unique experiment task linked to an execution.

    The browser only submits ``task_log_id``. All other MLflow metadata is read
    from PostgreSQL so Studio and MANUAL executions cannot disagree with the
    experiment assignment.
    """

    with closing(_connect(database)) as connection:
        cursor = connection.cursor()
        cursor.execute(
            """
            SELECT
                task_logs.id,
                task_logs.user_id,
                task_logs.task_id,
                task_logs.mode,
                task_logs.framework,
                task_logs.sequence_index,
                task_logs.study_phase,
                task_logs.included_in_primary_analysis,
                task_logs.completed,
                users.study_code
            FROM task_logs
            JOIN users ON users.user_id = task_logs.user_id
            WHERE task_logs.id = %s
              AND users.participant_id = %s
            """,
            (task_log_id, participant_id),
        )
        row = cursor.fetchone()
        cursor.close()

    if row is None:
        raise ExperimentContextError("The experiment task log was not found.")

    mode = str(row[3] or "").upper()
    framework = str(row[4] or "").lower()
    if mode != expected_mode.upper():
        raise ExperimentContextError("The task log does not match the active experiment mode.")
    if framework != expected_framework.lower():
        raise ExperimentContextError("The task log does not match the requested framework.")
    if bool(row[8]):
        raise ExperimentContextError("This experiment task is already completed.")

    return ExperimentRunContext(
        task_log_id=int(row[0]),
        experiment_user_id=str(row[1]),
        task_id=str(row[2]),
        mode=mode,
        framework=framework,
        sequence_index=int(row[5]),
        study_phase=str(row[6] or "measured"),
        included_in_primary_analysis=bool(row[7]),
        study_code=str(row[9] or ""),
    )


def mark_experiment_execution_succeeded(
    database: dict[str, Any],
    *,
    context: ExperimentRunContext,
    execution_id: str,
    submission: str,
) -> None:
    """Persist the successful execution required to confirm a manual task."""

    with closing(_connect(database)) as connection:
        cursor = connection.cursor()
        cursor.execute(
            """
            UPDATE task_logs
            SET execution_succeeded = TRUE,
                successful_execution_id = %s,
                successful_submission_hash = %s
            WHERE id = %s
              AND completed = FALSE
            """,
            (
                execution_id,
                hashlib.sha256(submission.encode("utf-8")).hexdigest(),
                context.task_log_id,
            ),
        )
        updated = cursor.rowcount
        connection.commit()
        cursor.close()
    if updated != 1:
        raise ExperimentContextError(
            "The successful execution could not be linked to the active experiment task."
        )
