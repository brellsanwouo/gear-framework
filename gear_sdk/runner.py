from __future__ import annotations

import json
import os
import resource
import signal
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from threading import Event


ALLOWED_ENVIRONMENT = {
    "OPENAI_API_KEY",
    "OPENAI_KEY",
    "OPENAI_TOKEN",
    "GOOGLE_API_KEY",
    "GEMINI_API_KEY",
    "ANTHROPIC_API_KEY",
    "AZURE_API_KEY",
    "AZURE_API_BASE",
    "AZURE_API_VERSION",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "SSL_CERT_FILE",
    "REQUESTS_CA_BUNDLE",
    "MLFLOW_TRACKING_URI",
    "MLFLOW_TRACKING_USERNAME",
    "MLFLOW_TRACKING_PASSWORD",
    "MLFLOW_TRACKING_TOKEN",
    "MLFLOW_EXPERIMENT_NAME",
    "MLFLOW_HTTP_REQUEST_TIMEOUT",
    "MLFLOW_HTTP_REQUEST_MAX_RETRIES",
    "GEAR_MLFLOW_LOG_OUTPUTS",
    "GEAR_MLFLOW_MAX_LOG_CHARS",
}


@dataclass(frozen=True)
class RunResult:
    stdout: str
    stderr: str
    returncode: int


class RunCancelled(RuntimeError):
    """Raised when an asynchronous Python execution is cancelled by the user."""

    def __init__(self, stdout: str = "", stderr: str = "") -> None:
        super().__init__("Execution cancelled.")
        self.stdout = stdout
        self.stderr = stderr


def _limits() -> None:
    cpu_seconds = int(os.environ.get("GEAR_RUNNER_CPU_SECONDS", "60"))
    memory_mb = int(os.environ.get("GEAR_RUNNER_MEMORY_MB", "2048"))
    output_mb = int(os.environ.get("GEAR_RUNNER_OUTPUT_MB", "10"))
    resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds))
    resource.setrlimit(resource.RLIMIT_AS, (memory_mb * 1024 * 1024, memory_mb * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_FSIZE, (output_mb * 1024 * 1024, output_mb * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_NOFILE, (128, 128))


def _terminate_process(process: subprocess.Popen[str]) -> tuple[str, str]:
    if process.poll() is None:
        try:
            if os.name == "posix":
                os.killpg(process.pid, signal.SIGTERM)
            else:
                process.terminate()
            process.wait(timeout=2)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            try:
                if os.name == "posix":
                    os.killpg(process.pid, signal.SIGKILL)
                else:
                    process.kill()
            except ProcessLookupError:
                pass

    stdout, stderr = process.communicate()
    return stdout or "", stderr or ""


def run_python(
    code: str,
    *,
    timeout: int = 180,
    managed_mlflow: bool = False,
    participant_id: str | None = None,
    session_id: str | None = None,
    project_id: str | None = None,
    build_id: str | None = None,
    mlflow_context: dict[str, str] | None = None,
    enable_mlflow: bool = True,
    cancel_event: Event | None = None,
) -> RunResult:
    """Run Python code in an isolated temporary directory with hard resource limits.

    The process receives only a small allowlist of environment variables and cannot
    access the parent process environment through normal means. This remains
    defense in depth rather than a secure multi-tenant sandbox; manual execution
    must therefore stay disabled unless the experiment participants are trusted.
    """
    environment = {key: value for key, value in os.environ.items() if key in ALLOWED_ENVIRONMENT}
    if not enable_mlflow:
        environment = {key: value for key, value in environment.items() if not key.startswith("MLFLOW_")}
    with tempfile.TemporaryDirectory(prefix="gear-run-") as temporary:
        runtime_home = Path(temporary)
        runtime_data = runtime_home / ".local" / "share"
        runtime_cache = runtime_home / ".cache"
        runtime_config = runtime_home / ".config"
        for directory in (runtime_data, runtime_cache, runtime_config):
            directory.mkdir(parents=True, exist_ok=True)
        environment.update({
            "HOME": temporary,
            "XDG_DATA_HOME": str(runtime_data),
            "XDG_CACHE_HOME": str(runtime_cache),
            "XDG_CONFIG_HOME": str(runtime_config),
            "TMPDIR": temporary,
            "TEMP": temporary,
            "TMP": temporary,
            "PYTHONUNBUFFERED": "1",
            "PYTHONNOUSERSITE": "1",
            "PATH": os.defpath,
            "CREWAI_TRACING_ENABLED": "false",
            "CREWAI_DISABLE_TELEMETRY": "true",
        })
        if managed_mlflow and enable_mlflow:
            environment["GEAR_MLFLOW_MANAGED"] = "true"
        if mlflow_context and enable_mlflow:
            environment["GEAR_MLFLOW_CONTEXT_JSON"] = json.dumps(mlflow_context, ensure_ascii=False)
        for key, value in {
            "GEAR_PARTICIPANT_ID": participant_id,
            "GEAR_SESSION_ID": session_id,
            "GEAR_PROJECT_ID": project_id,
            "GEAR_BUILD_ID": build_id,
        }.items():
            if value:
                environment[key] = value

        script = Path(temporary) / "orchestration.py"
        script.write_text(code, encoding="utf-8")
        process = subprocess.Popen(
            [sys.executable, "-I", str(script)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=environment,
            cwd=temporary,
            start_new_session=True,
            preexec_fn=_limits if os.name == "posix" else None,
        )

        deadline = time.monotonic() + timeout
        while True:
            if cancel_event is not None and cancel_event.is_set():
                stdout, stderr = _terminate_process(process)
                raise RunCancelled(stdout, stderr)

            remaining = deadline - time.monotonic()
            if remaining <= 0:
                stdout, stderr = _terminate_process(process)
                raise subprocess.TimeoutExpired(
                    cmd=[sys.executable, "-I", str(script)],
                    timeout=timeout,
                    output=stdout,
                    stderr=stderr,
                )

            try:
                stdout, stderr = process.communicate(timeout=min(0.25, remaining))
                return RunResult(stdout or "", stderr or "", int(process.returncode or 0))
            except subprocess.TimeoutExpired:
                continue