const test = require("node:test");
const assert = require("node:assert/strict");

global.window = {};
window.GearConversionCore = require("../gear_sdk/runtime/conversion-core.js");
require("../gear_sdk/runtime/assembly-engine.js");
require("../connectors/frameworks/crewai/assembly.plugin.js");
require("../connectors/frameworks/adk/assembly.plugin.js");
require("../connectors/frameworks/langgraph/assembly.plugin.js");
require("../connectors/frameworks/openai-agents/assembly.plugin.js");
require("../connectors/frameworks/microsoft-agent-framework/assembly.plugin.js");
require("../connectors/frameworks/strands/assembly.plugin.js");
require("../connectors/frameworks/pydantic-ai/assembly.plugin.js");
require("../connectors/frameworks/autogen/assembly.plugin.js");
require("../connectors/frameworks/semantic-kernel/assembly.plugin.js");
require("../connectors/frameworks/haystack/assembly.plugin.js");

const agentMappings = [
  { from: "AgentIdentity.Name", to: "Identity.Role", kind: "equivalent" },
  { from: "AgentIdentity.Name", to: "BaseAgent.Name", kind: "direct" },
  { from: "AgentIdentity.Purpose", to: "Identity.Goal", kind: "equivalent" },
  { from: "AgentIdentity.ContextDescription", to: "Identity.Backstory", kind: "equivalent" },
  { from: "LLMConfiguration.Model", to: "LLMConfiguration.Model", kind: "direct" },
  { from: "LLMConfiguration.Model", to: "LLMAgentConfig.Model", kind: "direct" },
  { from: "LLMConfiguration.ModelParameters.Temperature", to: "LLMConfiguration.Advanced_configs.Temperature", kind: "direct" },
  { from: "LLMConfiguration.ModelParameters.Temperature", to: "LLMAgentConfig.GenerateContentConfig.Temperature", kind: "direct" },
  { from: "TaskSpecification.TaskName", to: "Task.Essential.Name", kind: "partial" },
  { from: "TaskSpecification.TaskName", to: "Configurations.DataStructure.OutputKey", kind: "partial" },
  { from: "TaskSpecification.TaskDescription", to: "Task.Essential.Description", kind: "direct" },
  { from: "TaskSpecification.TaskDescription", to: "Configurations.Instruction", kind: "direct" },
  { from: "TaskSpecification.ExpectedOutput", to: "Task.Essential.ExpectedOutput", kind: "direct" },
];

const workflowMappings = [
  { from: "WorkflowName", to: "SystemDefinition.RootAgent", kind: "partial" },
  { from: "", to: "Crew.EssentialComponents.Process", value: "sequential", kind: "partial" },
];

const makeAgent = (name) => ({
  AgentIdentity: { Name: name, Purpose: `${name} purpose`, ContextDescription: `${name} context` },
  LLMConfiguration: { Provider: "openai", Model: "gpt-4.1-mini", ModelParameters: { Temperature: 0.2 } },
  TaskSpecification: { TaskName: `${name}Task`, TaskDescription: "Do work", ExpectedOutput: "Result" },
});

const makeInput = () => {
  const input = {
    gearAgents: [makeAgent("A"), makeAgent("B"), makeAgent("C")],
    gearModules: [],
    workflowItems: [
      { id: "a", label: "A", type: "agent" },
      { id: "b", label: "B", type: "agent" },
      { id: "c", label: "C", type: "agent" },
    ],
    workflowYaml: {
      WorkflowName: "Graph",
      Edges: [{ From: "a", To: "c" }, { From: "b", To: "c" }],
    },
    mappings: {
      crewaiAgent: agentMappings,
      crewaiModule: [],
      crewaiMulti: workflowMappings,
      adkAgent: agentMappings,
      adkMulti: workflowMappings,
      adkModule: [],
    },
  };
  input.gearIR = window.GearConversionCore.buildGearIR(input);
  return input;
};

test("sanitizes Python keywords and leading digits used as generated variables", () => {
  assert.equal(window.GearAssemblyEngine.utils.toPythonName("class", "agent"), "gear_class");
  assert.equal(window.GearAssemblyEngine.utils.toPythonName("2nd Agent", "agent"), "gear_2nd_agent");
});

test("CrewAI preserves parallel graph layers and consumes advanced LLM settings", () => {
  const result = window.GearAssemblyPlugins.crewai.assemble(makeInput());
  assert.equal(result.error, undefined);
  assert.match(result.outputs.orchestration, /model="openai\/gpt-4\.1-mini"/);
  assert.doesNotMatch(result.outputs.orchestration, /provider="openai"/);
  assert.match(result.outputs.orchestration, /tracing=False/);
  assert.match(result.outputs.orchestration, /temperature=0\.2/);
  assert.match(result.outputs.orchestration, /await asyncio\.gather\(run_a\(current\), run_b\(current\)\)/);
  assert.match(result.outputs.orchestration, /kickoff_async\(inputs=\{"gear_input": prompt\}\)/);
  assert.match(result.outputs.orchestration, /if __name__ == "__main__":/);
  assert.equal(result.outputs.report.valid, true);
});

test("ADK compiles parallel graph layers and generation settings", () => {
  const result = window.GearAssemblyPlugins.adk.assemble(makeInput());
  assert.equal(result.error, undefined);
  assert.match(result.outputs.orchestration, /WorkflowStage1/);
  assert.match(result.outputs.orchestration, /generate_content_config=types\.GenerateContentConfig/);
  assert.match(result.outputs.orchestration, /events = await runner\.run_debug\(user_input, quiet=True\)/);
  assert.match(result.outputs.orchestration, /if __name__ == "__main__":/);
  assert.equal(result.outputs.report.valid, true);
});

test("LangGraph preserves graph joins and produces executable Python", () => {
  const input = makeInput();
  input.mappings.langgraphAgent = agentMappings;
  input.mappings.langgraphModule = [];
  input.mappings.langgraphMulti = workflowMappings;
  const result = window.GearAssemblyPlugins.langgraph.assemble(input);
  assert.equal(result.error, undefined);
  assert.match(result.outputs.orchestration, /StateGraph\(WorkflowState\)/);
  assert.match(result.outputs.orchestration, /builder\.add_edge\(\["a", "b"\], "c"\)/);
  assert.equal(result.outputs.report.valid, true);
});

test("OpenAI Agents SDK compiles deterministic parallel orchestration", () => {
  const input = makeInput();
  input.mappings["openai-agentsAgent"] = agentMappings;
  input.mappings["openai-agentsModule"] = [];
  input.mappings["openai-agentsMulti"] = workflowMappings;
  const result = window.GearAssemblyPlugins["openai-agents"].assemble(input);
  assert.equal(result.error, undefined);
  assert.match(result.outputs.orchestration, /from agents import Agent, ModelSettings, Runner, trace/);
  assert.match(result.outputs.orchestration, /asyncio\.gather/);
  assert.equal(result.outputs.report.valid, true);
});

test("Microsoft Agent Framework compiles native fan-in workflow edges", () => {
  const input = makeInput();
  input.mappings["microsoft-agent-frameworkAgent"] = agentMappings;
  input.mappings["microsoft-agent-frameworkModule"] = [];
  input.mappings["microsoft-agent-frameworkMulti"] = workflowMappings;
  const result = window.GearAssemblyPlugins["microsoft-agent-framework"].assemble(input);
  assert.equal(result.error, undefined);
  assert.match(result.outputs.orchestration, /WorkflowBuilder/);
  assert.match(result.outputs.orchestration, /add_fan_in_edges/);
  assert.equal(result.outputs.report.valid, true);
});

test("Strands compiles graph joins with explicit dependency barriers", () => {
  const input = makeInput();
  input.mappings.strandsAgent = agentMappings;
  input.mappings.strandsModule = [];
  input.mappings.strandsMulti = workflowMappings;
  const result = window.GearAssemblyPlugins.strands.assemble(input);
  assert.equal(result.error, undefined);
  assert.match(result.outputs.orchestration, /GraphBuilder/);
  assert.match(result.outputs.orchestration, /all_dependencies_complete\(\["a", "b"\]\)/);
  assert.equal(result.outputs.report.valid, true);
});

test("PydanticAI compiles deterministic parallel agent hand-offs", () => {
  const input = makeInput();
  input.mappings["pydantic-aiAgent"] = agentMappings;
  input.mappings["pydantic-aiModule"] = [];
  input.mappings["pydantic-aiMulti"] = workflowMappings;
  const result = window.GearAssemblyPlugins["pydantic-ai"].assemble(input);
  assert.equal(result.error, undefined);
  assert.match(result.outputs.orchestration, /from pydantic_ai import Agent/);
  assert.match(result.outputs.orchestration, /await asyncio\.gather\(a\.run\(current\), b\.run\(current\)\)/);
  assert.equal(result.outputs.report.valid, true);
});

test("AutoGen compiles parallel agents and bounded round-robin teams", () => {
  const input = makeInput();
  input.mappings.autogenAgent = agentMappings;
  input.mappings.autogenModule = [];
  input.mappings.autogenMulti = workflowMappings;
  const result = window.GearAssemblyPlugins.autogen.assemble(input);
  assert.equal(result.error, undefined);
  assert.match(result.outputs.orchestration, /from autogen_agentchat\.agents import AssistantAgent/);
  assert.match(result.outputs.orchestration, /await asyncio\.gather\(a\.run\(task=current\), b\.run\(task=current\)\)/);
  assert.equal(result.outputs.report.valid, true);
});

test("Semantic Kernel compiles stable agents and deterministic parallel hand-offs", () => {
  const input = makeInput();
  input.gearAgents[0].LLMConfiguration.BaseURL = "https://llm.example/v1";
  input.gearAgents[0].LLMConfiguration.Timeout = 30;
  input.gearAgents[0].LLMConfiguration.MaxRetries = 2;
  input.gearIR = window.GearConversionCore.buildGearIR(input);
  input.mappings["semantic-kernelAgent"] = agentMappings;
  input.mappings["semantic-kernelModule"] = [];
  input.mappings["semantic-kernelMulti"] = workflowMappings;
  const result = window.GearAssemblyPlugins["semantic-kernel"].assemble(input);
  assert.equal(result.error, undefined);
  assert.match(result.outputs.orchestration, /from semantic_kernel\.agents import ChatCompletionAgent/);
  assert.match(result.outputs.orchestration, /await asyncio\.gather\(_run_agent\(a, current\), _run_agent\(b, current\)\)/);
  assert.match(result.outputs.orchestration, /OpenAIChatPromptExecutionSettings\(temperature=0\.2\)/);
  assert.match(result.outputs.orchestration, /AsyncOpenAI\(api_key=os\.environ\.get\("OPENAI_API_KEY"\), base_url="https:\/\/llm\.example\/v1", timeout=30, max_retries=2\)/);
  assert.match(result.outputs.orchestration, /WORKFLOW_NAME = "Graph"/);
  assert.equal(result.outputs.report.valid, true);
});

test("Haystack compiles native agents, model settings, and parallel hand-offs", () => {
  const input = makeInput();
  input.gearAgents[0].LLMConfiguration.BaseURL = "https://llm.example/v1";
  input.gearAgents[0].LLMConfiguration.Timeout = 30;
  input.gearAgents[0].LLMConfiguration.MaxRetries = 2;
  input.gearAgents[0].LLMConfiguration.ModelParameters.MaxTokens = 400;
  input.gearIR = window.GearConversionCore.buildGearIR(input);
  input.mappings.haystackAgent = agentMappings;
  input.mappings.haystackModule = [];
  input.mappings.haystackMulti = workflowMappings;
  const result = window.GearAssemblyPlugins.haystack.assemble(input);
  assert.equal(result.error, undefined);
  assert.match(result.outputs.orchestration, /from haystack\.components\.agents import Agent/);
  assert.match(result.outputs.orchestration, /generation_kwargs=\{"temperature": 0\.2, "max_completion_tokens": 400\}/);
  assert.match(result.outputs.orchestration, /api_base_url="https:\/\/llm\.example\/v1"/);
  assert.match(result.outputs.orchestration, /await asyncio\.gather\(_run_agent\(a, current\), _run_agent\(b, current\)\)/);
  assert.match(result.outputs.orchestration, /WORKFLOW_NAME = "Graph"/);
  assert.equal(result.outputs.report.valid, true);
});
