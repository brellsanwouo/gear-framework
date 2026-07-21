from __future__ import annotations

import sys
from types import SimpleNamespace

from gear_web.services import observability


class _RunContext:
    def __init__(self, run_id: str) -> None:
        self.info = SimpleNamespace(run_id=run_id)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:
        return None


def test_mlflow_status_requires_a_tracking_uri(monkeypatch):
    monkeypatch.delenv("MLFLOW_TRACKING_URI", raising=False)
    monkeypatch.setenv("GEAR_MLFLOW_ENABLED", "true")

    assert observability.status() == {
        "enabled": False,
        "configured": False,
        "experiment": "gear-framework-production",
    }


def test_record_execution_logs_metrics_and_outputs(monkeypatch):
    calls: dict[str, object] = {}
    fake_mlflow = SimpleNamespace(
        set_tracking_uri=lambda value: calls.update(tracking_uri=value),
        set_experiment=lambda value: calls.update(experiment=value),
        start_run=lambda **values: (calls.update(start_run=values) or _RunContext("mlflow-run-1")),
        set_tags=lambda values: calls.update(tags=values),
        log_metrics=lambda values: calls.update(metrics=values),
        log_text=lambda value, path: calls.setdefault("texts", []).append((path, value)),
    )
    monkeypatch.setitem(sys.modules, "mlflow", fake_mlflow)
    monkeypatch.setenv("MLFLOW_TRACKING_URI", "http://mlflow.internal:5000")
    monkeypatch.setenv("GEAR_MLFLOW_ENABLED", "true")
    monkeypatch.setenv("MLFLOW_EXPERIMENT_NAME", "gear-production")

    run_id = observability.record_execution(
        build_id="build-123",
        target="crewai",
        returncode=0,
        duration_ms=250,
        stdout="result",
        stderr="",
        external_trace_id="trace-123",
        user_id="participant-123",
        session_id="session-123",
        project_id="project-123",
    )

    assert run_id == "mlflow-run-1"
    assert calls["tracking_uri"] == "http://mlflow.internal:5000"
    assert calls["experiment"] == "gear-production"
    assert calls["metrics"] == {
        "duration_ms": 250.0,
        "return_code": 0.0,
        "stdout_chars": 6.0,
        "stderr_chars": 0.0,
    }
    assert calls["tags"]["gear.build_id"] == "build-123"
    assert calls["tags"]["gear.user_id"] == "participant-123"
    assert calls["tags"]["gear.session_id"] == "session-123"
    assert calls["tags"]["gear.project_id"] == "project-123"
    assert calls["texts"] == [("execution/stdout.txt", "result")]
