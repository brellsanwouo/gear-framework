(function (window) {
  if (!window) return;
  window.GearAssemblyPlugins = window.GearAssemblyPlugins || {};
  const utils = window.GearAssemblyEngine?.utils;
  if (!utils) return;
  const { toPythonLiteral, toPythonName, renderTemplate, getTemplate, createConversionReport } = utils;
  const pyName = (value, fallback, used) => { let name = toPythonName(value, fallback); let i = 2; while (used.has(name)) name = `${toPythonName(value, fallback)}_${i++}`; used.add(name); return name; };
  const instructions = (agent) => [
    agent?.AgentIdentity?.Purpose && `Purpose: ${agent.AgentIdentity.Purpose}`,
    agent?.AgentIdentity?.ContextDescription && `Context: ${agent.AgentIdentity.ContextDescription}`,
    agent?.TaskSpecification?.TaskDescription && `Task: ${agent.TaskSpecification.TaskDescription}`,
    agent?.TaskSpecification?.ExpectedOutput && `Expected output: ${agent.TaskSpecification.ExpectedOutput}`,
  ].filter(Boolean).join("\n\n");

  window.GearAssemblyPlugins["openai-agents"] = {
    assemble(input) {
      const ir = input?.gearIR;
      if (!ir?.valid) return { error: (ir?.diagnostics || []).filter((d) => d.severity === "error").map((d) => `# ${d.code}: ${d.message}`).join("\n") || "# Invalid Gear project.", diagnostics: ir?.diagnostics || [] };
      const mappings = input?.mappings || {};
      const diagnostics = [];
      const used = new Set();
      const agentVars = new Map();
      const agentLines = [];
      const manifest = {};
      ir.agents.forEach((item, index) => {
        const provider = String(item.source?.LLMConfiguration?.Provider || "openai").toLowerCase();
        if (provider !== "openai") diagnostics.push({ code: "OPENAI-AGENTS-PROVIDER", severity: "error", message: `Agent ${item.name} uses unsupported provider ${provider}.`, path: item.name });
        const variable = pyName(item.name, `agent_${index + 1}`, used);
        agentVars.set(item.id, variable);
        const params = item.source?.LLMConfiguration?.ModelParameters || {};
        const settings = [["temperature", params.Temperature], ["max_tokens", params.MaxTokens], ["top_p", params.TopP], ["frequency_penalty", params.FrequencyPenalty], ["presence_penalty", params.PresencePenalty]].filter(([, value]) => value !== undefined && value !== null && value !== "");
        const settingsValue = settings.length ? `ModelSettings(${settings.map(([key, value]) => `${key}=${toPythonLiteral(value)}`).join(", ")})` : "ModelSettings()";
        agentLines.push(`${variable} = Agent(`, `    name=${toPythonLiteral(item.name)},`, `    instructions=${toPythonLiteral(instructions(item.source))},`, `    handoff_description=${toPythonLiteral(item.source?.TaskSpecification?.TaskName || item.name)},`, `    model=${toPythonLiteral(item.source?.LLMConfiguration?.Model || "gpt-4.1-mini")},`, `    model_settings=${settingsValue},`, ")", "");
        manifest[item.id] = { variable, model: item.source?.LLMConfiguration?.Model || "gpt-4.1-mini" };
      });
      const helpers = ["async def _run_agent(agent: Agent, prompt: str):", "    name = getattr(agent, \"name\", agent.__class__.__name__)", "    return await _gear_trace_async_call(f\"agent.{name}\", prompt, lambda: Runner.run(agent, prompt), {\"gear.agent\": name})"];
      const moduleVars = new Map();
      const moduleLines = [];
      ir.modules.forEach((module, index) => {
        const fn = `run_${pyName(module.name, `module_${index + 1}`, used)}`;
        moduleVars.set(module.id, fn);
        const agents = module.agentRefs.map((ref) => agentVars.get(ref)).filter(Boolean);
        if (module.strategy === "parallel") {
          moduleLines.push(`async def ${fn}(prompt: str) -> str:`, `    results = await asyncio.gather(${agents.map((agent) => `_run_agent(${agent}, prompt)`).join(", ")})`, "    outputs = [str(result.final_output) for result in results]", "    combined = \"\\n\\n\".join(outputs)");
          const aggregator = agentVars.get(module.aggregator);
          moduleLines.push(...(aggregator ? [`    aggregated = await _run_agent(${aggregator}, combined)`, "    return str(aggregated.final_output)"] : ["    return combined"]), "");
        } else {
          const turns = Number.isInteger(module.maxIterations) && module.maxIterations > 0 ? module.maxIterations : 1;
          moduleLines.push(`async def ${fn}(prompt: str) -> str:`, "    current = prompt", `    stop_condition = ${toPythonLiteral(module.stopCondition || "")}`, `    for _ in range(${turns}):`, ...agents.map((agent) => `        current = str((await _run_agent(${agent}, current)).final_output)`), "    return current", "");
          if (module.stopCondition) diagnostics.push({ code: "OPENAI-AGENTS-LOOP-STOP-ADAPTED", severity: "warning", message: `Loop module ${module.name} uses TurnCount as its hard limit.`, path: module.name });
        }
      });
      const runnerFor = (node) => node.type === "module" ? `${moduleVars.get(node.ref)}(current)` : `_run_agent(${agentVars.get(node.ref)}, current)`;
      const workflowLines = ["async def run_workflow(user_input: str) -> str:", "    current = user_input"];
      ir.workflow.executionLayers.forEach((layer) => {
        if (layer.length === 1) {
          const node = layer[0];
          if (node.type === "module") workflowLines.push(`    current = await ${runnerFor(node)}`);
          else workflowLines.push(`    current = str((await ${runnerFor(node)}).final_output)`);
        } else {
          const calls = layer.map(runnerFor);
          workflowLines.push(`    layer_results = await asyncio.gather(${calls.join(", ")})`, "    current = \"\\n\\n\".join(str(result.final_output) if hasattr(result, \"final_output\") else str(result) for result in layer_results)");
        }
      });
      workflowLines.push("    return current", "", "if __name__ == \"__main__\":", "    prompt = os.environ.get(\"GEAR_INPUT\", \"\")", `    with trace(${toPythonLiteral(ir.workflow.name)}):`, "        print(asyncio.run(run_workflow(prompt)))");
      const imports = ["import asyncio", "import os", "from agents import Agent, ModelSettings, Runner, trace", "from dotenv import load_dotenv", "", "load_dotenv()"];
      const orchestration = renderTemplate(getTemplate("openai-agents") || "{{imports}}\n\n{{helpers_code}}\n\n{{agents_code}}\n\n{{modules_code}}\n\n{{workflow_code}}", { imports: imports.join("\n"), helpers_code: helpers.join("\n"), agents_code: agentLines.join("\n").trim(), modules_code: moduleLines.join("\n").trim(), workflow_code: workflowLines.join("\n") });
      const mappingEntries = [...(mappings["openai-agentsAgent"] || []), ...(mappings["openai-agentsModule"] || []), ...(mappings["openai-agentsMulti"] || [])];
      const consumedPaths = ["AgentIdentity.Name", "AgentIdentity.Purpose", "AgentIdentity.ContextDescription", "LLMConfiguration.Provider", "LLMConfiguration.Model", "LLMConfiguration.ModelParameters.Temperature", "LLMConfiguration.ModelParameters.MaxTokens", "LLMConfiguration.ModelParameters.TopP", "LLMConfiguration.ModelParameters.FrequencyPenalty", "LLMConfiguration.ModelParameters.PresencePenalty", "TaskSpecification.TaskName", "TaskSpecification.TaskDescription", "TaskSpecification.ExpectedOutput", "Memory", "ModuleName", "Strategy.Parallel.ParallelAgents", "Strategy.Parallel.Aggregator", "Strategy.Loop.LoopAgents", "Strategy.Loop.TurnCount", "Strategy.Loop.StopCondition", "WorkflowName", "Items.Agents", "Items.Modules", "Edges.From", "Edges.To"];
      const report = createConversionReport({ frameworkId: "openai-agents", gearIR: ir, mappingEntries, consumedPaths, diagnostics });
      return { outputs: { agents: manifest, orchestration, report } };
    },
  };
})(window);
