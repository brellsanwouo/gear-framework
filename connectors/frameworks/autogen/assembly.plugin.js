(function (window) {
  if (!window) return;
  window.GearAssemblyPlugins = window.GearAssemblyPlugins || {};
  const utils = window.GearAssemblyEngine?.utils;
  if (!utils) return;
  const { toPythonLiteral: lit, toPythonName, renderTemplate, getTemplate, createConversionReport } = utils;
  const unique = (value, fallback, used) => { let name = toPythonName(value, fallback); let i = 2; while (used.has(name)) name = `${toPythonName(value, fallback)}_${i++}`; used.add(name); return name; };
  const systemMessage = (source) => [
    source?.AgentIdentity?.Purpose && `Purpose: ${source.AgentIdentity.Purpose}`,
    source?.AgentIdentity?.ContextDescription && `Context: ${source.AgentIdentity.ContextDescription}`,
    source?.TaskSpecification?.TaskDescription && `Task: ${source.TaskSpecification.TaskDescription}`,
    source?.TaskSpecification?.ExpectedOutput && `Expected output: ${source.TaskSpecification.ExpectedOutput}`,
  ].filter(Boolean).join("\n\n");

  window.GearAssemblyPlugins.autogen = {
    assemble(input) {
      const ir = input?.gearIR;
      if (!ir?.valid) return { error: (ir?.diagnostics || []).filter((d) => d.severity === "error").map((d) => `# ${d.code}: ${d.message}`).join("\n") || "# Invalid Gear project.", diagnostics: ir?.diagnostics || [] };
      const mappings = input?.mappings || {};
      const diagnostics = [];
      const used = new Set();
      const agentVars = new Map();
      const clientVars = [];
      const agentLines = [];
      const manifest = {};

      ir.agents.forEach((item, index) => {
        const variable = unique(item.name, `agent_${index + 1}`, used);
        const client = `${variable}_client`;
        agentVars.set(item.id, variable);
        clientVars.push(client);
        const llm = item.source?.LLMConfiguration || {};
        const provider = String(llm.Provider || "openai").toLowerCase();
        if (provider !== "openai") diagnostics.push({ code: "AUTOGEN-PROVIDER", severity: "error", message: `Agent ${item.name} requires an AutoGen ${provider} model client adapter.`, path: item.name });
        const params = llm.ModelParameters || {};
        const clientOptions = [["api_key", "os.environ.get(\"OPENAI_API_KEY\")", true], ["base_url", llm.BaseURL], ["timeout", llm.Timeout], ["max_retries", llm.MaxRetries], ["temperature", params.Temperature], ["max_tokens", params.MaxTokens], ["top_p", params.TopP], ["frequency_penalty", params.FrequencyPenalty], ["presence_penalty", params.PresencePenalty], ["seed", params.Seed], ["stop", params.StopSequences]].filter(([, value]) => value !== undefined && value !== null && value !== "");
        agentLines.push(`${client} = OpenAIChatCompletionClient(`, `    model=${lit(llm.Model || "gpt-4.1-mini")},`, "    model_info={\"vision\": False, \"function_calling\": True, \"json_output\": True, \"family\": \"unknown\", \"structured_output\": True},", ...clientOptions.map(([key, value, raw]) => `    ${key}=${raw ? value : lit(value)},`), ")", `${variable} = AssistantAgent(`, `    name=${lit(variable)},`, `    description=${lit(item.source?.TaskSpecification?.TaskName || item.name)},`, `    model_client=${client},`, `    system_message=${lit(systemMessage(item.source))},`, ")", "");
        manifest[item.id] = { variable, model: llm.Model || "gpt-4.1-mini", provider };
      });

      const helpers = ["def task_output(result) -> str:", "    if not result.messages:", "        return \"\"", "    content = result.messages[-1].content", "    return content if isinstance(content, str) else str(content)", "", "async def _run_agent(agent, prompt: str):", "    name = getattr(agent, \"name\", agent.__class__.__name__)", "    return await _gear_trace_async_call(f\"agent.{name}\", prompt, lambda: agent.run(task=prompt), {\"gear.agent\": name})"];
      const moduleVars = new Map();
      const moduleLines = [];
      ir.modules.forEach((module, index) => {
        const fn = `run_${unique(module.name, `module_${index + 1}`, used)}`;
        moduleVars.set(module.id, fn);
        const agents = module.agentRefs.map((ref) => agentVars.get(ref)).filter(Boolean);
        if (module.strategy === "parallel") {
          moduleLines.push(`async def ${fn}(prompt: str) -> str:`, `    results = await asyncio.gather(${agents.map((agent) => `_run_agent(${agent}, prompt)`).join(", ")})`, "    combined = \"\\n\\n\".join(task_output(result) for result in results)");
          const aggregator = agentVars.get(module.aggregator);
          moduleLines.push(...(aggregator ? [`    return task_output(await _run_agent(${aggregator}, combined))`] : ["    return combined"]), "");
        } else {
          const turns = Number.isInteger(module.maxIterations) && module.maxIterations > 0 ? module.maxIterations : 1;
          const maxTurns = Math.max(1, turns * Math.max(1, agents.length));
          const team = unique(`${module.name}_team`, `team_${index + 1}`, used);
          moduleLines.push(`${team} = RoundRobinGroupChat([${agents.join(", ")}], max_turns=${maxTurns})`, `async def ${fn}(prompt: str) -> str:`, `    stop_condition = ${lit(module.stopCondition || "")}`, `    return task_output(await ${team}.run(task=prompt))`, "");
          if (module.stopCondition) diagnostics.push({ code: "AUTOGEN-LOOP-STOP-ADAPTED", severity: "warning", message: `Loop module ${module.name} maps TurnCount to AutoGen team turns; its natural-language stop condition remains metadata.`, path: module.name });
        }
      });

      const callFor = (node) => node.type === "module" ? `${moduleVars.get(node.ref)}(current)` : `_run_agent(${agentVars.get(node.ref)}, current)`;
      const workflowLines = ["async def run_workflow(user_input: str) -> str:", "    current = user_input"];
      ir.workflow.executionLayers.forEach((layer) => {
        if (layer.length === 1) {
          const node = layer[0];
          workflowLines.push(node.type === "module" ? `    current = await ${callFor(node)}` : `    current = task_output(await ${callFor(node)})`);
        } else workflowLines.push(`    layer_results = await asyncio.gather(${layer.map(callFor).join(", ")})`, "    current = \"\\n\\n\".join(task_output(result) if hasattr(result, \"messages\") else str(result) for result in layer_results)");
      });
      workflowLines.push("    return current", "", "async def main() -> None:", "    prompt = os.environ.get(\"GEAR_INPUT\", \"Run the configured Gear workflow.\")", "    try:", "        print(await run_workflow(prompt))", "    finally:", `        await asyncio.gather(${clientVars.map((client) => `${client}.close()`).join(", ")})`, "", "if __name__ == \"__main__\":", "    asyncio.run(main())");
      const imports = ["import asyncio", "import os", "from autogen_agentchat.agents import AssistantAgent", "from autogen_agentchat.teams import RoundRobinGroupChat", "from autogen_ext.models.openai import OpenAIChatCompletionClient", "from dotenv import load_dotenv", "", "load_dotenv()"];
      const orchestration = renderTemplate(getTemplate("autogen") || "{{imports}}\n\n{{helpers_code}}\n\n{{agents_code}}\n\n{{modules_code}}\n\n{{workflow_code}}", { imports: imports.join("\n"), helpers_code: helpers.join("\n"), agents_code: agentLines.join("\n").trim(), modules_code: moduleLines.join("\n").trim(), workflow_code: workflowLines.join("\n") });
      const mappingEntries = [...(mappings.autogenAgent || []), ...(mappings.autogenModule || []), ...(mappings.autogenMulti || [])];
      const consumedPaths = ["AgentIdentity.Name", "AgentIdentity.Purpose", "AgentIdentity.ContextDescription", "LLMConfiguration.Provider", "LLMConfiguration.Model", "LLMConfiguration.BaseURL", "LLMConfiguration.Timeout", "LLMConfiguration.MaxRetries", "LLMConfiguration.ModelParameters.Temperature", "LLMConfiguration.ModelParameters.MaxTokens", "LLMConfiguration.ModelParameters.TopP", "LLMConfiguration.ModelParameters.FrequencyPenalty", "LLMConfiguration.ModelParameters.PresencePenalty", "LLMConfiguration.ModelParameters.StopSequences", "LLMConfiguration.ModelParameters.Seed", "TaskSpecification.TaskName", "TaskSpecification.TaskDescription", "TaskSpecification.ExpectedOutput", "ModuleName", "Strategy.Parallel.ParallelAgents", "Strategy.Parallel.Aggregator", "Strategy.Loop.LoopAgents", "Strategy.Loop.TurnCount", "Strategy.Loop.StopCondition", "WorkflowName", "Items.Agents", "Items.Modules", "Edges.From", "Edges.To"];
      return { outputs: { agents: manifest, orchestration, report: createConversionReport({ frameworkId: "autogen", gearIR: ir, mappingEntries, consumedPaths, diagnostics }) } };
    },
  };
})(window);
