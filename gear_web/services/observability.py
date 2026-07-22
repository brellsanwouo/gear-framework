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
            tags = {
                "gear.target": target,
                "gear.status": "succeeded" if returncode == 0 else "failed",
                "gear.build_id": build_id or "",
                "gear.user_id": user_id or "",
                "gear.session_id": session_id or "",
                "gear.project_id": project_id or "",
                "gear.external_trace_id": external_trace_id or "",
            }
            mlflow.set_tags(tags)
            mlflow.log_metrics({
                "duration_ms": float(duration_ms),
                "return_code": float(returncode),
                "stdout_chars": float(len(stdout)),
                "stderr_chars": float(len(stderr)),
            })
            log_outputs = _as_bool(os.environ.get("GEAR_MLFLOW_LOG_OUTPUTS"), default=True)
            max_chars = int(os.environ.get("GEAR_MLFLOW_MAX_LOG_CHARS", "100000"))
            if log_outputs:
                if stdout:
                    mlflow.log_text(stdout[:max_chars], "execution/stdout.txt")
                if stderr:
                    mlflow.log_text(stderr[:max_chars], "execution/stderr.txt")

            # Generated code owns the detailed trace and reports its ID back
            # through a private stderr marker. Keep a summary trace only as a
            # fallback for failures that occur before instrumentation starts.
            if not external_trace_id:
                with mlflow.start_span(
                    name=f"gear.{target}",
                    span_type="CHAIN",
                    attributes={**tags, "gear.duration_ms": duration_ms},
                ) as span:
                    span.set_inputs({
                        "build_id": build_id or "",
                        "project_id": project_id or "",
                        "target": target,
                    })
                    span.set_outputs({
                        "status": tags["gear.status"],
                        "return_code": returncode,
                        "stdout": stdout[:max_chars] if log_outputs else "",
                        "stderr": stderr[:max_chars] if log_outputs else "",
                    })
                    span.set_status("OK" if returncode == 0 else "ERROR")
                    external_trace_id = span.trace_id
            mlflow.set_tag("gear.mlflow_trace_id", external_trace_id)
        return run_id
    except Exception:
        LOGGER.exception("Unable to record the GEAR execution in MLflow")
        return None
