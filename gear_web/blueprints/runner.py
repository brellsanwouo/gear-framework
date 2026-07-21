from __future__ import annotations

import os
import subprocess
import time

from flask import Blueprint, jsonify, request

from gear_sdk import runner as gear_runner
from gear_sdk.store import BuildStore

from ..services import observability
from ..services.execution import (
    ensure_crewai_kickoff,
    parse_trace_id,
    prepend_google_adk_imports,
    strip_crewai_tracing_messages,
    strip_trace_markers,
)


def _enabled() -> bool:
    return os.environ.get("GEAR_ENABLE_LOCAL_RUNNER", "").lower() in {"1", "true", "yes"}


def _timeout() -> int:
    return int(os.environ.get("GEAR_RUNNER_TIMEOUT", "180"))


def create_runner_blueprint(store_path: str) -> Blueprint:
    blueprint = Blueprint("runner", __name__)

    @blueprint.get("/api/run/status")
    def status():
        enabled = _enabled()
        return jsonify({
            "enabled": enabled,
            "timeout_seconds": _timeout(),
            "observability": observability.status(),
            "message": (
                "Local execution is available for trusted workflows."
                if enabled
                else "Local execution is disabled. Set GEAR_ENABLE_LOCAL_RUNNER=true and restart the server."
            ),
        })

    @blueprint.post("/api/run")
    def run():
        if not _enabled():
            return jsonify({
                "error": (
                    "Workflow execution is disabled by default. Set GEAR_ENABLE_LOCAL_RUNNER=true only for "
                    "trusted local workflows."
                )
            }), 403

        payload = request.get_json(silent=True) or {}
        build_id = str(payload.get("build_id") or "").strip()
        if not build_id:
            return jsonify({"error": "A generated build_id is required."}), 400
        build = BuildStore(store_path).get_build(build_id)
        if build is None:
            return jsonify({"error": "Build not found."}), 404
        if not build.get("server_generated"):
            return jsonify({"error": "Only server-generated Studio builds can be executed."}), 403
        target = str(build.get("target") or "").lower()
        requested_target = str(payload.get("target") or target).lower()
        if requested_target != target:
            return jsonify({"error": "Build target does not match the requested target."}), 400
        code = str((build.get("outputs") or {}).get("orchestration") or "")
        if not code.strip():
            return jsonify({"error": "This build contains no executable orchestration."}), 400

        if target in {"adk", "googleadk", "google-adk"}:
            executable = prepend_google_adk_imports(code)
        elif target == "crewai":
            executable = ensure_crewai_kickoff(code)
        else:
            executable = code
        started_at = time.perf_counter()
        try:
            result = gear_runner.run_python(executable, timeout=_timeout())
        except subprocess.TimeoutExpired:
            return jsonify({"error": "Execution timed out."}), 408

        duration_ms = round((time.perf_counter() - started_at) * 1000)
        external_trace_id = parse_trace_id(result.stderr)
        stdout = strip_crewai_tracing_messages(result.stdout) if target == "crewai" else result.stdout
        stderr = strip_trace_markers(result.stderr)
        mlflow_run_id = observability.record_execution(
            build_id=build_id,
            target=target,
            returncode=result.returncode,
            duration_ms=duration_ms,
            stdout=stdout,
            stderr=stderr,
            external_trace_id=external_trace_id,
        )
        trace_id = mlflow_run_id or external_trace_id
        run_id = BuildStore(store_path).record_run(
            build_id,
            "succeeded" if result.returncode == 0 else "failed",
            stdout,
            stderr,
            trace_id,
        )

        return jsonify({
            "run_id": run_id,
            "trace_id": trace_id,
            "mlflow_run_id": mlflow_run_id,
            "stdout": stdout,
            "stderr": stderr,
            "returncode": result.returncode,
        })

    return blueprint
