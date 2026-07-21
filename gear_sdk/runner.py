from __future__ import annotations

import os
import resource
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path


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
}


@dataclass(frozen=True)
class RunResult:
    stdout: str
    stderr: str
    returncode: int


def _limits() -> None:
    cpu_seconds = int(os.environ.get("GEAR_RUNNER_CPU_SECONDS", "60"))
    memory_mb = int(os.environ.get("GEAR_RUNNER_MEMORY_MB", "2048"))
    output_mb = int(os.environ.get("GEAR_RUNNER_OUTPUT_MB", "10"))
    resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds))
    resource.setrlimit(resource.RLIMIT_AS, (memory_mb * 1024 * 1024, memory_mb * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_FSIZE, (output_mb * 1024 * 1024, output_mb * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_NOFILE, (128, 128))


def run_python(code: str, *, timeout: int = 180) -> RunResult:
    """Run trusted local generated code with a minimal environment and hard limits.

    This is defense in depth, not a multi-tenant sandbox. The web endpoint remains
    disabled unless GEAR_ENABLE_LOCAL_RUNNER is explicitly enabled.
    """
    environment = {key: value for key, value in os.environ.items() if key in ALLOWED_ENVIRONMENT}
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
            # GEAR records observability in MLflow. Keep CrewAI's separate
            # hosted tracing and anonymous telemetry disabled in online runs.
            "CREWAI_TRACING_ENABLED": "false",
            "CREWAI_DISABLE_TELEMETRY": "true",
        })
        script = Path(temporary) / "orchestration.py"
        script.write_text(code, encoding="utf-8")
        completed = subprocess.run(
            [sys.executable, "-I", str(script)],
            capture_output=True,
            text=True,
            env=environment,
            cwd=temporary,
            timeout=timeout,
            check=False,
            start_new_session=True,
            preexec_fn=_limits if os.name == "posix" else None,
        )
    return RunResult(completed.stdout or "", completed.stderr or "", completed.returncode)
