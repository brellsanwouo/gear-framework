(function (window) {
  if (!window) return;
  window.GearAssemblyPlugins = window.GearAssemblyPlugins || {};
  const utils = window.GearAssemblyEngine?.utils;
  if (!utils) return;
  const { toCrewaiModel, toPythonLiteral: lit, toPythonName, renderTemplate, getTemplate, createConversionReport } = utils;
  const unique = (value, fallback, used) => { let name = toPythonName(value, fallback); let i = 2; while (used.has(name)) name = `${toPythonName(value, fallback)}_${i++}`; used.add(name); return name; };
  const meaningful = (value) => value !== undefined && value !== null && value !== "";

  window.GearAssemblyPlugins.crewai = {
    assemble(input) {
      const ir = input?.gearIR;
      if (!ir?.valid) return { error: (ir?.diagnostics || []).filter((d) => d.severity === "error").map((d) => `# ${d.code}: ${d.message}`).join("\n") || "# Invalid Gear project.", diagnostics: ir?.diagnostics || [] };
      const mappings = input?.mappings || {};
      const diagnostics = [];
      const used = new Set();
      const agentVars = new Map();
      const runnerVars = new Map();
      const agentLines = [];
      const taskLines = [];
      const agents = {};
      const tasks = {};

      ir.agents.forEach((item, index) => {
        const source = item.source || {};
        const identity = source.AgentIdentity || {};
        const task = source.TaskSpecification || {};
        const llm = source.LLMConfiguration || {};
        const params = llm.ModelParameters || {};
        const controls = source.ExecutionControl || {};
        const variable = unique(item.name, `agent_${index + 1}`, used);
        const llmVar = unique(`${item.name}_llm`, `agent_${index + 1}_llm`, used);
        const taskFactory = unique(`make_${task.TaskName || item.name}_task`, `make_task_${index + 1}`, used);
        const runner = unique(`run_${item.name}`, `run_agent_${index + 1}`, used);
        agentVars.set(item.id, variable);
        runnerVars.set(item.id, runner);

        const model = toCrewaiModel(llm.Provider, llm.Model || "gpt-4.1-mini");
        const additional = params.AdditionalParams && typeof params.AdditionalParams === "object" ? params.AdditionalParams : {};
        // CrewAI selects its provider from the provider-prefixed model name.
        // Passing both provider="openai" and model="openai/..." makes the
        // native OpenAI client receive the prefixed value as the model ID.
        const llmOptions = [["model", model], ["base_url", llm.BaseURL], ["timeout", llm.Timeout], ["temperature", params.Temperature], ["max_tokens", params.MaxTokens], ["top_p", params.TopP], ["stop", params.StopSequences], ["frequency_penalty", params.FrequencyPenalty], ["presence_penalty", params.PresencePenalty], ["seed", params.Seed], ["additional_params", Object.keys(additional).length ? additional : undefined]].filter(([, value]) => meaningful(value));
        agentLines.push(`${llmVar} = LLM(`, ...llmOptions.map(([key, value]) => `    ${key}=${lit(value)},`), ")", `${variable} = Agent(`, `    role=${lit(item.name)},`, `    goal=${lit(identity.Purpose || "Complete the assigned task.")},`, `    backstory=${lit(identity.ContextDescription || "")},`, `    llm=${llmVar},`, `    verbose=${controls.VerbosityControl === true ? "True" : "False"},`, `    allow_delegation=${controls.DelegationControl === true ? "True" : "False"},`, `    allow_code_execution=${controls.CodeExecutionControl === true ? "True" : "False"},`, `    cache=${controls.CachingControl === true ? "True" : "False"},`, `    reasoning=${source.Reasoning === true ? "True" : "False"},`, `    memory=${source.Memory === true ? "True" : "False"},`, ...(meaningful(llm.MaxRetries) ? [`    max_retry_limit=${lit(llm.MaxRetries)},`] : []), ")", "");

        const description = `${task.TaskDescription || "Complete the assigned task."}\n\nWorkflow input:\n{gear_input}`;
        taskLines.push(`def ${taskFactory}() -> Task:`, "    return Task(", `        name=${lit(task.TaskName || `${item.name}Task`)},`, `        description=${lit(description)},`, `        expected_output=${lit(task.ExpectedOutput || "A useful result.")},`, `        agent=${variable},`, `        human_input=${controls.HumanInteractionControl === true ? "True" : "False"},`, "    )", "", `async def ${runner}(prompt: str) -> str:`, `    task = ${taskFactory}()`, `    crew = Crew(name=${lit(`${item.name}Crew`)}, agents=[${variable}], tasks=[task], process=Process.sequential, memory=${source.Memory === true ? "True" : "False"})`, "    result = await crew.kickoff_async(inputs={\"gear_input\": prompt})", "    return str(result)", "");

        agents[item.name] = { role: item.name, goal: identity.Purpose || "", backstory: identity.ContextDescription || "", llm: { provider: llm.Provider || "openai", model, ...Object.fromEntries(llmOptions.filter(([key]) => key !== "model")) } };
        tasks[task.TaskName || `${item.name}Task`] = { name: task.TaskName || `${item.name}Task`, description: task.TaskDescription || "", expected_output: task.ExpectedOutput || "", agent: item.name };
      });

      const moduleVars = new Map();
      const moduleLines = [];
      ir.modules.forEach((module, index) => {
        const fn = `run_${unique(module.name, `module_${index + 1}`, used)}`;
        moduleVars.set(module.id, fn);
        const runners = module.agentRefs.map((ref) => runnerVars.get(ref)).filter(Boolean);
        if (module.strategy === "parallel") {
          moduleLines.push(`async def ${fn}(prompt: str) -> str:`, `    results = await asyncio.gather(${runners.map((runner) => `${runner}(prompt)`).join(", ")})`, "    combined = \"\\n\\n\".join(results)");
          const aggregator = runnerVars.get(module.aggregator);
          moduleLines.push(...(aggregator ? [`    return await ${aggregator}(combined)`] : ["    return combined"]), "");
        } else {
          const turns = Number.isInteger(module.maxIterations) && module.maxIterations > 0 ? module.maxIterations : 1;
          moduleLines.push(`async def ${fn}(prompt: str) -> str:`, "    current = prompt", `    stop_condition = ${lit(module.stopCondition || "")}`, `    for _ in range(${turns}):`, ...runners.map((runner) => `        current = await ${runner}(current)`), "    return current", "");
          if (module.stopCondition) diagnostics.push({ code: "CREWAI-LOOP-STOP-ADAPTED", severity: "warning", message: `Loop module ${module.name} uses TurnCount as its hard limit; its natural-language stop condition remains metadata.`, path: module.name });
        }
      });

      const callFor = (node) => node.type === "module" ? `${moduleVars.get(node.ref)}(current)` : `${runnerVars.get(node.ref)}(current)`;
      const workflowLines = [`WORKFLOW_NAME = ${lit(ir.workflow.name || "GearWorkflow")}`, "", "async def run_workflow(user_input: str) -> str:", "    current = user_input"];
      ir.workflow.executionLayers.forEach((layer) => {
        if (layer.length === 1) workflowLines.push(`    current = await ${callFor(layer[0])}`);
        else workflowLines.push(`    layer_results = await asyncio.gather(${layer.map(callFor).join(", ")})`, "    current = \"\\n\\n\".join(layer_results)");
      });
      workflowLines.push("    return current", "", "if __name__ == \"__main__\":", "    prompt = os.environ.get(\"GEAR_INPUT\", \"Run the configured Gear workflow.\")", "    print(asyncio.run(run_workflow(prompt)))");
      const imports = ["import asyncio", "import os", "from crewai import Agent, Crew, Task, Process, LLM", "from dotenv import load_dotenv", "", "load_dotenv()"];
      const orchestration = renderTemplate(getTemplate("crewai") || "{{imports}}\n\n{{agents_code}}\n\n{{tasks_code}}\n\n{{crew_block}}\n\n{{post_run}}", { imports: imports.join("\n"), agents_code: agentLines.join("\n").trim(), tasks_code: taskLines.join("\n").trim(), crew_block: moduleLines.join("\n").trim(), post_run: workflowLines.join("\n") });
      const mappingEntries = [...(mappings.crewaiAgent || []), ...(mappings.crewaiModule || []), ...(mappings.crewaiMulti || [])];
      const consumedPaths = ["AgentIdentity.Name", "AgentIdentity.Purpose", "AgentIdentity.ContextDescription", "LLMConfiguration.Provider", "LLMConfiguration.Model", "LLMConfiguration.BaseURL", "LLMConfiguration.Timeout", "LLMConfiguration.MaxRetries", "LLMConfiguration.ModelParameters.Temperature", "LLMConfiguration.ModelParameters.MaxTokens", "LLMConfiguration.ModelParameters.TopP", "LLMConfiguration.ModelParameters.StopSequences", "LLMConfiguration.ModelParameters.AdditionalParams", "LLMConfiguration.ModelParameters.FrequencyPenalty", "LLMConfiguration.ModelParameters.PresencePenalty", "LLMConfiguration.ModelParameters.Seed", "TaskSpecification.TaskName", "TaskSpecification.TaskDescription", "TaskSpecification.ExpectedOutput", "ExecutionControl.DelegationControl", "ExecutionControl.CodeExecutionControl", "ExecutionControl.AsyncExecutionControl", "ExecutionControl.HumanInteractionControl", "ExecutionControl.VerbosityControl", "ExecutionControl.CachingControl", "Reasoning", "Memory", "ModuleName", "Strategy.Parallel.ParallelAgents", "Strategy.Parallel.Aggregator", "Strategy.Loop.LoopAgents", "Strategy.Loop.TurnCount", "Strategy.Loop.StopCondition", "WorkflowName", "Items.Agents", "Items.Modules", "Edges.From", "Edges.To"];
      return { outputs: { agents, tasks, orchestration, report: createConversionReport({ frameworkId: "crewai", gearIR: ir, mappingEntries, consumedPaths, diagnostics }) } };
    },
  };
})(window);
