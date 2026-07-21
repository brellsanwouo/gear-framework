from __future__ import annotations

import os
import subprocess
import time

from flask import Blueprint, jsonify, request

from gear_sdk import runner as gear_runner
from gear_sdk.store import BuildStore

from ..services import observability
from ..services.execution import ensure_crewai_kickoff, parse_trace_id, prepend_google_adk_imports, strip_trace_markers


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
        code = str(payload.get("code") or "")
        target = str(payload.get("target") or "crewai").lower()
        if not code.strip():
            return jsonify({"error": "Empty code"}), 400

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
        build_id = payload.get("build_id")
        mlflow_run_id = observability.record_execution(
            build_id=str(build_id) if build_id else None,
            target=target,
            returncode=result.returncode,
            duration_ms=duration_ms,
            stdout=result.stdout,
            stderr=strip_trace_markers(result.stderr),
            external_trace_id=external_trace_id,
        )
        trace_id = mlflow_run_id or external_trace_id
        run_id = None
        if build_id:
            try:
                run_id = BuildStore(store_path).record_run(
                    build_id,
                    "succeeded" if result.returncode == 0 else "failed",
                    result.stdout,
                    result.stderr,
                    trace_id,
                )
            except KeyError as error:
                return jsonify({"error": str(error)}), 404

        return jsonify({
            "run_id": run_id,
            "trace_id": trace_id,
            "mlflow_run_id": mlflow_run_id,
            "stdout": result.stdout,
            "stderr": strip_trace_markers(result.stderr),
            "returncode": result.returncode,
        })

    return blueprint
