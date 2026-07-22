(function (window) {
  if (!window) return;
  window.GearAssemblyPlugins = window.GearAssemblyPlugins || {};
  const utils = window.GearAssemblyEngine?.utils;
  if (!utils) return;
  const { toPythonLiteral: lit, toPythonName, renderTemplate, getTemplate, createConversionReport } = utils;
  const unique = (value, fallback, used) => { let name = toPythonName(value, fallback); let i = 2; while (used.has(name)) name = `${toPythonName(value, fallback)}_${i++}`; used.add(name); return name; };
  const instructions = (source) => [
    source?.AgentIdentity?.Purpose && `Purpose: ${source.AgentIdentity.Purpose}`,
    source?.AgentIdentity?.ContextDescription && `Context: ${source.AgentIdentity.ContextDescription}`,
    source?.TaskSpecification?.TaskDescription && `Task: ${source.TaskSpecification.TaskDescription}`,
    source?.TaskSpecification?.ExpectedOutput && `Expected output: ${source.TaskSpecification.ExpectedOutput}`,
  ].filter(Boolean).join("\n\n");

  window.GearAssemblyPlugins["pydantic-ai"] = {
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
        const variable = unique(item.name, `agent_${index + 1}`, used);
        agentVars.set(item.id, variable);
        const llm = item.source?.LLMConfiguration || {};
        const provider = String(llm.Provider || "openai").toLowerCase();
        if (provider !== "openai") diagnostics.push({ code: "PYDANTIC-AI-PROVIDER", severity: "error", message: `Agent ${item.name} requires a PydanticAI ${provider} provider extra and adapter.`, path: item.name });
        const params = llm.ModelParameters || {};
        const settings = [["temperature", params.Temperature], ["max_tokens", params.MaxTokens], ["top_p", params.TopP], ["top_k", params.TopK], ["stop_sequences", params.StopSequences], ["seed", params.Seed], ["timeout", llm.Timeout]].filter(([, value]) => value !== undefined && value !== null && value !== "");
        const settingsText = `{${settings.map(([key, value]) => `${lit(key)}: ${lit(value)}`).join(", ")}}`;
        let modelText = lit(`openai:${llm.Model || "gpt-4.1-mini"}`);
        if (provider === "openai" && llm.BaseURL) modelText = `OpenAIChatModel(${lit(llm.Model || "gpt-4.1-mini")}, provider=OpenAIProvider(base_url=${lit(llm.BaseURL)}, api_key=os.environ.get("OPENAI_API_KEY")))`;
        agentLines.push(`${variable} = Agent(`, `    ${modelText},`, `    name=${lit(item.name)},`, `    instructions=${lit(instructions(item.source))},`, `    model_settings=${settingsText},`, ")", "");
        manifest[item.id] = { variable, model: llm.Model || "gpt-4.1-mini", provider };
      });

      const helpers = ["async def _run_agent(agent: Agent, prompt: str):", "    name = getattr(agent, \"name\", agent.__class__.__name__)", "    return await _gear_trace_async_call(f\"agent.{name}\", prompt, lambda: agent.run(prompt), {\"gear.agent\": name})"];
      const moduleVars = new Map();
      const moduleLines = [];
      ir.modules.forEach((module, index) => {
        const fn = `run_${unique(module.name, `module_${index + 1}`, used)}`;
        moduleVars.set(module.id, fn);
        const agents = module.agentRefs.map((ref) => agentVars.get(ref)).filter(Boolean);
        if (module.strategy === "parallel") {
          moduleLines.push(`async def ${fn}(prompt: str) -> str:`, `    results = await asyncio.gather(${agents.map((agent) => `_run_agent(${agent}, prompt)`).join(", ")})`, "    combined = \"\\n\\n\".join(str(result.output) for result in results)");
          const aggregator = agentVars.get(module.aggregator);
          moduleLines.push(...(aggregator ? [`    return str((await _run_agent(${aggregator}, combined)).output)`] : ["    return combined"]), "");
        } else {
          const turns = Number.isInteger(module.maxIterations) && module.maxIterations > 0 ? module.maxIterations : 1;
          moduleLines.push(`async def ${fn}(prompt: str) -> str:`, "    current = prompt", `    stop_condition = ${lit(module.stopCondition || "")}`, `    for _ in range(${turns}):`, ...agents.map((agent) => `        current = str((await _run_agent(${agent}, current)).output)`), "    return current", "");
          if (module.stopCondition) diagnostics.push({ code: "PYDANTIC-AI-LOOP-STOP-ADAPTED", severity: "warning", message: `Loop module ${module.name} uses TurnCount as its hard limit.`, path: module.name });
        }
      });

      const callFor = (node) => node.type === "module" ? `${moduleVars.get(node.ref)}(current)` : `_run_agent(${agentVars.get(node.ref)}, current)`;
      const workflowLines = ["async def run_workflow(user_input: str) -> str:", "    current = user_input"];
      ir.workflow.executionLayers.forEach((layer) => {
        if (layer.length === 1) {
          const node = layer[0];
          if (node.type === "module") workflowLines.push(`    current = await ${callFor(node)}`);
          else workflowLines.push(`    current = str((await ${callFor(node)}).output)`);
        } else {
          workflowLines.push(`    layer_results = await asyncio.gather(${layer.map(callFor).join(", ")})`, "    current = \"\\n\\n\".join(str(result.output) if hasattr(result, \"output\") else str(result) for result in layer_results)");
        }
      });
      workflowLines.push("    return current", "", "if __name__ == \"__main__\":", "    prompt = os.environ.get(\"GEAR_INPUT\", \"\")", "    print(asyncio.run(run_workflow(prompt)))");
      const imports = ["import asyncio", "import os", "from pydantic_ai import Agent", "from pydantic_ai.models.openai import OpenAIChatModel", "from pydantic_ai.providers.openai import OpenAIProvider", "from dotenv import load_dotenv", "", "load_dotenv()"];
      const orchestration = renderTemplate(getTemplate("pydantic-ai") || "{{imports}}\n\n{{helpers_code}}\n\n{{agents_code}}\n\n{{modules_code}}\n\n{{workflow_code}}", { imports: imports.join("\n"), helpers_code: helpers.join("\n"), agents_code: agentLines.join("\n").trim(), modules_code: moduleLines.join("\n").trim(), workflow_code: workflowLines.join("\n") });
      const mappingEntries = [...(mappings["pydantic-aiAgent"] || []), ...(mappings["pydantic-aiModule"] || []), ...(mappings["pydantic-aiMulti"] || [])];
      const consumedPaths = ["AgentIdentity.Name", "AgentIdentity.Purpose", "AgentIdentity.ContextDescription", "LLMConfiguration.Provider", "LLMConfiguration.Model", "LLMConfiguration.BaseURL", "LLMConfiguration.Timeout", "LLMConfiguration.ModelParameters.Temperature", "LLMConfiguration.ModelParameters.MaxTokens", "LLMConfiguration.ModelParameters.TopP", "LLMConfiguration.ModelParameters.TopK", "LLMConfiguration.ModelParameters.StopSequences", "LLMConfiguration.ModelParameters.Seed", "TaskSpecification.TaskName", "TaskSpecification.TaskDescription", "TaskSpecification.ExpectedOutput", "ModuleName", "Strategy.Parallel.ParallelAgents", "Strategy.Parallel.Aggregator", "Strategy.Loop.LoopAgents", "Strategy.Loop.TurnCount", "Strategy.Loop.StopCondition", "WorkflowName", "Items.Agents", "Items.Modules", "Edges.From", "Edges.To"];
      return { outputs: { agents: manifest, orchestration, report: createConversionReport({ frameworkId: "pydantic-ai", gearIR: ir, mappingEntries, consumedPaths, diagnostics }) } };
    },
  };
})(window);
