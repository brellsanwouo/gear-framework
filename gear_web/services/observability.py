from __future__ import annotations

import importlib
import json
import logging
import os
import time
from typing import Any, Mapping


LOGGER = logging.getLogger(__name__)
DEFAULT_EXPERIMENT = "gear-framework-production"
_TOKEN_USAGE_ATTRIBUTE = "mlflow.chat.tokenUsage"
_MODEL_ATTRIBUTE = "mlflow.llm.model"
_PROVIDER_ATTRIBUTE = "mlflow.llm.provider"


def _as_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _as_non_negative_float(value: str | None, default: float) -> float:
    try:
        return max(0.0, float(value)) if value is not None else default
    except (TypeError, ValueError):
        return default


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


def empty_usage_summary(trace_id: str | None = None) -> dict[str, Any]:
    return {
        "trace_id": trace_id,
        "token_usage_available": False,
        "cost_available": False,
        "input_tokens": None,
        "output_tokens": None,
        "total_tokens": None,
        "input_cost_usd": None,
        "output_cost_usd": None,
        "total_cost_usd": None,
        "llm_call_count": 0,
        "calls": [],
    }


def _safe_mapping(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, Mapping) else {}


def _safe_int(value: Any) -> int | None:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _safe_float(value: Any) -> float | None:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _span_attribute(span: Any, name: str) -> Any:
    getter = getattr(span, "get_attribute", None)
    if callable(getter):
        try:
            return getter(name)
        except Exception:
            return None
    attributes = getattr(span, "attributes", None)
    if isinstance(attributes, Mapping):
        return attributes.get(name)
    return None


def _sum_values(items: list[dict[str, Any]], key: str, converter) -> Any:
    values = [converter(item.get(key)) for item in items]
    present = [value for value in values if value is not None]
    return sum(present) if present else None


def summarize_trace_usage(trace: Any, trace_id: str | None = None) -> dict[str, Any]:
    """Convert MLflow trace token/cost fields into a stable GEAR payload.

    Trace-level aggregates are authoritative. Per-span aggregation is used only as
    a fallback for older servers or traces whose aggregate fields have not yet
    been populated.
    """
    summary = empty_usage_summary(trace_id)
    info = getattr(trace, "info", None)
    data = getattr(trace, "data", None)

    trace_usage = _safe_mapping(getattr(info, "token_usage", None))
    trace_cost = _safe_mapping(getattr(info, "cost", None))
    calls: list[dict[str, Any]] = []

    for span in list(getattr(data, "spans", None) or []):
        usage = _safe_mapping(_span_attribute(span, _TOKEN_USAGE_ATTRIBUTE))
        cost = _safe_mapping(getattr(span, "llm_cost", None))
        if not usage and not cost:
            continue
        calls.append({
            "span_id": str(getattr(span, "span_id", "") or ""),
            "name": str(getattr(span, "name", "") or ""),
            "model": _span_attribute(span, _MODEL_ATTRIBUTE),
            "provider": _span_attribute(span, _PROVIDER_ATTRIBUTE),
            "input_tokens": _safe_int(usage.get("input_tokens")),
            "output_tokens": _safe_int(usage.get("output_tokens")),
            "total_tokens": _safe_int(usage.get("total_tokens")),
            "input_cost_usd": _safe_float(cost.get("input_cost")),
            "output_cost_usd": _safe_float(cost.get("output_cost")),
            "total_cost_usd": _safe_float(cost.get("total_cost")),
        })

    input_tokens = _safe_int(trace_usage.get("input_tokens"))
    output_tokens = _safe_int(trace_usage.get("output_tokens"))
    total_tokens = _safe_int(trace_usage.get("total_tokens"))
    if not trace_usage and calls:
        input_tokens = _sum_values(calls, "input_tokens", _safe_int)
        output_tokens = _sum_values(calls, "output_tokens", _safe_int)
        total_tokens = _sum_values(calls, "total_tokens", _safe_int)
        if total_tokens is None and input_tokens is not None and output_tokens is not None:
            total_tokens = input_tokens + output_tokens

    input_cost = _safe_float(trace_cost.get("input_cost"))
    output_cost = _safe_float(trace_cost.get("output_cost"))
    total_cost = _safe_float(trace_cost.get("total_cost"))
    if not trace_cost and calls:
        input_cost = _sum_values(calls, "input_cost_usd", _safe_float)
        output_cost = _sum_values(calls, "output_cost_usd", _safe_float)
        total_cost = _sum_values(calls, "total_cost_usd", _safe_float)
        if total_cost is None and input_cost is not None and output_cost is not None:
            total_cost = input_cost + output_cost

    summary.update({
        "trace_id": trace_id or str(getattr(info, "trace_id", "") or "") or None,
        "token_usage_available": any(
            value is not None for value in (input_tokens, output_tokens, total_tokens)
        ),
        "cost_available": any(value is not None for value in (input_cost, output_cost, total_cost)),
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": total_tokens,
        "input_cost_usd": input_cost,
        "output_cost_usd": output_cost,
        "total_cost_usd": total_cost,
        "llm_call_count": len(calls),
        "calls": calls,
    })
    return summary


def _wait_for_trace_usage(mlflow: Any, trace_id: str | None) -> dict[str, Any]:
    if not trace_id or not callable(getattr(mlflow, "get_trace", None)):
        return empty_usage_summary(trace_id)

    wait_seconds = _as_non_negative_float(
        os.environ.get("GEAR_MLFLOW_USAGE_WAIT_SECONDS"),
        default=3.0,
    )
    poll_seconds = max(
        0.05,
        _as_non_negative_float(
            os.environ.get("GEAR_MLFLOW_USAGE_POLL_INTERVAL_SECONDS"),
            default=0.25,
        ),
    )
    deadline = time.monotonic() + wait_seconds
    last_summary = empty_usage_summary(trace_id)

    while True:
        try:
            trace = mlflow.get_trace(trace_id=trace_id)
            if trace is not None:
                last_summary = summarize_trace_usage(trace, trace_id)
                if last_summary["token_usage_available"] and last_summary["cost_available"]:
                    return last_summary
        except Exception as error:
            LOGGER.debug("MLflow trace %s is not ready yet: %s", trace_id, error)

        if time.monotonic() >= deadline:
            return last_summary
        time.sleep(min(poll_seconds, max(0.0, deadline - time.monotonic())))


def _usage_metrics(summary: Mapping[str, Any]) -> dict[str, float]:
    metrics: dict[str, float] = {}
    mapping = {
        "llm_input_tokens": "input_tokens",
        "llm_output_tokens": "output_tokens",
        "llm_total_tokens": "total_tokens",
        "llm_input_cost_usd": "input_cost_usd",
        "llm_output_cost_usd": "output_cost_usd",
        "llm_total_cost_usd": "total_cost_usd",
        "llm_call_count": "llm_call_count",
    }
    for metric_name, field_name in mapping.items():
        value = summary.get(field_name)
        if value is not None:
            metrics[metric_name] = float(value)
    return metrics


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
) -> tuple[str | None, str | None, dict[str, Any]]:

    configuration = status()
    if not configuration["enabled"]:
        return None, external_trace_id, empty_usage_summary(external_trace_id)

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

        usage_summary = empty_usage_summary(external_trace_id)
        with mlflow.start_run(run_name=run_name) as active_run:
            run_id = active_run.info.run_id
            mlflow.set_tags(tags)

            metrics = {
                "duration_ms": float(duration_ms),
                "stdout_chars": float(len(stdout)),
                "stderr_chars": float(len(stderr)),
            }
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

            if external_trace_id:
                usage_summary = _wait_for_trace_usage(mlflow, external_trace_id)
                usage_metrics = _usage_metrics(usage_summary)
                if usage_metrics:
                    mlflow.log_metrics(usage_metrics)
                mlflow.log_text(
                    json.dumps(usage_summary, ensure_ascii=False, indent=2),
                    "execution/llm_usage.json",
                )

            trace_tags = {
                "gear.trace_id": resolved_trace_id or "",
                "gear.token_usage_available": str(
                    bool(usage_summary["token_usage_available"])
                ).lower(),
                "gear.cost_available": str(bool(usage_summary["cost_available"])).lower(),
                "gear.llm_call_count": str(int(usage_summary["llm_call_count"])),
            }
            mlflow.set_tags(trace_tags)

        return run_id, resolved_trace_id, usage_summary
    except Exception:
        LOGGER.exception("Unable to record the GEAR execution in MLflow")
        return None, external_trace_id, empty_usage_summary(external_trace_id)