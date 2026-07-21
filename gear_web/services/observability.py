from __future__ import annotations

import importlib
import logging
import os
from typing import Any


LOGGER = logging.getLogger(__name__)
DEFAULT_EXPERIMENT = "gear-framework-production"


def _as_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def status() -> dict[str, Any]:
    tracking_uri = os.environ.get("MLFLOW_TRACKING_URI", "").strip()
    configured = bool(tracking_uri)
    enabled = configured and _as_bool(os.environ.get("GEAR_MLFLOW_ENABLED"), default=True)
    return {
        "enabled": enabled,
        "configured": configured,
        "experiment": os.environ.get("MLFLOW_EXPERIMENT_NAME", DEFAULT_EXPERIMENT).strip()
        or DEFAULT_EXPERIMENT,
    }


def record_execution(
    *,
    build_id: str | None,
    target: str,
    returncode: int,
    duration_ms: int,
    stdout: str,
    stderr: str,
    external_trace_id: str | None = None,
    user_id: str | None = None,
    session_id: str | None = None,
    project_id: str | None = None,
) -> str | None:
    configuration = status()
    if not configuration["enabled"]:
        return None

    try:
        mlflow = importlib.import_module("mlflow")
        mlflow.set_tracking_uri(os.environ["MLFLOW_TRACKING_URI"].strip())
        mlflow.set_experiment(configuration["experiment"])
        run_name = f"{target}:{(build_id or 'untracked')[:12]}"
        with mlflow.start_run(run_name=run_name) as active_run:
            run_id = active_run.info.run_id
            mlflow.set_tags({
                "gear.target": target,
                "gear.status": "succeeded" if returncode == 0 else "failed",
                "gear.build_id": build_id or "",
                "gear.user_id": user_id or "",
                "gear.session_id": session_id or "",
                "gear.project_id": project_id or "",
                "gear.external_trace_id": external_trace_id or "",
            })
            mlflow.log_metrics({
                "duration_ms": float(duration_ms),
                "return_code": float(returncode),
                "stdout_chars": float(len(stdout)),
                "stderr_chars": float(len(stderr)),
            })
            if _as_bool(os.environ.get("GEAR_MLFLOW_LOG_OUTPUTS"), default=True):
                max_chars = int(os.environ.get("GEAR_MLFLOW_MAX_LOG_CHARS", "100000"))
                if stdout:
                    mlflow.log_text(stdout[:max_chars], "execution/stdout.txt")
                if stderr:
                    mlflow.log_text(stderr[:max_chars], "execution/stderr.txt")
        return run_id
    except Exception:
        LOGGER.exception("Unable to record the GEAR execution in MLflow")
        return None
