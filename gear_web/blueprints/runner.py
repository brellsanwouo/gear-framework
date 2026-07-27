from __future__ import annotations

import logging
import os
import subprocess
import threading
import time
import uuid
from typing import Any, Callable

from flask import Blueprint, jsonify, request

from gear_sdk import runner as gear_runner
from gear_sdk.store import BuildStore

from ..services import observability
from ..services.execution import (
    ManualCodeValidationError,
    ensure_crewai_kickoff,
    parse_trace_id,
    prepend_google_adk_imports,
    strip_crewai_tracing_messages,
    strip_trace_markers,
    validate_manual_code,
)
from ..services.participants import current_participant


LOGGER = logging.getLogger(__name__)
_RUN_JOBS: dict[str, dict[str, Any]] = {}
_RUN_JOBS_LOCK = threading.Lock()
_RUN_JOB_TTL_SECONDS = 3600


def _enabled() -> bool:
    return os.environ.get("GEAR_ENABLE_LOCAL_RUNNER", "").lower() in {"1", "true", "yes"}


def _manual_enabled() -> bool:
    return _enabled() and os.environ.get("GEAR_ENABLE_MANUAL_RUNNER", "").lower() in {
        "1",
        "true",
        "yes",
    }


def _timeout() -> int:
    return int(os.environ.get("GEAR_RUNNER_TIMEOUT", "180"))


def _manual_code_limit() -> int:
    return int(os.environ.get("GEAR_MANUAL_RUNNER_MAX_CODE_CHARS", "200000"))


def _prepare_executable(code: str, target: str) -> str:
    if target in {"adk", "googleadk", "google-adk"}:
        return prepend_google_adk_imports(code)
    if target == "crewai":
        return ensure_crewai_kickoff(code)
    return code


def _clean_output(target: str, stdout: str, stderr: str) -> tuple[str, str, str | None]:
    external_trace_id = parse_trace_id(stderr)
    clean_stdout = strip_crewai_tracing_messages(stdout) if target == "crewai" else stdout
    clean_stderr = strip_trace_markers(stderr)
    return clean_stdout, clean_stderr, external_trace_id


def create_runner_blueprint(store_path: str) -> Blueprint:
    blueprint = Blueprint("runner", __name__)

    def execute_build(
        build: dict[str, Any],
        identity,
        cancel_event: threading.Event | None = None,
    ) -> tuple[dict[str, Any], int]:
        build_id = str(build["id"])
        target = str(build.get("target") or "").lower()
        code = str((build.get("outputs") or {}).get("orchestration") or "")
        executable = _prepare_executable(code, target)
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
                cancel_event=cancel_event,
            )
        except gear_runner.RunCancelled as error:
            stdout, stderr, _ = _clean_output(target, error.stdout, error.stderr)
            return {
                "cancelled": True,
                "stdout": stdout,
                "stderr": stderr,
                "returncode": None,
                "error": "Execution cancelled.",
            }, 409
        except subprocess.TimeoutExpired:
            return {"error": f"Execution timed out after {_timeout()} seconds."}, 408

        duration_ms = round((time.perf_counter() - started_at) * 1000)
        stdout, stderr, external_trace_id = _clean_output(target, result.stdout, result.stderr)
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
            "duration_ms": duration_ms,
        }, 200

    def execute_manual(
        code: str,
        target: str,
        log_id: str,
        identity,
        cancel_event: threading.Event | None = None,
    ) -> tuple[dict[str, Any], int]:
        manual_run_id = f"manual-run-{uuid.uuid4()}"
        executable = _prepare_executable(code, target)
        project_id = f"experiment-log:{log_id}" if log_id else "manual-editor"
        started_at = time.perf_counter()

        try:
            result = gear_runner.run_python(
                executable,
                timeout=_timeout(),
                managed_mlflow=True,
                participant_id=identity.user_id,
                session_id=identity.session_id,
                project_id=project_id,
                build_id=manual_run_id,
                cancel_event=cancel_event,
            )
        except gear_runner.RunCancelled as error:
            stdout, stderr, _ = _clean_output(target, error.stdout, error.stderr)
            return {
                "cancelled": True,
                "manual_run_id": manual_run_id,
                "stdout": stdout,
                "stderr": stderr,
                "returncode": None,
                "error": "Execution cancelled.",
            }, 409
        except subprocess.TimeoutExpired:
            return {
                "manual_run_id": manual_run_id,
                "error": f"Execution timed out after {_timeout()} seconds.",
            }, 408

        duration_ms = round((time.perf_counter() - started_at) * 1000)
        stdout, stderr, external_trace_id = _clean_output(target, result.stdout, result.stderr)
        mlflow_run_id = observability.record_execution(
            build_id=manual_run_id,
            target=f"manual-{target}",
            returncode=result.returncode,
            duration_ms=duration_ms,
            stdout=stdout,
            stderr=stderr,
            external_trace_id=external_trace_id,
            user_id=identity.user_id,
            session_id=identity.session_id,
            project_id=project_id,
        )
        trace_id = external_trace_id or mlflow_run_id
        return {
            "manual_run_id": manual_run_id,
            "trace_id": trace_id,
            "mlflow_run_id": mlflow_run_id,
            "stdout": stdout,
            "stderr": stderr,
            "returncode": result.returncode,
            "duration_ms": duration_ms,
        }, 200

    def _remove_expired_jobs(now: float) -> None:
        expired = [
            key
            for key, value in _RUN_JOBS.items()
            if now - float(value.get("updated_at") or now) > _RUN_JOB_TTL_SECONDS
        ]
        for key in expired:
            _RUN_JOBS.pop(key, None)

    def execute_job(
        job_id: str,
        executor: Callable[..., tuple[dict[str, Any], int]],
        args: tuple[Any, ...],
    ) -> None:
        with _RUN_JOBS_LOCK:
            job = _RUN_JOBS.get(job_id)
            cancel_event = job.get("cancel_event") if job else None
        try:
            result, status_code = executor(*args, cancel_event=cancel_event)
        except Exception as error:
            LOGGER.exception("Asynchronous workflow execution failed")
            result, status_code = {"error": f"Execution failed: {error}"}, 500
        with _RUN_JOBS_LOCK:
            job = _RUN_JOBS.get(job_id)
            if job is not None:
                job.update(
                    status="completed",
                    result=result,
                    status_code=status_code,
                    updated_at=time.time(),
                )

    def start_job(
        *,
        identity,
        kind: str,
        executor: Callable[..., tuple[dict[str, Any], int]],
        args: tuple[Any, ...],
    ) -> str:
        job_id = f"run-job-{uuid.uuid4()}"
        now = time.time()
        with _RUN_JOBS_LOCK:
            _remove_expired_jobs(now)
            _RUN_JOBS[job_id] = {
                "participant_id": identity.user_id,
                "kind": kind,
                "status": "running",
                "updated_at": now,
                "cancel_event": threading.Event(),
            }
        threading.Thread(target=execute_job, args=(job_id, executor, args), daemon=True).start()
        return job_id

    @blueprint.get("/api/run/status")
    def status():
        enabled = _enabled()
        manual_enabled = _manual_enabled()
        return jsonify({
            "enabled": enabled,
            "manual_enabled": manual_enabled,
            "timeout_seconds": _timeout(),
            "manual_max_code_chars": _manual_code_limit(),
            "observability": observability.status(),
            "message": (
                "Studio execution is available."
                if enabled
                else "Local execution is disabled. Set GEAR_ENABLE_LOCAL_RUNNER=true and restart the server."
            ),
            "manual_message": (
                "Manual experiment execution is available for trusted participants."
                if manual_enabled
                else "Manual execution is disabled. Enable both GEAR_ENABLE_LOCAL_RUNNER and GEAR_ENABLE_MANUAL_RUNNER."
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
            job_id = start_job(
                identity=identity,
                kind="studio",
                executor=execute_build,
                args=(build, identity),
            )
            return jsonify({"job_id": job_id, "status": "running"}), 202

        try:
            result, status_code = execute_build(build, identity)
            return jsonify(result), status_code
        except Exception as error:
            LOGGER.exception("Workflow execution failed")
            return jsonify({"error": f"Execution failed: {error}"}), 500

    @blueprint.post("/api/run/manual")
    def run_manual():
        if not _manual_enabled():
            return jsonify({
                "error": (
                    "Manual execution is disabled. Set GEAR_ENABLE_LOCAL_RUNNER=true and "
                    "GEAR_ENABLE_MANUAL_RUNNER=true, then restart the server."
                )
            }), 403

        payload = request.get_json(silent=True) or {}
        identity = current_participant()
        code = str(payload.get("code") or "")
        target = str(payload.get("target") or "crewai").strip().lower()
        log_id = str(payload.get("log_id") or "").strip()[:128]

        if not code.strip():
            return jsonify({"error": "Python code is required."}), 400
        if len(code) > _manual_code_limit():
            return jsonify({
                "error": f"The script exceeds the {_manual_code_limit()} character limit."
            }), 413
        if target not in {"crewai", "adk"}:
            return jsonify({"error": "Manual execution supports only CrewAI and Google ADK."}), 400

        try:
            validate_manual_code(code, target)
        except ManualCodeValidationError as error:
            return jsonify({"error": str(error)}), 400

        if payload.get("async") is True:
            job_id = start_job(
                identity=identity,
                kind="manual",
                executor=execute_manual,
                args=(code, target, log_id, identity),
            )
            return jsonify({"job_id": job_id, "status": "running"}), 202

        try:
            result, status_code = execute_manual(code, target, log_id, identity)
            return jsonify(result), status_code
        except Exception as error:
            LOGGER.exception("Manual workflow execution failed")
            return jsonify({"error": f"Execution failed: {error}"}), 500

    @blueprint.get("/api/run/jobs/<job_id>")
    def get_run_job(job_id: str):
        identity = current_participant()
        with _RUN_JOBS_LOCK:
            job = dict(_RUN_JOBS.get(job_id) or {})
            if job and time.time() - float(job.get("updated_at") or 0) > _RUN_JOB_TTL_SECONDS:
                _RUN_JOBS.pop(job_id, None)
                job = {}
        if not job or job.get("participant_id") != identity.user_id:
            return jsonify({"error": "Execution job not found."}), 404
        if job.get("status") != "completed":
            return jsonify({
                "job_id": job_id,
                "status": job.get("status", "running"),
                "kind": job.get("kind"),
            }), 202
        return jsonify({
            "job_id": job_id,
            "status": "completed",
            "kind": job.get("kind"),
            **job["result"],
        }), int(job["status_code"])

    @blueprint.delete("/api/run/jobs/<job_id>")
    def cancel_run_job(job_id: str):
        identity = current_participant()
        with _RUN_JOBS_LOCK:
            job = _RUN_JOBS.get(job_id)
            if not job or job.get("participant_id") != identity.user_id:
                return jsonify({"error": "Execution job not found."}), 404
            if job.get("status") == "completed":
                return jsonify({"job_id": job_id, "status": "completed"}), 200
            cancel_event = job.get("cancel_event")
            if cancel_event is not None:
                cancel_event.set()
            job["status"] = "cancelling"
            job["updated_at"] = time.time()
        return jsonify({"job_id": job_id, "status": "cancelling"}), 202

    return blueprint