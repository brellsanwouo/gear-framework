from __future__ import annotations

import importlib

from gear_web.builds import _studio_project
from gear_web.settings import _studio_model_policy

from gear_sdk.runner import RunResult


def test_web_routes_and_build_history(tmp_path, monkeypatch):
    monkeypatch.setenv("GEAR_STORE_PATH", str(tmp_path / "web.db"))
    web = importlib.import_module("gear_web.app")
    client = web.app.test_client()
    identity = client.get("/api/session").get_json()
    assert identity["anonymous"] is True
    assert identity["user_id"].startswith("participant-")
    assert identity["session_id"].startswith("session-")
    assert client.get("/api/session").get_json() == identity

    root_response = client.get("/")
    assert root_response.status_code == 200
    assert b"GEAR Studio" in root_response.data
    assert b"GEAR Studio" in client.get("/studio").data
    yaml_runtime = client.get("/ui/vendor/js-yaml.min.js")
    assert yaml_runtime.status_code == 200
    assert b"js-yaml" in yaml_runtime.data
    assert client.get("/competition").status_code == 404
    classic_response = client.get("/classic")
    assert classic_response.status_code == 200
    assert b"GEAR Studio" not in classic_response.data
    assert client.get("/ui/studio.js").status_code == 200
    assert b'id="runExecution"' in root_response.data
    assert client.get("/runtime/conversion-core.js").status_code == 200
    studio_config = client.get("/api/studio/config").get_json()
    assert set(studio_config["model"]) == {"locked", "provider", "model"}
    assert isinstance(studio_config["model"]["locked"], bool)
    templates = client.get("/api/studio/templates").get_json()["templates"]
    assert {item["id"] for item in templates} == {
        "minimal", "editorial-pipeline", "research-team", "software-delivery",
    }
    starter = client.get(
        "/api/studio/templates/research-team",
        query_string={"project_id": "studio-demo", "provider": "google", "model": "test-model"},
    ).get_json()
    assert starter["project"]["id"] == "studio-demo"
    assert len(starter["agents"]) == 5
    expected_provider = studio_config["model"]["provider"] if studio_config["model"]["locked"] else "google"
    expected_model = studio_config["model"]["model"] if studio_config["model"]["locked"] else "test-model"
    assert {agent["LLMConfiguration"]["Provider"] for agent in starter["agents"]} == {expected_provider}
    assert {agent["LLMConfiguration"]["Model"] for agent in starter["agents"]} == {expected_model}
    assert client.get("/api/studio/templates/unknown").status_code == 404
    assert client.get("/.env").status_code == 404
    assert client.post("/api/run", json={"code": "print(1)"}).status_code == 403
    assert client.post("/api/experiment/start").status_code == 200

    response = client.post(
        "/api/builds",
        json={
            "project_id": "web-test",
            "target": "adk",
            "source": {"agents": []},
            "outputs": {"orchestration": "print(1)", "report": "valid: true"},
        },
    )
    assert response.status_code == 201
    browser_build_id = response.get_json()["build_id"]
    builds = client.get("/api/builds").get_json()
    assert builds[0]["project_id"] == "web-test"
    assert builds[0]["participant_id"] == identity["user_id"]

    other_client = web.app.test_client()
    other_identity = other_client.get("/api/session").get_json()
    assert other_identity["user_id"] != identity["user_id"]
    assert other_client.get("/api/builds").get_json() == []
    assert other_client.get(f"/api/builds/{browser_build_id}").status_code == 404

    studio_response = client.post(
        "/api/studio/builds",
        json={
            "project_id": "studio-test",
            "target": "crewai",
            "agents": [
                """GearAgent:
  AgentIdentity:
    Name: Writer
    Purpose: Write a short answer.
    ContextDescription: A concise technical writer.
  LLMConfiguration:
    Provider: openai
    Model: gpt-5.1-codex-mini
  TaskSpecification:
    TaskName: Write
    TaskDescription: Write an answer.
    ExpectedOutput: A short answer.
"""
            ],
            "modules": [],
            "workflows": [
                """GearMultiAgent:
  WorkflowName: Main
  Items:
    Agents: [Writer]
    Modules: []
  Edges: []
"""
            ],
        },
    )
    assert studio_response.status_code == 201
    studio_build = studio_response.get_json()
    assert studio_build["target"] == "crewai"
    assert "orchestration" in studio_build["outputs"]

    langgraph_response = client.post(
        "/api/studio/builds",
        json={
            "project_id": "studio-langgraph",
            "target": "langgraph",
            "agents": [
                """GearAgent:
  AgentIdentity: {Name: Writer, Purpose: Write, ContextDescription: Technical writer}
  LLMConfiguration: {Provider: openai, Model: gpt-5.1-codex-mini}
  TaskSpecification: {TaskName: Write, TaskDescription: Write an answer, ExpectedOutput: A short answer}
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
        },
    )
    assert langgraph_response.status_code == 201
    assert "StateGraph" in langgraph_response.get_json()["outputs"]["orchestration"]

    assert client.get("/api/run/status").get_json()["enabled"] is False
    monkeypatch.setenv("GEAR_ENABLE_LOCAL_RUNNER", "true")
    execution = {}
    def fake_run_python(code, timeout, **context):
        execution.update(code=code, timeout=timeout, **context)
        return RunResult("done\n", "", 0)
    monkeypatch.setattr("gear_sdk.runner.run_python", fake_run_python)
    monkeypatch.setattr("gear_web.services.observability.record_execution", lambda **values: "mlflow-run-1")
    run_response = client.post(
        "/api/run",
        json={
            "build_id": studio_build["build_id"],
            "target": "crewai",
        },
    )
    assert run_response.status_code == 200
    assert run_response.get_json()["stdout"] == "done\n"
    assert run_response.get_json()["mlflow_run_id"] == "mlflow-run-1"
    assert run_response.get_json()["trace_id"] == "mlflow-run-1"
    assert "No 'crew' variable defined" not in execution["code"]
    assert execution["participant_id"] == identity["user_id"]
    assert execution["session_id"] == identity["session_id"]
    assert execution["project_id"] == "studio-test"
    assert client.get("/api/logs").get_json()[0]["build_id"] == studio_build["build_id"]
    assert client.get("/api/logs").get_json()[0]["participant_id"] == identity["user_id"]
    assert other_client.get("/api/logs").get_json() == []
    assert other_client.post(
        "/api/run",
        json={"build_id": studio_build["build_id"], "target": "crewai"},
    ).status_code == 404
    assert client.post("/api/run", json={"code": "print('untrusted')"}).status_code == 400
    assert client.post(
        "/api/run",
        json={"build_id": browser_build_id, "target": "adk"},
    ).status_code == 403
    assert client.post(
        "/api/run",
        json={"build_id": studio_build["build_id"], "target": "langgraph"},
    ).status_code == 400


def test_studio_project_preserves_mixed_workflow_order():
    agent = lambda name: {
        "AgentIdentity": {"Name": name, "Purpose": "Test", "ContextDescription": "Test context"},
        "LLMConfiguration": {"Provider": "openai", "Model": "gpt-5.1-codex-mini"},
        "TaskSpecification": {"TaskName": f"{name}Task", "TaskDescription": "Test", "ExpectedOutput": "Test output"},
    }
    module = {
        "ModuleName": "Drafting",
        "Strategy": {"Parallel": {"ParallelAgents": ["Research"]}},
    }
    project = _studio_project({
        "project_id": "mixed-order",
        "agents": [agent("Research"), agent("Review")],
        "modules": [module],
        "workflow": {"WorkflowName": "Main", "Items": {"Agents": ["Research", "Review"], "Modules": ["Drafting"]}},
        "workflow_sequence": [
            {"kind": "agent", "name": "Research"},
            {"kind": "module", "name": "Drafting"},
            {"kind": "agent", "name": "Review"},
        ],
    })
    assert [node["ref"] for node in project.data["workflow"]["nodes"]] == ["Research", "Drafting", "Review"]
    assert project.data["workflow"]["edges"] == [
        {"from": "step-1", "to": "step-2"},
        {"from": "step-2", "to": "step-3"},
    ]


def test_studio_model_policy_is_optional_and_environment_driven(monkeypatch):
    monkeypatch.delenv("GEAR_STUDIO_MODEL", raising=False)
    monkeypatch.setenv("GEAR_STUDIO_PROVIDER", "openai")
    assert _studio_model_policy() == {
        "locked": False,
        "provider": "openai",
        "model": "gpt-5.1-codex-mini",
    }

    monkeypatch.setenv("GEAR_STUDIO_PROVIDER", "anthropic")
    monkeypatch.setenv("GEAR_STUDIO_MODEL", "claude-sonnet")
    assert _studio_model_policy() == {
        "locked": True,
        "provider": "anthropic",
        "model": "claude-sonnet",
    }


def test_studio_project_enforces_locked_model_policy():
    project = _studio_project(
        {
            "project_id": "locked-model",
            "agents": [{
                "AgentIdentity": {"Name": "Writer", "Purpose": "Write", "ContextDescription": "Writer"},
                "LLMConfiguration": {"Provider": "custom", "Model": "user-choice"},
                "TaskSpecification": {"TaskName": "Write", "TaskDescription": "Write", "ExpectedOutput": "Text"},
            }],
            "workflow": {"WorkflowName": "Main", "Items": {"Agents": ["Writer"], "Modules": []}},
        },
        {"locked": True, "provider": "openai", "model": "admin-model"},
    )
    assert project.data["agents"][0]["LLMConfiguration"] == {
        "Provider": "openai",
        "Model": "admin-model",
    }
