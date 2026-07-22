from gear_sdk.runner import run_python


def test_runner_uses_an_isolated_writable_home():
    result = run_python(
        """
import os
from pathlib import Path

home = Path(os.environ["HOME"])
paths = [
    home / ".local" / "share" / "gear-test",
    Path(os.environ["XDG_CACHE_HOME"]) / "gear-test",
    Path(os.environ["XDG_CONFIG_HOME"]) / "gear-test",
]
for path in paths:
    path.mkdir(parents=True, exist_ok=True)
    (path / "writable").write_text("yes", encoding="utf-8")
print(home == Path.cwd())
""",
        timeout=10,
    )

    assert result.returncode == 0
    assert result.stdout.strip() == "True"
    assert result.stderr == ""


def test_runner_passes_server_tracking_context_to_generated_code():
    result = run_python(
        "import os; print('|'.join(os.environ[key] for key in "
        "['GEAR_MLFLOW_MANAGED', 'GEAR_PARTICIPANT_ID', 'GEAR_SESSION_ID', 'GEAR_PROJECT_ID', 'GEAR_BUILD_ID']))",
        timeout=10,
        managed_mlflow=True,
        participant_id="participant-one",
        session_id="session-one",
        project_id="project-one",
        build_id="build-one",
    )

    assert result.returncode == 0
    assert result.stdout.strip() == "true|participant-one|session-one|project-one|build-one"


def test_runner_keeps_generated_mlflow_autonomous_by_default():
    result = run_python(
        "import os; print(os.environ.get('GEAR_MLFLOW_MANAGED', 'autonomous'))",
        timeout=10,
    )

    assert result.returncode == 0
    assert result.stdout.strip() == "autonomous"
