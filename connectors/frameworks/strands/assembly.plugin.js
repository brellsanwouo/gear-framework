(function (window) {
  if (!window) return;
  window.GearAssemblyPlugins = window.GearAssemblyPlugins || {};
  const u = window.GearAssemblyEngine?.utils;
  if (!u) return;
  const { toPythonLiteral: lit, toPythonName, renderTemplate, getTemplate, createConversionReport } = u;
  const unique = (value, fallback, used) => { let name = toPythonName(value, fallback); let n = 2; while (used.has(name)) name = `${toPythonName(value, fallback)}_${n++}`; used.add(name); return name; };
  const systemPrompt = (source) => [source?.AgentIdentity?.Purpose, source?.AgentIdentity?.ContextDescription, source?.TaskSpecification?.TaskDescription, source?.TaskSpecification?.ExpectedOutput && `Expected output: ${source.TaskSpecification.ExpectedOutput}`].filter(Boolean).join("\n\n");

  window.GearAssemblyPlugins.strands = {
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
        if (provider !== "openai") diagnostics.push({ code: "STRANDS-PROVIDER-ADAPTER", severity: "error", message: `Agent ${item.name} requires a Strands ${provider} model adapter.`, path: item.name });
        const params = llm.ModelParameters || {};
        const modelParams = [["temperature", params.Temperature], ["max_tokens", params.MaxTokens], ["top_p", params.TopP], ["frequency_penalty", params.FrequencyPenalty], ["presence_penalty", params.PresencePenalty], ["seed", params.Seed], ["stop", params.StopSequences]].filter(([, v]) => v !== undefined && v !== null && v !== "");
        const clientArgs = [["api_key", "os.environ.get(\"OPENAI_API_KEY\")", true], ["base_url", llm.BaseURL], ["timeout", llm.Timeout], ["max_retries", llm.MaxRetries]].filter(([, v]) => v !== undefined && v !== null && v !== "");
        const clientText = `{${clientArgs.map(([k, v, raw]) => `${lit(k)}: ${raw ? v : lit(v)}`).join(", ")}}`;
        const paramsText = `{${modelParams.map(([k, v]) => `${lit(k)}: ${lit(v)}`).join(", ")}}`;
        agentLines.push(`${variable}_model = OpenAIModel(client_args=${clientText}, model_id=${lit(llm.Model || "gpt-4.1-mini")}, params=${paramsText})`, `${variable} = Agent(name=${lit(item.name)}, description=${lit(item.source?.TaskSpecification?.TaskName || item.name)}, system_prompt=${lit(systemPrompt(item.source))}, model=${variable}_model)`, "");
        manifest[item.id] = { variable, model: llm.Model || "gpt-4.1-mini" };
      });

      const moduleLines = [
        "async def _run_agent(agent: Agent, prompt: str, **kwargs):",
        "    name = getattr(agent, \"name\", agent.__class__.__name__)",
        "    return await _gear_trace_async_call(f\"agent.{name}\", prompt, lambda: agent.invoke_async(prompt, **kwargs), {\"gear.agent\": name})",
        "",
        "class LoopAgent:",
        "    def __init__(self, name: str, agents: list[Agent], turns: int, stop_condition: str = \"\"):",
        "        self.name, self.id = name, name",
        "        self.agents, self.turns, self.stop_condition = agents, turns, stop_condition",
        "",
        "    async def invoke_async(self, prompt=None, **kwargs):",
        "        current, result = str(prompt or \"\"), None",
        "        for _ in range(self.turns):",
        "            for agent in self.agents:",
        "                result = await _run_agent(agent, current, **kwargs)",
        "                current = str(result)",
        "        return result",
        "",
        "    def __call__(self, prompt=None, **kwargs):",
        "        return asyncio.run(self.invoke_async(prompt, **kwargs))",
        "",
        "    async def stream_async(self, prompt=None, **kwargs):",
        "        yield await self.invoke_async(prompt, **kwargs)",
      ];
      const nodeEntries = new Map();
      const nodeExits = new Map();
      const graphNodes = [];
      const internalEdges = [];
      ir.workflow.nodes.forEach((node, index) => {
        if (node.type === "agent") {
          const id = node.id; graphNodes.push([agentVars.get(node.ref), id]); nodeEntries.set(node.id, [id]); nodeExits.set(node.id, [id]); return;
        }
        const module = ir.modules.find((item) => item.id === node.ref);
        if (module?.strategy === "loop") {
          const variable = unique(`${node.id}_loop`, `loop_${index + 1}`, used);
          const agents = module.agentRefs.map((ref) => agentVars.get(ref)).filter(Boolean);
          moduleLines.push("", `${variable} = LoopAgent(${lit(node.id)}, [${agents.join(", ")}], ${module.maxIterations || 1}, ${lit(module.stopCondition || "")})`);
          graphNodes.push([variable, node.id]); nodeEntries.set(node.id, [node.id]); nodeExits.set(node.id, [node.id]);
          if (module.stopCondition) diagnostics.push({ code: "STRANDS-LOOP-STOP-ADAPTED", severity: "warning", message: `Loop module ${module.name} uses TurnCount as its hard limit.`, path: module.name });
          return;
        }
        const participantIds = module.agentRefs.map((ref, i) => `${node.id}__${i + 1}`);
        module.agentRefs.forEach((ref, i) => graphNodes.push([agentVars.get(ref), participantIds[i]]));
        nodeEntries.set(node.id, participantIds);
        if (module.aggregator && agentVars.get(module.aggregator)) {
          const aggregateId = `${node.id}__aggregate`;
          graphNodes.push([agentVars.get(module.aggregator), aggregateId]);
          participantIds.forEach((id) => internalEdges.push([id, aggregateId, participantIds]));
          nodeExits.set(node.id, [aggregateId]);
        } else nodeExits.set(node.id, participantIds);
      });

      const expandedEdges = [...internalEdges];
      const incomingByTarget = new Map();
      ir.workflow.edges.forEach((edge) => {
        const sources = nodeExits.get(edge.from) || []; const targets = nodeEntries.get(edge.to) || [];
        targets.forEach((target) => {
          const incoming = incomingByTarget.get(target) || [];
          incoming.push(...sources);
          incomingByTarget.set(target, incoming);
        });
      });
      incomingByTarget.forEach((sources, target) => {
        const required = [...new Set(sources)];
        required.forEach((source) => expandedEdges.push([source, target, required]));
      });
      const graphLines = ["builder = GraphBuilder()", `builder.set_graph_id(${lit(ir.workflow.name)})`];
      graphNodes.forEach(([variable, id]) => graphLines.push(`builder.add_node(${variable}, ${lit(id)})`));
      expandedEdges.forEach(([source, target, required]) => graphLines.push(required.length > 1 ? `builder.add_edge(${lit(source)}, ${lit(target)}, condition=all_dependencies_complete(${lit(required)}))` : `builder.add_edge(${lit(source)}, ${lit(target)})`));
      graphLines.push("builder.set_execution_timeout(600)", "graph = builder.build()", "", "if __name__ == \"__main__\":", "    task = os.environ.get(\"GEAR_INPUT\", \"\")", "    result = graph(task)", "    print(result)");
      const imports = ["import asyncio", "import os", "from strands import Agent", "from strands.models.openai import OpenAIModel", "from strands.multiagent import GraphBuilder", "from strands.multiagent.base import Status", "from strands.multiagent.graph import GraphState", "from dotenv import load_dotenv", "", "load_dotenv()", "", "def all_dependencies_complete(required_nodes: list[str]):", "    def check(state: GraphState) -> bool:", "        return all(node_id in state.results and state.results[node_id].status == Status.COMPLETED for node_id in required_nodes)", "    return check"];
      const orchestration = renderTemplate(getTemplate("strands") || "{{imports}}\n\n{{agents_code}}\n\n{{modules_code}}\n\n{{graph_code}}", { imports: imports.join("\n"), agents_code: agentLines.join("\n").trim(), modules_code: moduleLines.join("\n"), graph_code: graphLines.join("\n") });
      const entries = [...(mappings.strandsAgent || []), ...(mappings.strandsModule || []), ...(mappings.strandsMulti || [])];
      const consumedPaths = ["AgentIdentity.Name", "AgentIdentity.Purpose", "AgentIdentity.ContextDescription", "LLMConfiguration.Provider", "LLMConfiguration.Model", "LLMConfiguration.BaseURL", "LLMConfiguration.Timeout", "LLMConfiguration.MaxRetries", "LLMConfiguration.ModelParameters", "TaskSpecification.TaskName", "TaskSpecification.TaskDescription", "TaskSpecification.ExpectedOutput", "ModuleName", "Strategy.Parallel.ParallelAgents", "Strategy.Parallel.Aggregator", "Strategy.Loop.LoopAgents", "Strategy.Loop.TurnCount", "Strategy.Loop.StopCondition", "WorkflowName", "Items.Agents", "Items.Modules", "Edges.From", "Edges.To"];
      return { outputs: { agents: manifest, orchestration, report: createConversionReport({ frameworkId: "strands", gearIR: ir, mappingEntries: entries, consumedPaths, diagnostics }) } };
    },
  };
})(window);
