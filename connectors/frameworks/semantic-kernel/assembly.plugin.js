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

  window.GearAssemblyPlugins["semantic-kernel"] = {
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
        if (provider !== "openai") diagnostics.push({ code: "SEMANTIC-KERNEL-PROVIDER", severity: "error", message: `Agent ${item.name} requires a Semantic Kernel ${provider} service adapter.`, path: item.name });
        const params = llm.ModelParameters || {};
        const settings = [["temperature", params.Temperature], ["max_tokens", params.MaxTokens], ["top_p", params.TopP], ["frequency_penalty", params.FrequencyPenalty], ["presence_penalty", params.PresencePenalty], ["stop", params.StopSequences], ["seed", params.Seed]].filter(([, value]) => value !== undefined && value !== null && value !== "");
        const settingsText = settings.length ? `OpenAIChatPromptExecutionSettings(${settings.map(([key, value]) => `${key}=${lit(value)}`).join(", ")})` : "OpenAIChatPromptExecutionSettings()";
        const clientOptions = [["base_url", llm.BaseURL], ["timeout", llm.Timeout], ["max_retries", llm.MaxRetries]].filter(([, value]) => value !== undefined && value !== null && value !== "");
        const service = `${variable}_service`;
        if (clientOptions.length) {
          agentLines.push(`${variable}_client = AsyncOpenAI(api_key=os.environ.get("OPENAI_API_KEY"), ${clientOptions.map(([key, value]) => `${key}=${lit(value)}`).join(", ")})`, `${service} = OpenAIChatCompletion(ai_model_id=${lit(llm.Model || "gpt-4.1-mini")}, async_client=${variable}_client)`);
        } else {
          agentLines.push(`${service} = OpenAIChatCompletion(ai_model_id=${lit(llm.Model || "gpt-4.1-mini")}, api_key=os.environ.get("OPENAI_API_KEY"))`);
        }
        agentLines.push(`${variable}_settings = ${settingsText}`, `${variable} = ChatCompletionAgent(`, `    service=${service},`, `    name=${lit(item.name)},`, `    description=${lit(item.source?.AgentIdentity?.Purpose || "")},`, `    instructions=${lit(instructions(item.source))},`, `    arguments=KernelArguments(settings=${variable}_settings),`, ")", "");
        manifest[item.id] = { variable, model: llm.Model || "gpt-4.1-mini", provider };
      });

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
          if (module.stopCondition) diagnostics.push({ code: "SEMANTIC-KERNEL-LOOP-STOP-ADAPTED", severity: "warning", message: `Loop module ${module.name} uses TurnCount as its hard limit.`, path: module.name });
        }
      });

      const callFor = (node) => node.type === "module" ? `${moduleVars.get(node.ref)}(current)` : `_run_agent(${agentVars.get(node.ref)}, current)`;
      const workflowLines = [`WORKFLOW_NAME = ${lit(ir.workflow.name || "GearWorkflow")}`, "", "async def run_workflow(user_input: str) -> str:", "    current = user_input"];
      ir.workflow.executionLayers.forEach((layer) => {
        if (layer.length === 1) workflowLines.push(`    current = await ${callFor(layer[0])}`);
        else workflowLines.push(`    layer_results = await asyncio.gather(${layer.map(callFor).join(", ")})`, "    current = \"\\n\\n\".join(layer_results)");
      });
      workflowLines.push("    return current", "", "if __name__ == \"__main__\":", "    prompt = os.environ.get(\"GEAR_INPUT\", \"\")", "    print(asyncio.run(run_workflow(prompt)))");
      const imports = ["import asyncio", "import os", "from openai import AsyncOpenAI", "from semantic_kernel.agents import ChatCompletionAgent", "from semantic_kernel.connectors.ai.open_ai import OpenAIChatCompletion, OpenAIChatPromptExecutionSettings", "from semantic_kernel.functions import KernelArguments", "from dotenv import load_dotenv", "", "load_dotenv()"];
      const helpers = ["async def _run_agent(agent: ChatCompletionAgent, prompt: str) -> str:", "    name = getattr(agent, \"name\", agent.__class__.__name__)", "    response = await _gear_trace_async_call(f\"agent.{name}\", prompt, lambda: agent.get_response(messages=prompt), {\"gear.agent\": name})", "    return str(response.content)"];
      const orchestration = renderTemplate(getTemplate("semantic-kernel") || "{{imports}}\n\n{{helpers_code}}\n\n{{agents_code}}\n\n{{modules_code}}\n\n{{workflow_code}}", { imports: imports.join("\n"), helpers_code: helpers.join("\n"), agents_code: agentLines.join("\n").trim(), modules_code: moduleLines.join("\n").trim(), workflow_code: workflowLines.join("\n") });
      const mappingEntries = [...(mappings["semantic-kernelAgent"] || []), ...(mappings["semantic-kernelModule"] || []), ...(mappings["semantic-kernelMulti"] || [])];
      const consumedPaths = ["AgentIdentity.Name", "AgentIdentity.Purpose", "AgentIdentity.ContextDescription", "LLMConfiguration.Provider", "LLMConfiguration.Model", "LLMConfiguration.BaseURL", "LLMConfiguration.Timeout", "LLMConfiguration.MaxRetries", "LLMConfiguration.ModelParameters.Temperature", "LLMConfiguration.ModelParameters.MaxTokens", "LLMConfiguration.ModelParameters.TopP", "LLMConfiguration.ModelParameters.FrequencyPenalty", "LLMConfiguration.ModelParameters.PresencePenalty", "LLMConfiguration.ModelParameters.StopSequences", "LLMConfiguration.ModelParameters.Seed", "TaskSpecification.TaskName", "TaskSpecification.TaskDescription", "TaskSpecification.ExpectedOutput", "ModuleName", "Strategy.Parallel.ParallelAgents", "Strategy.Parallel.Aggregator", "Strategy.Loop.LoopAgents", "Strategy.Loop.TurnCount", "Strategy.Loop.StopCondition", "WorkflowName", "Items.Agents", "Items.Modules", "Edges.From", "Edges.To"];
      return { outputs: { agents: manifest, orchestration, report: createConversionReport({ frameworkId: "semantic-kernel", gearIR: ir, mappingEntries, consumedPaths, diagnostics }) } };
    },
  };
})(window);
