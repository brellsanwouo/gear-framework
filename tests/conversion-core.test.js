const test = require("node:test");
const assert = require("node:assert/strict");

const { buildGearIR, createConversionReport, instrumentPython, instrumentResult } = require("../gear_sdk/runtime/conversion-core.js");

const agent = (name) => ({
  AgentIdentity: { Name: name, Purpose: `${name} purpose`, ContextDescription: `${name} context` },
  LLMConfiguration: { Provider: "openai", Model: "example-model", ModelParameters: { Temperature: 0 } },
  TaskSpecification: { TaskName: `${name}Task`, TaskDescription: "Do work", ExpectedOutput: "Result" },
});

test("builds a deterministic linear workflow from explicit edges", () => {
  const ir = buildGearIR({
    gearAgents: [agent("A"), agent("B"), agent("C")],
    workflowItems: [
      { id: "node-a", label: "A", type: "agent" },
      { id: "node-b", label: "B", type: "agent" },
      { id: "node-c", label: "C", type: "agent" },
    ],
    workflowYaml: {
      WorkflowName: "Linear",
      Edges: [
        { From: "node-a", To: "node-b" },
        { From: "node-b", To: "node-c" },
      ],
    },
  });

  assert.equal(ir.valid, true);
  assert.deepEqual(ir.workflow.executionLayers.map((layer) => layer.map((node) => node.ref)), [["A"], ["B"], ["C"]]);
});

test("preserves parallel graph layers before a join", () => {
  const ir = buildGearIR({
    gearAgents: [agent("A"), agent("B"), agent("C")],
    workflowItems: [
      { id: "a", label: "A", type: "agent" },
      { id: "b", label: "B", type: "agent" },
      { id: "c", label: "C", type: "agent" },
    ],
    workflowYaml: { Edges: [{ From: "a", To: "c" }, { From: "b", To: "c" }] },
  });

  assert.equal(ir.valid, true);
  assert.deepEqual(ir.workflow.executionLayers.map((layer) => layer.map((node) => node.ref)), [["A", "B"], ["C"]]);
});

test("rejects unknown references and implicit graph cycles", () => {
  const unknown = buildGearIR({
    gearAgents: [agent("A")],
    workflowItems: [{ id: "missing", label: "Missing", type: "agent" }],
  });
  assert.equal(unknown.valid, false);
  assert.ok(unknown.diagnostics.some((item) => item.code === "GEAR-WORKFLOW-UNKNOWN-REF"));

  const cyclic = buildGearIR({
    gearAgents: [agent("A"), agent("B")],
    workflowItems: [{ id: "a", label: "A", type: "agent" }, { id: "b", label: "B", type: "agent" }],
    workflowYaml: { Edges: [{ From: "a", To: "b" }, { From: "b", To: "a" }] },
  });
  assert.equal(cyclic.valid, false);
  assert.ok(cyclic.diagnostics.some((item) => item.code === "GEAR-WORKFLOW-CYCLE"));
});

test("reports only properties actually consumed by a connector as translated", () => {
  const ir = buildGearIR({ gearAgents: [agent("A")] });
  const report = createConversionReport({
    frameworkId: "example",
    gearIR: ir,
    mappingEntries: [
      { from: "AgentIdentity.Name", to: "agent.name", kind: "direct" },
      { from: "AgentIdentity.Purpose", to: "agent.description", kind: "partial" },
      { from: "LLMConfiguration.ModelParameters.Temperature", to: null, kind: "not_mapped" },
    ],
    consumedPaths: ["AgentIdentity.Name"],
  });

  const bySource = new Map(report.properties.map((item) => [item.source, item]));
  assert.equal(bySource.get("AgentIdentity.Name").status, "exact");
  assert.equal(bySource.get("AgentIdentity.Purpose").status, "dropped");
  assert.equal(bySource.get("LLMConfiguration.ModelParameters.Temperature").status, "unsupported");
  assert.equal(report.summary.exact, 1);
  assert.equal(report.summary.dropped, 1);
});

test("uses the same fallback module name as the workflow builder", () => {
  const ir = buildGearIR({
    gearAgents: [agent("Worker")],
    gearModules: [{ Strategy: { Parallel: { ParallelAgents: ["Worker"] } } }],
    workflowItems: [{ id: "Module 1", label: "Module 1", type: "module" }],
    workflowYaml: { Items: { Modules: ["Module 1"] }, Edges: [] },
  });
  assert.equal(ir.modules[0].id, "Module 1");
  assert.equal(ir.diagnostics.some((item) => item.code === "GEAR-WORKFLOW-UNKNOWN-REF"), false);
});

test("adds MLflow observability to every generated Python orchestration", () => {
  const frameworks = [
    "crewai", "adk", "langgraph", "openai-agents", "microsoft-agent-framework",
    "strands", "pydantic-ai", "autogen", "semantic-kernel", "haystack",
  ];
  frameworks.forEach((framework) => {
    const result = instrumentResult({ outputs: { orchestration: "print('ok')" } }, framework);
    assert.match(result.outputs.orchestration, /GEAR MLflow observability/);
    assert.match(result.outputs.orchestration, /MLFLOW_TRACKING_URI/);
    assert.match(result.outputs.orchestration, new RegExp(`gear.target\\\": \\\"${framework}`));
  });
  const once = instrumentPython("#!/usr/bin/env python\nprint('ok')", "crewai");
  assert.equal((instrumentPython(once, "crewai").match(/GEAR MLflow observability/g) || []).length, 2);
  assert.ok(once.startsWith("#!/usr/bin/env python\n# --- GEAR MLflow"));
});
