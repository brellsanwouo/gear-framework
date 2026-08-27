const test = require("node:test");
const assert = require("node:assert/strict");

const {
  renameAgentReferences,
  renameBuilderReferences,
  renameWorkflowReferences,
} = require("../ui/js/project-references.js");

test("renaming an agent updates every reference without changing module state", () => {
  const modules = [
    {
      ModuleName: "ResearchTeam",
      Strategy: {
        Parallel: {
          ParallelAgents: ["Researcher", "Reviewer"],
          Aggregator: "Researcher",
          CustomState: { enabled: true },
        },
      },
      Memory: { retained: true },
    },
    {
      ModuleName: "ReviewLoop",
      Strategy: {
        Loop: {
          LoopAgents: ["Researcher"],
          TurnCount: 4,
          StopCondition: "approved",
        },
      },
    },
  ];
  const workflow = {
    WorkflowName: "MainWorkflow",
    Memory: true,
    Items: { Agents: ["Researcher"], Modules: ["ResearchTeam"] },
    Edges: [{ From: "Researcher", To: "ResearchTeam", condition: "ready" }],
  };

  renameAgentReferences(modules, workflow, "Researcher", "LeadResearcher");

  assert.deepEqual(modules[0].Strategy.Parallel.ParallelAgents, ["LeadResearcher", "Reviewer"]);
  assert.equal(modules[0].Strategy.Parallel.Aggregator, "LeadResearcher");
  assert.deepEqual(modules[0].Strategy.Parallel.CustomState, { enabled: true });
  assert.deepEqual(modules[0].Memory, { retained: true });
  assert.deepEqual(modules[1].Strategy.Loop, {
    LoopAgents: ["LeadResearcher"],
    TurnCount: 4,
    StopCondition: "approved",
  });
  assert.deepEqual(workflow.Items, { Agents: ["LeadResearcher"], Modules: ["ResearchTeam"] });
  assert.deepEqual(workflow.Edges, [
    { From: "LeadResearcher", To: "ResearchTeam", condition: "ready" },
  ]);
  assert.equal(workflow.Memory, true);
});

test("renaming a module updates workflow items and edges without changing workflow state", () => {
  const workflow = {
    WorkflowName: "MainWorkflow",
    Process: "Sequential",
    Memory: true,
    Items: { Agents: ["Writer"], Modules: ["DraftTeam"] },
    Edges: [{ from: "DraftTeam", to: "Writer", metadata: { retries: 2 } }],
  };

  renameWorkflowReferences(workflow, "module", "DraftTeam", "EditorialTeam");

  assert.deepEqual(workflow.Items, { Agents: ["Writer"], Modules: ["EditorialTeam"] });
  assert.deepEqual(workflow.Edges, [
    { from: "EditorialTeam", to: "Writer", metadata: { retries: 2 } },
  ]);
  assert.equal(workflow.Process, "Sequential");
  assert.equal(workflow.Memory, true);
});

test("renaming a component keeps the advanced workflow sequence and its state", () => {
  const builder = {
    selectedAgents: ["Researcher", "Writer"],
    lastAgentOptions: ["Researcher", "Writer"],
    selectedModules: ["ReviewTeam"],
    lastModuleOptions: ["ReviewTeam"],
    sequence: [
      { id: "Researcher", label: "Researcher", type: "agent" },
      { id: "ReviewTeam", label: "ReviewTeam", type: "module" },
      { id: "Researcher_2", label: "Researcher", type: "agent" },
    ],
    edges: [
      { from: "Researcher", to: "ReviewTeam" },
      { from: "ReviewTeam", to: "Researcher_2" },
    ],
    customState: { memory: true },
  };

  renameBuilderReferences(builder, "agent", "Researcher", "LeadResearcher");

  assert.deepEqual(builder.selectedAgents, ["LeadResearcher", "Writer"]);
  assert.deepEqual(builder.sequence, [
    { id: "LeadResearcher", label: "LeadResearcher", type: "agent" },
    { id: "ReviewTeam", label: "ReviewTeam", type: "module" },
    { id: "LeadResearcher_2", label: "LeadResearcher", type: "agent" },
  ]);
  assert.deepEqual(builder.edges, [
    { from: "LeadResearcher", to: "ReviewTeam" },
    { from: "ReviewTeam", to: "LeadResearcher_2" },
  ]);
  assert.deepEqual(builder.customState, { memory: true });
});
