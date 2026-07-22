(function (window) {
  if (!window) return;
  window.GearAssemblyPlugins = window.GearAssemblyPlugins || {};
  const utils = window.GearAssemblyEngine?.utils;
  if (!utils) return;
  const { toPythonLiteral: lit, toPythonName, renderTemplate, getTemplate, createConversionReport } = utils;
  const unique = (value, fallback, used) => { let name = toPythonName(value, fallback); let i = 2; while (used.has(name)) name = `${toPythonName(value, fallback)}_${i++}`; used.add(name); return name; };
  const systemPrompt = (name, source) => [
    name && `Agent name: ${name}`,
    source?.AgentIdentity?.Purpose && `Purpose: ${source.AgentIdentity.Purpose}`,
    source?.AgentIdentity?.ContextDescription && `Context: ${source.AgentIdentity.ContextDescription}`,
    source?.TaskSpecification?.TaskName && `Task name: ${source.TaskSpecification.TaskName}`,
    source?.TaskSpecification?.TaskDescription && `Task: ${source.TaskSpecification.TaskDescription}`,
    source?.TaskSpecification?.ExpectedOutput && `Expected output: ${source.TaskSpecification.ExpectedOutput}`,
  ].filter(Boolean).join("\n\n");

  window.GearAssemblyPlugins.haystack = {
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
        const generator = `${variable}_generator`;
        agentVars.set(item.id, variable);
        const llm = item.source?.LLMConfiguration || {};
        const provider = String(llm.Provider || "openai").toLowerCase();
        if (provider !== "openai") diagnostics.push({ code: "HAYSTACK-PROVIDER", severity: "error", message: `Agent ${item.name} requires a Haystack ${provider} chat generator adapter.`, path: item.name });
        const params = llm.ModelParameters || {};
        const generation = { ...(params.AdditionalParams && typeof params.AdditionalParams === "object" ? params.AdditionalParams : {}) };
        [["temperature", params.Temperature], ["max_completion_tokens", params.MaxTokens], ["top_p", params.TopP], ["frequency_penalty", params.FrequencyPenalty], ["presence_penalty", params.PresencePenalty], ["stop", params.StopSequences], ["seed", params.Seed]].forEach(([key, value]) => { if (value !== undefined && value !== null && value !== "") generation[key] = value; });
        const options = [["api_base_url", llm.BaseURL], ["timeout", llm.Timeout], ["max_retries", llm.MaxRetries]].filter(([, value]) => value !== undefined && value !== null && value !== "");
        agentLines.push(`${generator} = OpenAIChatGenerator(`, "    api_key=Secret.from_env_var(\"OPENAI_API_KEY\"),", `    model=${lit(llm.Model || "gpt-4.1-mini")},`, `    generation_kwargs=${lit(generation)},`, ...options.map(([key, value]) => `    ${key}=${lit(value)},`), ")", `${variable} = Agent(`, `    chat_generator=${generator},`, `    system_prompt=${lit(systemPrompt(item.name, item.source))},`, ")", "");
        manifest[item.id] = { variable, model: llm.Model || "gpt-4.1-mini", provider };
      });

      const helpers = ["async def _run_agent(agent: Agent, prompt: str) -> str:", "    name = getattr(agent, \"name\", agent.__class__.__name__)", "    result = await _gear_trace_async_call(f\"agent.{name}\", prompt, lambda: agent.run_async(messages=[ChatMessage.from_user(prompt)]), {\"gear.agent\": name})", "    return result[\"last_message\"].text"];
      const moduleVars = new Map();
      const moduleLines = [];
      ir.modules.forEach((module, index) => {
        const fn = `run_${unique(module.name, `module_${index + 1}`, used)}`;
        moduleVars.set(module.id, fn);
        const agents = module.agentRefs.map((ref) => agentVars.get(ref)).filter(Boolean);
        if (module.strategy === "parallel") {
          moduleLines.push(`async def ${fn}(prompt: str) -> str:`, `    results = await asyncio.gather(${agents.map((agent) => `_run_agent(${agent}, prompt)`).join(", ")})`, "    combined = \"\\n\\n\".join(results)");
          const aggregator = agentVars.get(module.aggregator);
          moduleLines.push(...(aggregator ? [`    return await _run_agent(${aggregator}, combined)`] : ["    return combined"]), "");
        } else {
          const turns = Number.isInteger(module.maxIterations) && module.maxIterations > 0 ? module.maxIterations : 1;
          moduleLines.push(`async def ${fn}(prompt: str) -> str:`, "    current = prompt", `    stop_condition = ${lit(module.stopCondition || "")}`, `    for _ in range(${turns}):`, ...agents.map((agent) => `        current = await _run_agent(${agent}, current)`), "    return current", "");
          if (module.stopCondition) diagnostics.push({ code: "HAYSTACK-LOOP-STOP-ADAPTED", severity: "warning", message: `Loop module ${module.name} uses TurnCount as its hard limit; its natural-language stop condition remains metadata.`, path: module.name });
        }
      });

      const callFor = (node) => node.type === "module" ? `${moduleVars.get(node.ref)}(current)` : `_run_agent(${agentVars.get(node.ref)}, current)`;
      const workflowLines = [`WORKFLOW_NAME = ${lit(ir.workflow.name || "GearWorkflow")}`, "", "async def run_workflow(user_input: str) -> str:", "    current = user_input"];
      ir.workflow.executionLayers.forEach((layer) => {
        if (layer.length === 1) workflowLines.push(`    current = await ${callFor(layer[0])}`);
        else workflowLines.push(`    layer_results = await asyncio.gather(${layer.map(callFor).join(", ")})`, "    current = \"\\n\\n\".join(layer_results)");
      });
      workflowLines.push("    return current", "", "if __name__ == \"__main__\":", "    prompt = os.environ.get(\"GEAR_INPUT\", \"Run the configured Gear workflow.\")", "    print(asyncio.run(run_workflow(prompt)))");
      const imports = ["import asyncio", "import os", "from haystack.components.agents import Agent", "from haystack.components.generators.chat import OpenAIChatGenerator", "from haystack.dataclasses import ChatMessage", "from haystack.utils import Secret", "from dotenv import load_dotenv", "", "load_dotenv()"];
      const orchestration = renderTemplate(getTemplate("haystack") || "{{imports}}\n\n{{helpers_code}}\n\n{{agents_code}}\n\n{{modules_code}}\n\n{{workflow_code}}", { imports: imports.join("\n"), helpers_code: helpers.join("\n"), agents_code: agentLines.join("\n").trim(), modules_code: moduleLines.join("\n").trim(), workflow_code: workflowLines.join("\n") });
      const mappingEntries = [...(mappings.haystackAgent || []), ...(mappings.haystackModule || []), ...(mappings.haystackMulti || [])];
      const consumedPaths = ["AgentIdentity.Name", "AgentIdentity.Purpose", "AgentIdentity.ContextDescription", "LLMConfiguration.Provider", "LLMConfiguration.Model", "LLMConfiguration.BaseURL", "LLMConfiguration.Timeout", "LLMConfiguration.MaxRetries", "LLMConfiguration.ModelParameters.Temperature", "LLMConfiguration.ModelParameters.MaxTokens", "LLMConfiguration.ModelParameters.TopP", "LLMConfiguration.ModelParameters.FrequencyPenalty", "LLMConfiguration.ModelParameters.PresencePenalty", "LLMConfiguration.ModelParameters.StopSequences", "LLMConfiguration.ModelParameters.Seed", "LLMConfiguration.ModelParameters.AdditionalParams", "TaskSpecification.TaskName", "TaskSpecification.TaskDescription", "TaskSpecification.ExpectedOutput", "ModuleName", "Strategy.Parallel.ParallelAgents", "Strategy.Parallel.Aggregator", "Strategy.Loop.LoopAgents", "Strategy.Loop.TurnCount", "Strategy.Loop.StopCondition", "WorkflowName", "Items.Agents", "Items.Modules", "Edges.From", "Edges.To"];
      return { outputs: { agents: manifest, orchestration, report: createConversionReport({ frameworkId: "haystack", gearIR: ir, mappingEntries, consumedPaths, diagnostics }) } };
    },
  };
})(window);
