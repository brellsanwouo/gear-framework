from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from typing import Any, Callable


DEFAULT_PROVIDER = "openai"
DEFAULT_MODEL = "gpt-5.1-codex-mini"

PROVIDER_PRESETS: dict[str, str] = {
    "openai": DEFAULT_MODEL,
    "google": "gemini-2.5-flash",
    "anthropic": "claude-sonnet-4-5",
    "custom": "model-name",
}


@dataclass(frozen=True)
class ProjectTemplate:
    id: str
    name: str
    description: str
    agent_count: int
    module_count: int
    factory: Callable[[str, str], dict[str, Any]]


def _agent(name: str, purpose: str, context: str, task_name: str, task: str, output: str,
           provider: str, model: str) -> dict[str, Any]:
    return {
        "AgentIdentity": {"Name": name, "Purpose": purpose, "ContextDescription": context},
        "LLMConfiguration": {"Provider": provider, "Model": model},
        "TaskSpecification": {
            "TaskName": task_name,
            "TaskDescription": task,
            "ExpectedOutput": output,
        },
    }


def _base(project_id: str, name: str, description: str, agents: list[dict[str, Any]],
          modules: list[dict[str, Any]], nodes: list[dict[str, str]]) -> dict[str, Any]:
    return {
        "schema_version": "1.0",
        "project": {"id": project_id, "name": name, "description": description},
        "agents": agents,
        "modules": modules,
        "workflow": {
            "name": f"{''.join(part.title() for part in project_id.replace('_', '-').split('-'))}Workflow",
            "memory": True,
            "nodes": nodes,
            "edges": [
                {"from": nodes[index]["id"], "to": nodes[index + 1]["id"]}
                for index in range(len(nodes) - 1)
            ],
        },
        "targets": ["crewai", "adk"],
    }


def _minimal(provider: str, model: str) -> dict[str, Any]:
    agents = [_agent(
        "ExampleAgent", "Produce a concise answer.", "A portable general-purpose assistant.",
        "AnswerRequest", "Answer the supplied request clearly.", "A concise textual answer.", provider, model,
    )]
    return _base("", "Minimal project", "A portable one-agent starter.", agents, [], [
        {"id": "answer", "ref": "ExampleAgent", "type": "agent"},
    ])


def _editorial(provider: str, model: str) -> dict[str, Any]:
    specs = [
        ("Researcher", "Find reliable information.", "A source-conscious researcher.", "ResearchTopic", "Research the requested topic and distinguish evidence from assumptions.", "Structured research notes with sources."),
        ("Planner", "Turn evidence into a useful outline.", "A content strategist focused on logical structure.", "PlanArticle", "Create an outline from the research notes.", "A detailed and ordered outline."),
        ("Writer", "Produce a clear draft.", "A precise technical writer.", "WriteDraft", "Write the complete draft from the approved outline.", "A complete Markdown draft."),
        ("Editor", "Verify and polish the deliverable.", "A strict editor focused on correctness and clarity.", "EditDraft", "Check facts, correct issues, and return the final version.", "A publication-ready document."),
    ]
    agents = [_agent(*spec, provider, model) for spec in specs]
    nodes = [{"id": name.lower(), "ref": name, "type": "agent"} for name, *_ in specs]
    return _base("", "Editorial pipeline", "Research, plan, write, and review content in sequence.", agents, [], nodes)


def _research(provider: str, model: str) -> dict[str, Any]:
    specs = [
        ("WebResearcher", "Find relevant public information.", "A web researcher who returns traceable evidence.", "SearchWeb", "Find and summarize relevant public information.", "Findings with source references."),
        ("DocumentAnalyst", "Extract facts from supplied documents.", "A document analyst who attributes important claims.", "AnalyzeDocuments", "Extract relevant facts and contradictions from the documents.", "Structured document findings."),
        ("ResearchLead", "Reconcile parallel research.", "A senior analyst who resolves contradictions and uncertainty.", "SynthesizeResearch", "Compare all research results and produce a verified synthesis.", "A verified research brief."),
        ("ReportWriter", "Turn the synthesis into a useful report.", "A writer who preserves factual nuance.", "WriteReport", "Write a complete report from the verified brief.", "A structured Markdown report."),
        ("FactChecker", "Perform final quality control.", "An independent reviewer focused on factual support.", "CheckReport", "Check every important claim and correct unsupported statements.", "A checked final report and short verification note."),
    ]
    agents = [_agent(*spec, provider, model) for spec in specs]
    modules = [{"ModuleName": "ResearchTeam", "Strategy": {"Parallel": {
        "ParallelAgents": ["WebResearcher", "DocumentAnalyst"], "Aggregator": "ResearchLead",
    }}}]
    nodes = [
        {"id": "research", "ref": "ResearchTeam", "type": "module"},
        {"id": "report", "ref": "ReportWriter", "type": "agent"},
        {"id": "fact-check", "ref": "FactChecker", "type": "agent"},
    ]
    return _base("", "Research team", "Run parallel research, aggregate it, write a report, and fact-check it.", agents, modules, nodes)


def _software_delivery(provider: str, model: str) -> dict[str, Any]:
    specs = [
        ("RequirementsAnalyst", "Clarify the requested change.", "A product analyst who identifies ambiguity and acceptance criteria.", "AnalyzeRequirements", "Turn the request into explicit requirements and constraints.", "Requirements with acceptance criteria."),
        ("SolutionArchitect", "Design a maintainable solution.", "A pragmatic software architect.", "DesignSolution", "Design the implementation from the approved requirements.", "A concise implementation design."),
        ("CodeAuthor", "Implement the designed change.", "A careful software engineer who follows the existing architecture.", "ImplementChange", "Produce the required implementation.", "A complete implementation proposal."),
        ("TestEngineer", "Design comprehensive verification.", "A test engineer focused on regressions and edge cases.", "CreateTests", "Create tests for the requirements and implementation.", "A runnable verification plan and tests."),
        ("SecurityReviewer", "Aggregate and review implementation quality.", "A senior reviewer focused on security, correctness, and operational risk.", "ReviewDelivery", "Review the implementation and tests, then identify blocking issues.", "A review decision with required corrections."),
        ("ReleaseManager", "Prepare the final delivery.", "A release manager who checks readiness and documents operation.", "PrepareRelease", "Produce final release notes and usage instructions.", "Release notes and a concise runbook."),
    ]
    agents = [_agent(*spec, provider, model) for spec in specs]
    modules = [{"ModuleName": "ImplementationReview", "Strategy": {"Parallel": {
        "ParallelAgents": ["CodeAuthor", "TestEngineer"], "Aggregator": "SecurityReviewer",
    }}}]
    nodes = [
        {"id": "requirements", "ref": "RequirementsAnalyst", "type": "agent"},
        {"id": "architecture", "ref": "SolutionArchitect", "type": "agent"},
        {"id": "implementation", "ref": "ImplementationReview", "type": "module"},
        {"id": "release", "ref": "ReleaseManager", "type": "agent"},
    ]
    return _base("", "Software delivery", "Analyze, design, implement, test, review, and prepare a release.", agents, modules, nodes)


PROJECT_TEMPLATES: dict[str, ProjectTemplate] = {
    "minimal": ProjectTemplate("minimal", "Minimal", "One general-purpose agent.", 1, 0, _minimal),
    "editorial-pipeline": ProjectTemplate("editorial-pipeline", "Editorial pipeline", "Four sequential agents for researched content.", 4, 0, _editorial),
    "research-team": ProjectTemplate("research-team", "Research team", "Five agents with parallel research and aggregation.", 5, 1, _research),
    "software-delivery": ProjectTemplate("software-delivery", "Software delivery", "Six agents for a complete software delivery flow.", 6, 1, _software_delivery),
}


def template_catalog() -> list[dict[str, Any]]:
    return [
        {"id": item.id, "name": item.name, "description": item.description,
         "agents": item.agent_count, "modules": item.module_count}
        for item in PROJECT_TEMPLATES.values()
    ]


def create_project_from_template(template_id: str, project_id: str, provider: str = DEFAULT_PROVIDER,
                                 model: str = DEFAULT_MODEL) -> dict[str, Any]:
    definition = PROJECT_TEMPLATES[template_id]
    project = deepcopy(definition.factory(provider, model))
    project["project"]["id"] = project_id
    project["project"]["name"] = project_id.replace("-", " ").replace("_", " ").title()
    project["workflow"]["name"] = f"{''.join(part.title() for part in project_id.replace('_', '-').split('-'))}Workflow"
    return project
