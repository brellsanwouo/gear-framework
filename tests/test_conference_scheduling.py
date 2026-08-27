from __future__ import annotations

import importlib
import json
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "ConferenceScheduling"


def test_conference_tasks_and_assets_are_complete():
    tasks = json.loads((DATA / "tasks.json").read_text(encoding="utf-8"))
    assert list(tasks) == ["T0", "T1", "T2", "T3", "T4"]
    for index, task in enumerate(tasks.values()):
        description = ROOT / task["description"]
        assert description == DATA / f"P{index}.md"
        assert description.is_file()
        assert (DATA / "images" / f"P{index}.svg").is_file()
        assert (DATA / "mermaid code" / f"P{index}.mmd").is_file()
        assert (DATA / "template yaml" / f"P{index}.yml").is_file()


def test_conference_templates_are_valid_yaml_streams_with_stable_context_agent():
    expected_agent_names = {
        0: ["ConferenceContextAgent"],
        1: ["ConferenceContextAgent", "SchedulePlannerAgent"],
        2: ["ConferenceContextAgent", "SchedulePlannerAgent", "ScheduleValidatorAgent"],
        3: [
            "ConferenceContextAgent",
            "TimeConstraintAnalyzerAgent",
            "RoomConstraintAnalyzerAgent",
            "SchedulePlannerAgent",
        ],
        4: [
            "ConferenceContextAgent",
            "SchedulePlannerAgent",
            "ScheduleReviewerAgent",
            "ScheduleRefinerAgent",
            "FinalScheduleAgent",
        ],
    }

    for index, names in expected_agent_names.items():
        path = DATA / "template yaml" / f"P{index}.yml"
        documents = list(yaml.safe_load_all(path.read_text(encoding="utf-8")))
        agents = [document["GearAgent"] for document in documents]
        assert [agent["AgentIdentity"]["Name"] for agent in agents] == names
        assert {
            agent["LLMConfiguration"]["Model"] for agent in agents
        } == {"gpt-4o-mini"}
        context = agents[0]
        assert context["AgentIdentity"]["Purpose"] == (
            "present the conference situation and its factual information."
        )
        assert context["TaskSpecification"]["TaskName"] == "ConferenceContextTask"


def test_experiment_configuration_uses_conference_tasks_and_preserves_protocol():
    config = yaml.safe_load((ROOT / "config.yml").read_text(encoding="utf-8"))
    assert config["paths"]["tasks_file"] == "data/ConferenceScheduling/tasks.json"
    assert config["experiment"] == {
        "training_task": "T1",
        "familiarization_task": "T2",
        "measured_tasks": ["T3", "T4"],
        "frameworks": ["crewai", "adk"],
    }


def test_conference_tasks_and_diagrams_are_loaded_by_experiment_interface(monkeypatch, tmp_path):
    monkeypatch.setenv("GEAR_STORE_PATH", str(tmp_path / "conference.db"))
    web = importlib.import_module("gear_web.app")
    client = web.app.test_client()

    image = client.get("/data/ConferenceScheduling/images/P3.svg")
    assert image.status_code == 200
    assert b"TimeConstraintAnalyzerAgent" in image.data
    assert client.get("/data/AgentGridPlanning/images/P3.svg").status_code == 200
    assert client.get("/data/UnknownExperiment/images/P3.svg").status_code == 404

    task = client.get("/api/experiment/task_info/T3").get_json()
    assert task["description_path"] == "data/ConferenceScheduling/P3.md"
    assert "TimeConstraintAnalyzerAgent" in task["description"]
    assert "RoomConstraintAnalyzerAgent" in task["description"]
