(function (window) {
  if (!window) return;
  window.GearAssemblyPlugins = window.GearAssemblyPlugins || {};
  const u = window.GearAssemblyEngine?.utils;
  if (!u) return;
  const { toPythonLiteral: lit, toPythonName, renderTemplate, getTemplate, createConversionReport } = u;
  const unique = (value, fallback, used) => { let name = toPythonName(value, fallback); let n = 2; while (used.has(name)) name = `${toPythonName(value, fallback)}_${n++}`; used.add(name); return name; };
  const prompt = (source) => [source?.AgentIdentity?.Purpose, source?.AgentIdentity?.ContextDescription, source?.TaskSpecification?.TaskDescription, source?.TaskSpecification?.ExpectedOutput && `Expected output: ${source.TaskSpecification.ExpectedOutput}`].filter(Boolean).join("\n\n");

  window.GearAssemblyPlugins["microsoft-agent-framework"] = {
    assemble(input) {
      const ir = input?.gearIR;
      if (!ir?.valid) return { error: (ir?.diagnostics || []).filter((d) => d.severity === "error").map((d) => `# ${d.code}: ${d.message}`).join("\n") || "# Invalid Gear project.", diagnostics: ir?.diagnostics || [] };
      const mappings = input?.mappings || {};
      const used = new Set();
      const diagnostics = [];
      const agentVars = new Map();
      const agentLines = [];
      const manifest = {};
      ir.agents.forEach((item, index) => {
        const variable = unique(item.name, `agent_${index + 1}`, used);
        agentVars.set(item.id, variable);
        const llm = item.source?.LLMConfiguration || {};
        const provider = String(llm.Provider || "openai").toLowerCase();
        if (provider !== "openai") diagnostics.push({ code: "MAF-PROVIDER-ADAPTER", severity: "error", message: `Agent ${item.name} requires a ${provider} client adapter.`, path: item.name });
        const params = llm.ModelParameters || {};
        const options = [["temperature", params.Temperature], ["max_tokens", params.MaxTokens], ["top_p", params.TopP], ["frequency_penalty", params.FrequencyPenalty], ["presence_penalty", params.PresencePenalty], ["seed", params.Seed], ["stop", params.StopSequences]].filter(([, v]) => v !== undefined && v !== null && v !== "");
        const clientArgs = [`model=${lit(llm.Model || "gpt-4.1-mini")}`];
        if (llm.BaseURL) clientArgs.push(`base_url=${lit(llm.BaseURL)}`);
        agentLines.push(`${variable} = Agent(`, `    client=OpenAIChatClient(${clientArgs.join(", ")}),`, `    name=${lit(item.name)},`, `    instructions=${lit(prompt(item.source))},`, ...(options.length ? [`    default_options={${options.map(([k, v]) => `${lit(k)}: ${lit(v)}`).join(", ")}},`] : []), ")", "");
        manifest[item.id] = { variable, model: llm.Model || "gpt-4.1-mini" };
      });

      const nodeExecutors = new Map();
      const executorLines = [
        "class StartExecutor(Executor):",
        "    @handler",
        "    async def forward(self, message: str, ctx: WorkflowContext[str]) -> None:",
        "        await ctx.send_message(message)",
        "",
        "class AgentExecutor(Executor):",
        "    def __init__(self, executor_id: str, agent: Agent, output: bool = False):",
        "        super().__init__(id=executor_id)",
        "        self.agent = agent",
        "        self.output = output",
        "",
        "    @handler",
        "    async def invoke(self, message: str | list[str], ctx: WorkflowContext[str]) -> None:",
        "        value = \"\\n\\n\".join(map(str, message)) if isinstance(message, list) else str(message)",
        "        result = str(await self.agent.run(value))",
        "        if self.output:",
        "            await ctx.yield_output(result)",
        "        else:",
        "            await ctx.send_message(result)",
        "",
        "class ModuleExecutor(Executor):",
        "    def __init__(self, executor_id: str, strategy: str, agents: list[Agent], turns: int = 1, aggregator: Agent | None = None, output: bool = False, stop_condition: str = \"\"):",
        "        super().__init__(id=executor_id)",
        "        self.strategy, self.agents, self.turns = strategy, agents, turns",
        "        self.aggregator, self.output, self.stop_condition = aggregator, output, stop_condition",
        "",
        "    @handler",
        "    async def invoke(self, message: str | list[str], ctx: WorkflowContext[str]) -> None:",
        "        current = \"\\n\\n\".join(map(str, message)) if isinstance(message, list) else str(message)",
        "        if self.strategy == \"parallel\":",
        "            values = [str(value) for value in await asyncio.gather(*(agent.run(current) for agent in self.agents))]",
        "            current = \"\\n\\n\".join(values)",
        "            if self.aggregator:",
        "                current = str(await self.aggregator.run(current))",
        "        else:",
        "            for _ in range(self.turns):",
        "                for agent in self.agents:",
        "                    current = str(await agent.run(current))",
        "        if self.output:",
        "            await ctx.yield_output(current)",
        "        else:",
        "            await ctx.send_message(current)",
        "",
        "start = StartExecutor(id=\"gear_start\")",
      ];
      const sinks = new Set(ir.workflow.nodes.filter((node) => !ir.workflow.edges.some((edge) => edge.from === node.id)).map((node) => node.id));
      ir.workflow.nodes.forEach((node, index) => {
        const variable = unique(`${node.id}_executor`, `node_${index + 1}`, used);
        nodeExecutors.set(node.id, variable);
        if (node.type === "agent") executorLines.push(`${variable} = AgentExecutor(${lit(node.id)}, ${agentVars.get(node.ref)}, output=${sinks.has(node.id) ? "True" : "False"})`);
        else {
          const module = ir.modules.find((item) => item.id === node.ref);
          const agents = (module?.agentRefs || []).map((ref) => agentVars.get(ref)).filter(Boolean);
          const aggregator = agentVars.get(module?.aggregator) || "None";
          executorLines.push(`${variable} = ModuleExecutor(${lit(node.id)}, ${lit(module?.strategy)}, [${agents.join(", ")}], turns=${module?.maxIterations || 1}, aggregator=${aggregator}, output=${sinks.has(node.id) ? "True" : "False"}, stop_condition=${lit(module?.stopCondition || "")})`);
          if (module?.stopCondition) diagnostics.push({ code: "MAF-LOOP-STOP-ADAPTED", severity: "warning", message: `Loop module ${module.name} uses TurnCount as its hard limit.`, path: module.name });
        }
      });
      const incoming = new Map(ir.workflow.nodes.map((node) => [node.id, []]));
      const outgoing = new Map(ir.workflow.nodes.map((node) => [node.id, []]));
      ir.workflow.edges.forEach((edge) => { incoming.get(edge.to)?.push(edge.from); outgoing.get(edge.from)?.push(edge.to); });
      const roots = ir.workflow.nodes.filter((node) => !incoming.get(node.id).length);
      const graphLines = [`builder = WorkflowBuilder(start_executor=start, name=${lit(ir.workflow.name)})`];
      graphLines.push(roots.length > 1 ? `builder.add_fan_out_edges(start, [${roots.map((n) => nodeExecutors.get(n.id)).join(", ")}])` : `builder.add_edge(start, ${nodeExecutors.get(roots[0]?.id)})`);
      ir.workflow.nodes.forEach((node) => {
        const ins = incoming.get(node.id); const outs = outgoing.get(node.id);
        if (ins.length > 1) graphLines.push(`builder.add_fan_in_edges([${ins.map((id) => nodeExecutors.get(id)).join(", ")}], ${nodeExecutors.get(node.id)})`);
        if (outs.length > 1) graphLines.push(`builder.add_fan_out_edges(${nodeExecutors.get(node.id)}, [${outs.map((id) => nodeExecutors.get(id)).join(", ")}])`);
        if (outs.length === 1 && incoming.get(outs[0]).length === 1) graphLines.push(`builder.add_edge(${nodeExecutors.get(node.id)}, ${nodeExecutors.get(outs[0])})`);
      });
      graphLines.push("workflow = builder.build()", "", "async def main() -> None:", "    prompt = os.environ.get(\"GEAR_INPUT\", \"Run the configured Gear workflow.\")", "    events = await workflow.run(prompt)", "    outputs = events.get_outputs()", "    print(outputs[-1] if outputs else \"Workflow completed without output.\")", "", "if __name__ == \"__main__\":", "    asyncio.run(main())");
      const imports = ["import asyncio", "import os", "from agent_framework import Agent, Executor, WorkflowBuilder, WorkflowContext, handler", "from agent_framework.openai import OpenAIChatClient", "from dotenv import load_dotenv", "", "load_dotenv()"];
      const orchestration = renderTemplate(getTemplate("microsoft-agent-framework") || "{{imports}}\n\n{{agents_code}}\n\n{{executors_code}}\n\n{{workflow_code}}", { imports: imports.join("\n"), agents_code: agentLines.join("\n").trim(), executors_code: executorLines.join("\n"), workflow_code: graphLines.join("\n") });
      const entries = [...(mappings["microsoft-agent-frameworkAgent"] || []), ...(mappings["microsoft-agent-frameworkModule"] || []), ...(mappings["microsoft-agent-frameworkMulti"] || [])];
      const consumedPaths = ["AgentIdentity.Name", "AgentIdentity.Purpose", "AgentIdentity.ContextDescription", "LLMConfiguration.Provider", "LLMConfiguration.Model", "LLMConfiguration.BaseURL", "LLMConfiguration.ModelParameters", "TaskSpecification.TaskName", "TaskSpecification.TaskDescription", "TaskSpecification.ExpectedOutput", "ModuleName", "Strategy.Parallel.ParallelAgents", "Strategy.Parallel.Aggregator", "Strategy.Loop.LoopAgents", "Strategy.Loop.TurnCount", "Strategy.Loop.StopCondition", "WorkflowName", "Items.Agents", "Items.Modules", "Edges.From", "Edges.To"];
      return { outputs: { agents: manifest, orchestration, report: createConversionReport({ frameworkId: "microsoft-agent-framework", gearIR: ir, mappingEntries: entries, consumedPaths, diagnostics }) } };
    },
  };
})(window);
