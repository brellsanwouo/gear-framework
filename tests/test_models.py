from pathlib import Path

import yaml
from flamapy.interfaces.python import FLAMAFeatureModel
from flask import Flask
from gear_web.blueprints.models import create_models_blueprint
from gear_web.services.feature_models import FeatureModelService
from gear_web.services.studio_module import analyze_studio_module_features
from gear_web.services.studio_workflow import analyze_studio_workflow_features
from gear_web.services.studio_agent import analyze_studio_agent_features


def test_all_uvl_models_parse_and_are_satisfiable():
    paths = sorted(Path("gear").glob("*.uvl")) + sorted(Path("connectors/frameworks").glob("*/*.uvl"))
    assert paths
    for path in paths:
        model = FLAMAFeatureModel(str(path))
        assert model.satisfiable(), f"Unsatisfiable feature model: {path}"


def test_all_project_yaml_files_parse():
    paths = [Path("config.yml"), *Path("gear").glob("*.yml"), *Path("connectors").rglob("*.yml")]
    for path in paths:
        yaml.safe_load(path.read_text(encoding="utf-8"))


def test_agent_provider_branches_allow_ollama_and_other_models():
    service = FeatureModelService(Path.cwd(), Path("ui"))
    assert service.analyze("agent", ["ollama", "OtherModel", "BaseURL"])["valid"]
    assert not service.analyze("agent", ["ollama", "APIKey"])["valid"]
    assert service.analyze("agent", ["openai", "OtherModel", "APIKey"])["valid"]


def test_complete_llm_feature_selection_checks_absent_features():
    service = FeatureModelService(Path.cwd(), Path("ui"))
    assert not service.analyze("agent", ["ollama", "OtherModel"], ["BaseURL", "APIKey"])["valid"]
    assert service.analyze("agent", ["ollama", "OtherModel", "BaseURL"], ["APIKey"])["valid"]
    assert service.analyze("agent", ["openai", "OtherModel"], ["BaseURL", "APIKey"])["valid"]
    assert service.analyze("workflow", ["Agents", "Modules"])["valid"]
    assert not service.analyze("module", ["Parallel", "Loop"])["valid"]


def test_studio_feature_model_endpoint_checks_missing_ollama_url():
    app = Flask(__name__)
    app.register_blueprint(create_models_blueprint(FeatureModelService(Path.cwd(), Path("ui"))))
    client = app.test_client()
    invalid = client.post("/api/studio/validate-llm-features", json={
        "configuration": {"Provider": "ollama", "Model": "llama3.2"},
    })
    assert invalid.status_code == 200
    assert invalid.get_json() == {"valid": False, "source": "gear/gear-agent.uvl"}
    valid = client.post("/api/studio/validate-llm-features", json={
        "configuration": {"Provider": "ollama", "Model": "llama3.2", "BaseURL": "present"},
    })
    assert valid.status_code == 200
    assert valid.get_json()["valid"] is True


def test_module_strategy_projection_uses_uvl_alternative():
    assert analyze_studio_module_features({"ModuleName": "Review", "Strategy": {"Parallel": {"ParallelAgents": ["Writer"]}}})["valid"]
    assert not analyze_studio_module_features({"ModuleName": "Review", "Strategy": {}})["valid"]
    assert not analyze_studio_module_features({"Strategy": {
        "Parallel": {"ParallelAgents": ["Writer"]},
        "Loop": {"TurnCount": 2, "LoopAgents": ["Writer"]},
    }})["valid"]
    assert not analyze_studio_module_features({"ModuleName": "", "Strategy": {"Parallel": {"ParallelAgents": ["Writer"]}}})["valid"]
    assert not analyze_studio_module_features({"ModuleName": "Review", "Strategy": {"Parallel": {"ParallelAgents": []}}})["valid"]


def test_workflow_item_projection_uses_uvl_or_group():
    assert not analyze_studio_workflow_features({"WorkflowName": "Main", "Items": {"Agents": [], "Modules": []}})["valid"]
    assert analyze_studio_workflow_features({"WorkflowName": "Main", "Items": {"Agents": ["Writer"], "Modules": []}})["valid"]
    assert analyze_studio_workflow_features({"WorkflowName": "Main", "Items": {"Agents": [], "Modules": ["Review"]}})["valid"]
    assert analyze_studio_workflow_features({"WorkflowName": "Main", "Items": {"Agents": ["Writer"], "Modules": ["Review"]}})["valid"]
    assert not analyze_studio_workflow_features({"WorkflowName": "", "Items": {"Agents": ["Writer"]}})["valid"]


def test_agent_required_features_and_parent_constraints_are_checked():
    agent = {
        "AgentIdentity": {"Name": "Writer", "Purpose": "Write", "ContextDescription": "Context"},
        "LLMConfiguration": {"Provider": "openai", "Model": "gpt-4o-mini"},
        "TaskSpecification": {"TaskName": "Draft", "TaskDescription": "Write", "ExpectedOutput": "Text"},
    }
    assert analyze_studio_agent_features(agent)["valid"]
    assert not analyze_studio_agent_features({**agent, "AgentIdentity": {**agent["AgentIdentity"], "Name": ""}})["valid"]
    assert not analyze_studio_agent_features({**agent, "AgentIdentity": {**agent["AgentIdentity"], "Purpose": ""}})["valid"]
    assert not analyze_studio_agent_features({**agent, "TaskSpecification": {**agent["TaskSpecification"], "TaskName": ""}})["valid"]
    assert not analyze_studio_agent_features({**agent, "LLMConfiguration": {**agent["LLMConfiguration"], "ModelParameters": {}}})["valid"]
    assert not analyze_studio_agent_features({**agent, "ExecutionControl": {}})["valid"]


def test_studio_feature_endpoints_reject_missing_mandatory_names():
    app = Flask(__name__)
    app.register_blueprint(create_models_blueprint(FeatureModelService(Path.cwd(), Path("ui"))))
    client = app.test_client()
    agent = {
        "AgentIdentity": {"Name": "", "Purpose": "Write", "ContextDescription": "Context"},
        "LLMConfiguration": {"Provider": "openai", "Model": "gpt-4o-mini"},
        "TaskSpecification": {"TaskName": "Draft", "TaskDescription": "Write", "ExpectedOutput": "Text"},
    }
    module = {"ModuleName": "", "Strategy": {"Parallel": {"ParallelAgents": ["Writer"]}}}
    workflow = {"WorkflowName": "", "Items": {"Agents": ["Writer"], "Modules": []}}
    for url, payload in (
        ("/api/studio/validate-agent-features", {"agent": agent}),
        ("/api/studio/validate-module-features", {"module": module}),
        ("/api/studio/validate-workflow-features", {"workflow": workflow}),
    ):
        response = client.post(url, json=payload)
        assert response.status_code == 200
        assert response.get_json()["valid"] is False
