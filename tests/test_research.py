from __future__ import annotations

import hashlib
import json
from types import SimpleNamespace

from flask import Flask

from gear_web.blueprints import research
from gear_web.blueprints.research import create_research_blueprint


def _research_client(tmp_path):
    tasks_path = tmp_path / "tasks.json"
    tasks_path.write_text(json.dumps({"T1": {"time_limit_seconds": 600}}), encoding="utf-8")
    app = Flask(__name__)
    app.register_blueprint(
        create_research_blueprint(
            base_dir=tmp_path,
            tasks_path=tasks_path,
            experiment_config={"frameworks": ["crewai", "adk"]},
            database={},
            tracking_enabled=False,
        )
    )
    return app.test_client()


def test_experiment_status_exposes_the_configured_framework_pair(tmp_path):
    response = _research_client(tmp_path).get("/api/experiment/status")

    assert response.status_code == 200
    assert response.get_json()["frameworks"] == ["crewai", "adk"]


def test_experiment_sequence_covers_training_both_framework_rounds_and_translation():
    sequence = research._build_sequence(
        training_task="T1",
        familiarization_task="T2",
        measured_task_order=["T3", "T4"],
        mode="GEAR",
        framework_order=("crewai", "adk"),
    )

    assert [(item["id"], item["framework"], item["study_phase"]) for item in sequence] == [
        ("T1", "crewai", "training"),
        ("T2", "crewai", "familiarization"),
        ("T3", "crewai", "first_implementation"),
        ("T4", "crewai", "first_implementation"),
        ("T3", "adk", "translation"),
        ("T4", "adk", "translation"),
    ]
    assert sequence[0]["collect_metrics"] is False
    assert sequence[1]["included_in_primary_analysis"] is False
    assert all(item["included_in_primary_analysis"] for item in sequence[2:])
    assert all(not item["seed_from_previous_framework"] for item in sequence[:4])
    assert all(item["seed_from_previous_framework"] for item in sequence[4:])


def test_background_questionnaire_rejects_an_incomplete_payload():
    try:
        research.validate_background_response({"user_id": "participant-test"})
    except ValueError as error:
        assert str(error) == "Invalid value for 'current_role'."
    else:
        raise AssertionError("An incomplete questionnaire should be rejected.")


def test_background_questionnaire_accepts_a_complete_payload():
    payload = {
        "user_id": "participant-test",
        "current_role": "software_developer",
        "python_duration": "3_5_years",
        "mas_experience": "one_project",
        "crewai_experience": "completed_tutorial",
        "adk_experience": "none",
        "ai_coding_frequency": "weekly",
        "prior_gear_use": "once_or_twice",
        "technical_english": 6,
    }

    values = research.validate_background_response(payload)

    assert values == payload


def test_background_questionnaire_endpoint_accepts_valid_answers_without_tracking(tmp_path):
    response = _research_client(tmp_path).post(
        "/api/experiment/background_questionnaire",
        json={
            "user_id": "participant-test",
            "current_role": "software_developer",
            "python_duration": "3_5_years",
            "mas_experience": "one_project",
            "crewai_experience": "completed_tutorial",
            "adk_experience": "none",
            "ai_coding_frequency": "weekly",
            "prior_gear_use": "once_or_twice",
            "technical_english": 6,
        },
    )

    assert response.status_code == 200
    assert response.get_json() == {"success": True, "saved": False, "tracking": False}


def test_gear_task_validation_rejects_an_empty_studio_project(tmp_path):
    response = _research_client(tmp_path).post(
        "/api/experiment/validate_task",
        json={
            "task_id": "T1",
            "mode": "GEAR",
            "framework": "crewai",
            "code": json.dumps({
                "schema_version": "1.0",
                "agents": [],
                "modules": [],
                "workflows": [],
            }),
        },
    )

    assert response.status_code == 400
    assert response.get_json()["valid"] is False


def test_gear_task_validation_accepts_a_complete_studio_project(tmp_path):
    response = _research_client(tmp_path).post(
        "/api/experiment/validate_task",
        json={
            "task_id": "T1",
            "mode": "GEAR",
            "framework": "crewai",
            "code": json.dumps({
                "schema_version": "1.0",
                "agents": [
                    """GearAgent:
  AgentIdentity: {Name: Writer, Purpose: Write, ContextDescription: Technical writer}
  LLMConfiguration: {Provider: openai, Model: test-model}
  TaskSpecification: {TaskName: Write, TaskDescription: Write an answer, ExpectedOutput: Text}
"""
                ],
                "modules": [],
                "workflows": [
                    """GearMultiAgent:
  WorkflowName: Main
  Items: {Agents: [Writer], Modules: []}
  Edges: []
"""
                ],
            }),
        },
    )

    assert response.status_code == 200
    assert response.get_json()["valid"] is True


def test_manual_task_validation_rejects_arbitrary_python(tmp_path):
    response = _research_client(tmp_path).post(
        "/api/experiment/validate_task",
        json={
            "task_id": "T1",
            "mode": "MANUAL",
            "framework": "crewai",
            "code": "print('this is not a CrewAI workflow')",
        },
    )

    assert response.status_code == 400
    assert response.get_json() == {
        "valid": False,
        "message": "The script must import CrewAI because it is the selected target framework.",
    }


def test_manual_task_validation_accepts_framework_code_that_compiles(tmp_path):
    response = _research_client(tmp_path).post(
        "/api/experiment/validate_task",
        json={
            "task_id": "T1",
            "mode": "MANUAL",
            "framework": "crewai",
            "code": (
                "from crewai import Agent, Crew, Task\n"
                "agent = Agent(role='Writer', goal='Write', backstory='Test')\n"
                "task = Task(description='Write', expected_output='Text', agent=agent)\n"
                "crew = Crew(agents=[agent], tasks=[task])\n"
            ),
        },
    )

    assert response.status_code == 200
    assert response.get_json()["valid"] is True


def test_manual_adk_validation_requires_a_runner_invocation(tmp_path):
    response = _research_client(tmp_path).post(
        "/api/experiment/validate_task",
        json={
            "task_id": "T1",
            "mode": "MANUAL",
            "framework": "adk",
            "code": "from google.adk.agents import Agent\nroot_agent = Agent(name='writer')\n",
        },
    )

    assert response.status_code == 400
    assert response.get_json()["message"] == (
        "The Google ADK script must invoke a runner (run, run_async, or run_live)."
    )


class _LogEndCursor:
    def __init__(self, row):
        self.row = row
        self.updated = False

    def execute(self, query, parameters=()):
        if "UPDATE task_logs" in query:
            self.updated = True

    def fetchone(self):
        return self.row

    def close(self):
        pass


class _LogEndConnection:
    def __init__(self, row):
        self.cursor_instance = _LogEndCursor(row)

    def cursor(self):
        return self.cursor_instance

    def commit(self):
        pass

    def close(self):
        pass


def _tracked_research_client(tmp_path, monkeypatch, row):
    connection = _LogEndConnection(row)
    monkeypatch.setattr(research.ResearchStore, "initialize", lambda self: None)
    monkeypatch.setattr(research.ResearchStore, "connect", lambda self: connection)
    monkeypatch.setattr(
        research,
        "current_participant",
        lambda: SimpleNamespace(user_id="participant-test"),
    )
    tasks_path = tmp_path / "tasks.json"
    tasks_path.write_text(json.dumps({"T1": {"time_limit_seconds": 600}}), encoding="utf-8")
    app = Flask(__name__)
    app.register_blueprint(
        create_research_blueprint(
            base_dir=tmp_path,
            tasks_path=tasks_path,
            experiment_config={"frameworks": ["crewai", "adk"]},
            database={"url": "postgresql://test"},
            tracking_enabled=True,
        )
    )
    return app.test_client(), connection


def test_manual_confirmation_requires_a_successful_execution(tmp_path, monkeypatch):
    client, connection = _tracked_research_client(
        tmp_path,
        monkeypatch,
        (1.0, False, None, 0.0, "MANUAL", "crewai", False, None),
    )
    response = client.post(
        "/api/experiment/log_end",
        json={
            "log_id": 1,
            "completion_reason": "confirmed",
            "code": "from crewai import Crew\ncrew = Crew(agents=[], tasks=[])\n",
        },
    )

    assert response.status_code == 409
    assert "successfully" in response.get_json()["error"]
    assert connection.cursor_instance.updated is False


def test_manual_confirmation_rejects_code_changed_after_run(tmp_path, monkeypatch):
    client, connection = _tracked_research_client(
        tmp_path,
        monkeypatch,
        (1.0, False, None, 0.0, "MANUAL", "crewai", True, "wrong-hash"),
    )
    response = client.post(
        "/api/experiment/log_end",
        json={
            "log_id": 1,
            "completion_reason": "confirmed",
            "code": "from crewai import Crew\ncrew = Crew(agents=[], tasks=[])\n",
        },
    )

    assert response.status_code == 409
    assert "changed after" in response.get_json()["error"]
    assert connection.cursor_instance.updated is False


def test_manual_confirmation_accepts_the_successfully_executed_code(tmp_path, monkeypatch):
    code = "from crewai import Crew\ncrew = Crew(agents=[], tasks=[])\n"
    client, connection = _tracked_research_client(
        tmp_path,
        monkeypatch,
        (
            1.0,
            False,
            None,
            0.0,
            "MANUAL",
            "crewai",
            True,
            hashlib.sha256(code.encode("utf-8")).hexdigest(),
        ),
    )
    response = client.post(
        "/api/experiment/log_end",
        json={"log_id": 1, "completion_reason": "confirmed", "code": code},
    )

    assert response.status_code == 200
    assert response.get_json()["success"] is True
    assert connection.cursor_instance.updated is True
