from __future__ import annotations

import os
import logging
import subprocess
import threading
import time
import uuid
from typing import Any

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
from ..services.participants import current_participant


LOGGER = logging.getLogger(__name__)
_RUN_JOBS: dict[str, dict[str, Any]] = {}
_RUN_JOBS_LOCK = threading.Lock()
_RUN_JOB_TTL_SECONDS = 3600


def _enabled() -> bool:
    return os.environ.get("GEAR_ENABLE_LOCAL_RUNNER", "").lower() in {"1", "true", "yes"}


def _timeout() -> int:
    return int(os.environ.get("GEAR_RUNNER_TIMEOUT", "180"))


def create_runner_blueprint(store_path: str) -> Blueprint:
    blueprint = Blueprint("runner", __name__)

    def execute_build(build: dict[str, Any], identity) -> tuple[dict[str, Any], int]:
        build_id = str(build["id"])
        target = str(build.get("target") or "").lower()
        code = str((build.get("outputs") or {}).get("orchestration") or "")
        if target in {"adk", "googleadk", "google-adk"}:
            executable = prepend_google_adk_imports(code)
        elif target == "crewai":
            executable = ensure_crewai_kickoff(code)
        else:
            executable = code
        started_at = time.perf_counter()
        try:
            result = gear_runner.run_python(
                executable,
                timeout=_timeout(),
                managed_mlflow=True,
                participant_id=identity.user_id,
                session_id=identity.session_id,
                project_id=str(build.get("project_id") or ""),
                build_id=build_id,
            )
        except subprocess.TimeoutExpired:
            return {"error": f"Execution timed out after {_timeout()} seconds."}, 408

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
            user_id=identity.user_id,
            session_id=identity.session_id,
            project_id=str(build.get("project_id") or ""),
        )
        trace_id = external_trace_id or mlflow_run_id
        run_id = BuildStore(store_path).record_run(
            build_id,
            "succeeded" if result.returncode == 0 else "failed",
            stdout,
            stderr,
            trace_id,
            participant_id=identity.user_id,
            session_id=identity.session_id,
        )
        return {
            "run_id": run_id,
            "trace_id": trace_id,
            "mlflow_run_id": mlflow_run_id,
            "stdout": stdout,
            "stderr": stderr,
            "returncode": result.returncode,
        }, 200

    def execute_job(job_id: str, build: dict[str, Any], identity) -> None:
        try:
            result, status_code = execute_build(build, identity)
        except Exception as error:
            LOGGER.exception("Asynchronous workflow execution failed")
            result, status_code = {"error": f"Execution failed: {error}"}, 500
        with _RUN_JOBS_LOCK:
            job = _RUN_JOBS.get(job_id)
            if job is not None:
                job.update(status="completed", result=result, status_code=status_code, updated_at=time.time())

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
        identity = current_participant()
        build_id = str(payload.get("build_id") or "").strip()
        if not build_id:
            return jsonify({"error": "A generated build_id is required."}), 400
        build = BuildStore(store_path).get_build(build_id, participant_id=identity.user_id)
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

        if payload.get("async") is True:
            job_id = f"run-job-{uuid.uuid4()}"
            now = time.time()
            with _RUN_JOBS_LOCK:
                expired = [key for key, value in _RUN_JOBS.items() if now - value["updated_at"] > _RUN_JOB_TTL_SECONDS]
                for key in expired:
                    _RUN_JOBS.pop(key, None)
                _RUN_JOBS[job_id] = {
                    "participant_id": identity.user_id,
                    "status": "running",
                    "updated_at": now,
                }
            threading.Thread(target=execute_job, args=(job_id, build, identity), daemon=True).start()
            return jsonify({"job_id": job_id, "status": "running"}), 202

        try:
            result, status_code = execute_build(build, identity)
            return jsonify(result), status_code
        except Exception as error:
            LOGGER.exception("Workflow execution failed")
            return jsonify({"error": f"Execution failed: {error}"}), 500

    @blueprint.get("/api/run/jobs/<job_id>")
    def get_run_job(job_id: str):
        identity = current_participant()
        with _RUN_JOBS_LOCK:
            job = dict(_RUN_JOBS.get(job_id) or {})
            if job and time.time() - job["updated_at"] > _RUN_JOB_TTL_SECONDS:
                _RUN_JOBS.pop(job_id, None)
                job = {}
        if not job or job.get("participant_id") != identity.user_id:
            return jsonify({"error": "Execution job not found."}), 404
        if job.get("status") != "completed":
            return jsonify({"job_id": job_id, "status": "running"}), 202
        return jsonify({"job_id": job_id, "status": "completed", **job["result"]}), int(job["status_code"])

    return blueprint
