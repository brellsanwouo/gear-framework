from __future__ import annotations

import ast
from copy import deepcopy

from gear_sdk import BuildStore, convert, load_project
from gear_sdk.project import GearProject, validate_project
from gear_sdk.cli import main


def test_sdk_converts_installed_targets_and_generated_python_parses(tmp_path):
    project = load_project("examples/minimal.gear.yml")
    store = BuildStore(tmp_path / "gear.db")
    for target in ("crewai", "adk", "langgraph", "openai-agents", "microsoft-agent-framework", "strands", "pydantic-ai", "autogen", "semantic-kernel", "haystack"):
        build = convert(project, target, tmp_path / target)
        ast.parse(build.outputs["orchestration"])
        assert build.report["valid"] is True
        assert build.schema_version == "1.0"
        assert build.duration_ms >= 0
        store.record_build(build)
    assert {item["target"] for item in store.list_builds()} == {"crewai", "adk", "langgraph", "openai-agents", "microsoft-agent-framework", "strands", "pydantic-ai", "autogen", "semantic-kernel", "haystack"}


def test_crewai_and_adk_generate_current_module_orchestration(tmp_path):
    parallel = load_project("examples/parallel-module.gear.yml")
    loop = load_project("examples/loop-module.gear.yml")
    parallel_with_aggregator = deepcopy(parallel.data)
    parallel_with_aggregator["modules"][0]["Strategy"]["Parallel"]["Aggregator"] = "Reviewer"

    crew_parallel = convert(parallel, "crewai", tmp_path / "crewai-parallel").outputs["orchestration"]
    crew_loop = convert(loop, "crewai", tmp_path / "crewai-loop").outputs["orchestration"]
    adk_parallel = convert(GearProject.from_dict(parallel_with_aggregator), "adk", tmp_path / "adk-parallel").outputs["orchestration"]
    adk_loop = convert(loop, "adk", tmp_path / "adk-loop").outputs["orchestration"]

    assert "await asyncio.gather" in crew_parallel
    assert "kickoff_async()" in crew_parallel
    assert "Context from the previous agent" in crew_parallel
    assert "for _ in range(3):" in crew_loop
    assert "ParallelAgent(" in adk_parallel
    assert "ResearchTeamPipeline" in adk_parallel
    assert "from copy import deepcopy" in adk_parallel
    assert "deepcopy(reviewer)" in adk_parallel
    assert "LoopAgent(" in adk_loop
    assert "max_iterations=3" in adk_loop
    for source in (crew_parallel, crew_loop, adk_parallel, adk_loop):
        ast.parse(source)
        assert 'if __name__ == "__main__":' in source


def test_cli_validate_and_convert(tmp_path):
    assert main(["validate", "examples/minimal.gear.yml"]) == 0
    assert (
        main(
            [
                "--store",
                str(tmp_path / "history.db"),
                "convert",
                "examples/minimal.gear.yml",
                "--target",
                "crewai",
                "--output",
                str(tmp_path / "dist"),
            ]
        )
        == 0
    )
    assert (tmp_path / "dist" / "minimal" / "crewai" / "orchestration.py").exists()


def test_cli_init_and_convert_all_targets(tmp_path):
    project_file = tmp_path / "projet_1.gear.yml"
    output = tmp_path / "dist"
    assert main(["init", "projet_1", "--output", str(project_file)]) == 0
    assert main(["convert", str(project_file), "--all-targets", "--output", str(output), "--no-history"]) == 0
    assert (output / "projet_1" / "crewai" / "orchestration.py").is_file()
    assert (output / "projet_1" / "adk" / "orchestration.py").is_file()
    assert (output / "projet_1" / "langgraph" / "orchestration.py").is_file()
    assert (output / "projet_1" / "openai-agents" / "orchestration.py").is_file()
    assert (output / "projet_1" / "microsoft-agent-framework" / "orchestration.py").is_file()
    assert (output / "projet_1" / "strands" / "orchestration.py").is_file()
    assert (output / "projet_1" / "pydantic-ai" / "orchestration.py").is_file()
    assert (output / "projet_1" / "autogen" / "orchestration.py").is_file()
    assert (output / "projet_1" / "semantic-kernel" / "orchestration.py").is_file()
    assert (output / "projet_1" / "haystack" / "orchestration.py").is_file()


def test_cli_starter_template_applies_project_name_and_model(tmp_path):
    project_file = tmp_path / "research_demo.gear.yml"
    assert main([
        "init", "research_demo", "--template", "research-team",
        "--provider", "google", "--model", "gemini-test-model", "--output", str(project_file),
    ]) == 0
    project = load_project(project_file)
    assert project.id == "research_demo"
    assert len(project.data["agents"]) == 5
    assert len(project.data["modules"]) == 1
    assert {agent["LLMConfiguration"]["Provider"] for agent in project.data["agents"]} == {"google"}
    assert {agent["LLMConfiguration"]["Model"] for agent in project.data["agents"]} == {"gemini-test-model"}
    assert [node["type"] for node in project.data["workflow"]["nodes"]] == ["module", "agent", "agent"]


def test_cli_interactive_init_selects_template_provider_and_model(tmp_path, monkeypatch):
    answers = iter(["2", "3", "my-model"])
    monkeypatch.setattr("builtins.input", lambda _: next(answers))
    project_file = tmp_path / "guided.gear.yml"
    assert main(["init", "guided", "--interactive", "--output", str(project_file)]) == 0
    project = load_project(project_file)
    assert len(project.data["agents"]) == 4
    assert {agent["LLMConfiguration"]["Provider"] for agent in project.data["agents"]} == {"anthropic"}
    assert {agent["LLMConfiguration"]["Model"] for agent in project.data["agents"]} == {"my-model"}


def test_cli_lists_starter_templates(capsys):
    assert main(["--json", "templates", "list"]) == 0
    output = capsys.readouterr().out
    assert '"research-team"' in output
    assert '"agents": 6' in output


def test_cli_blocks_invalid_project_without_writing_files(tmp_path, capsys):
    project_file = tmp_path / "broken.gear.yml"
    project_file.write_text(
        """schema_version: '1.0'
project: {id: broken, name: Broken}
agents: []
modules: []
workflow: {name: Main, nodes: [], edges: []}
targets: [crewai]
""",
        encoding="utf-8",
    )
    output = tmp_path / "dist"
    assert main(["convert", str(project_file), "--target", "crewai", "--output", str(output)]) == 2
    assert not output.exists()
    error = capsys.readouterr().err
    assert "Conversion canceled" in error
    assert "blocking issue(s)" in error
    assert "No new files were generated" in error


def test_store_correlates_execution_log_with_build(tmp_path):
    project = load_project("examples/minimal.gear.yml")
    store = BuildStore(tmp_path / "gear.db")
    build = convert(project, "crewai", tmp_path / "output")
    store.record_build(build)
    run_id = store.record_run(build.id, "succeeded", "done", "", "trace-1")
    run = store.get_run(run_id)
    assert run is not None
    assert run["build_id"] == build.id
    assert run["trace_id"] == "trace-1"


def test_project_schema_and_semantic_validation_are_composed():
    project = load_project("examples/minimal.gear.yml").data

    malformed = {**project, "agents": [{"AgentIdentity": {"Name": "Incomplete"}}]}
    schema_errors = validate_project(malformed)
    assert any("LLMConfiguration" in error for error in schema_errors)
    assert any("TaskSpecification" in error for error in schema_errors)

    unknown_module_agent = {
        **project,
        "modules": [{"ModuleName": "Team", "Strategy": {"Parallel": {"ParallelAgents": ["Missing"]}}}],
    }
    assert "references unknown agent 'Missing'" in "\n".join(validate_project(unknown_module_agent))

    cyclic = {
        **project,
        "workflow": {
            "name": "Cycle",
            "nodes": [
                {"id": "first", "ref": "ExampleAgent", "type": "agent"},
                {"id": "second", "ref": "ExampleAgent", "type": "agent"},
            ],
            "edges": [{"from": "first", "to": "second"}, {"from": "second", "to": "first"}],
        },
    }
    assert "contains a cycle" in "\n".join(validate_project(cyclic))
