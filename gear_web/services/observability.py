from __future__ import annotations

import importlib
import logging
import os
from typing import Any, Mapping


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


def _clean_tags(values: Mapping[str, Any] | None) -> dict[str, str]:
    return {
        str(key): str(value)
        for key, value in (values or {}).items()
        if value is not None and str(value) != ""
    }


def record_execution(
    *,
    framework: str,
    execution_kind: str,
    execution_id: str,
    status_value: str,
    returncode: int | None,
    duration_ms: int,
    stdout: str,
    stderr: str,
    context_tags: Mapping[str, Any] | None = None,
    external_trace_id: str | None = None,
    build_id: str | None = None,
    project_id: str | None = None,
) -> tuple[str | None, str | None]:

    configuration = status()
    if not configuration["enabled"]:
        return None, external_trace_id

    try:
        mlflow = importlib.import_module("mlflow")
        mlflow.set_tracking_uri(os.environ["MLFLOW_TRACKING_URI"].strip())
        mlflow.set_experiment(configuration["experiment"])

        tags = {
            "gear.framework": framework,
            "gear.execution_kind": execution_kind,
            "gear.execution_id": execution_id,
            "gear.status": status_value,
        }
        tags.update(_clean_tags(context_tags))
        if build_id:
            tags["gear.build_id"] = build_id
        if project_id and "gear.task_log_id" not in tags:
            tags["gear.project_id"] = project_id

        task_id = tags.get("gear.task_id")
        task_log_id = tags.get("gear.task_log_id")
        if task_id and task_log_id:
            run_name = f"{task_id}:{framework}:{execution_kind}:log-{task_log_id}"
        else:
            run_name = f"{framework}:{execution_kind}:{execution_id[:12]}"

        with mlflow.start_run(run_name=run_name) as active_run:
            run_id = active_run.info.run_id
            mlflow.set_tags(tags)

            metrics = {"duration_ms": float(duration_ms)}
            if returncode is not None:
                metrics["return_code"] = float(returncode)
            mlflow.log_metrics(metrics)

            log_outputs = _as_bool(os.environ.get("GEAR_MLFLOW_LOG_OUTPUTS"), default=True)
            max_chars = int(os.environ.get("GEAR_MLFLOW_MAX_LOG_CHARS", "100000"))
            if log_outputs:
                if stdout:
                    mlflow.log_text(stdout[:max_chars], "execution/stdout.txt")
                if stderr:
                    mlflow.log_text(stderr[:max_chars], "execution/stderr.txt")

            resolved_trace_id = external_trace_id
            if not resolved_trace_id:
                with mlflow.start_span(
                    name=f"gear.execution.{framework}",
                    span_type="CHAIN",
                    attributes=tags,
                ) as span:
                    span.set_inputs({
                        "framework": framework,
                        "execution_kind": execution_kind,
                        "task_log_id": tags.get("gear.task_log_id", ""),
                        "task_id": tags.get("gear.task_id", ""),
                    })
                    span.set_outputs({
                        "status": status_value,
                        "return_code": returncode,
                        "stdout": stdout[:max_chars] if log_outputs else "",
                        "stderr": stderr[:max_chars] if log_outputs else "",
                    })
                    span.set_status("OK" if status_value == "succeeded" else "ERROR")
                    resolved_trace_id = span.trace_id

            if resolved_trace_id:
                mlflow.set_tag("gear.trace_id", resolved_trace_id)

        return run_id, resolved_trace_id
    except Exception:
        LOGGER.exception("Unable to record the GEAR execution in MLflow")
        return None, external_trace_id