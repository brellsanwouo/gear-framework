(function (window) {
  if (!window) return;
  window.GearAssemblyPlugins = window.GearAssemblyPlugins || {};
  const utils = window.GearAssemblyEngine?.utils;
  if (!utils) return;

  const { toPythonLiteral, toPythonName, renderTemplate, getTemplate, createConversionReport } = utils;

  const meaningful = (value) => value !== undefined && value !== null && value !== "";
  const uniqueName = (value, fallback, used) => {
    let candidate = toPythonName(value, fallback);
    let suffix = 2;
    while (used.has(candidate)) candidate = `${toPythonName(value, fallback)}_${suffix++}`;
    used.add(candidate);
    return candidate;
  };
  const promptFor = (agent) => {
    const identity = agent?.AgentIdentity || {};
    const task = agent?.TaskSpecification || {};
    return [
      identity.Purpose ? `Purpose: ${identity.Purpose}` : "",
      identity.ContextDescription ? `Context: ${identity.ContextDescription}` : "",
      task.TaskDescription ? `Task: ${task.TaskDescription}` : "",
      task.ExpectedOutput ? `Expected output: ${task.ExpectedOutput}` : "",
    ].filter(Boolean).join("\n\n");
  };
  const modelArguments = (agent) => {
    const llm = agent?.LLMConfiguration || {};
    const params = llm.ModelParameters || {};
    const values = [
      ["model", llm.Model || "gpt-4.1-mini"],
      ["model_provider", llm.Provider || "openai"],
      ["base_url", llm.BaseURL],
      ["timeout", llm.Timeout],
      ["max_retries", llm.MaxRetries],
      ["temperature", params.Temperature],
      ["max_tokens", params.MaxTokens],
      ["top_p", params.TopP],
      ["stop", params.StopSequences],
      ["frequency_penalty", params.FrequencyPenalty],
      ["presence_penalty", params.PresencePenalty],
      ["seed", params.Seed],
    ].filter(([, value]) => meaningful(value));
    return values.map(([key, value]) => `    ${key}=${toPythonLiteral(value)},`);
  };

  window.GearAssemblyPlugins.langgraph = {
    assemble(input) {
      const gearIR = input?.gearIR;
      if (!gearIR?.valid) {
        const diagnostics = gearIR?.diagnostics || [];
        return {
          error: diagnostics.filter((item) => item.severity === "error")
            .map((item) => `# ${item.code}: ${item.message}`).join("\n") || "# Invalid Gear project.",
          diagnostics,
        };
      }

      const mappings = input?.mappings || {};
      const agentMapping = Array.isArray(mappings.langgraphAgent) ? mappings.langgraphAgent : [];
      const moduleMapping = Array.isArray(mappings.langgraphModule) ? mappings.langgraphModule : [];
      const workflowMapping = Array.isArray(mappings.langgraphMulti) ? mappings.langgraphMulti : [];
      const used = new Set();
      const agentFunctions = new Map();
      const agentLines = [];
      const agentManifest = {};

      gearIR.agents.forEach((item, index) => {
        const variable = uniqueName(item.name, `agent_${index + 1}`, used);
        const modelVariable = `${variable}_model`;
        const functionName = `run_${variable}`;
        agentFunctions.set(item.id, functionName);
        agentManifest[item.id] = {
          node: functionName,
          model: item.source?.LLMConfiguration?.Model || "gpt-4.1-mini",
          provider: item.source?.LLMConfiguration?.Provider || "openai",
        };
        agentLines.push(
          `${modelVariable} = init_chat_model(`,
          ...modelArguments(item.source),
          ")",
          "",
          `def ${functionName}(state: WorkflowState) -> dict:`,
          `    prompt = ${toPythonLiteral(promptFor(item.source))}`,
          `    messages = [SystemMessage(content=prompt), *state.get("messages", [])]`,
          `    response = _gear_trace_call(${toPythonLiteral(`agent.${item.name}`)}, messages, lambda: ${modelVariable}.invoke(messages), {"gear.agent": ${toPythonLiteral(item.name)}, "gen_ai.request.model": ${toPythonLiteral(item.source?.LLMConfiguration?.Model || "gpt-4.1-mini")}})`,
          `    return {"messages": [response]}`,
          "",
        );
      });

      const moduleFunctions = new Map();
      const moduleLines = [];
      const connectorDiagnostics = [];
      gearIR.modules.forEach((module, index) => {
        const variable = uniqueName(module.name, `module_${index + 1}`, used);
        const functionName = `run_${variable}`;
        moduleFunctions.set(module.id, functionName);
        const participants = module.agentRefs.map((ref) => agentFunctions.get(ref)).filter(Boolean);
        if (module.strategy === "parallel") {
          moduleLines.push(
            `def ${functionName}(state: WorkflowState) -> dict:`,
            `    workers = [${participants.join(", ")}]`,
            "    with ThreadPoolExecutor(max_workers=max(1, len(workers))) as executor:",
            "        results = list(executor.map(lambda worker: worker(state), workers))",
            "    messages = [message for result in results for message in result.get(\"messages\", [])]",
          );
          const aggregator = agentFunctions.get(module.aggregator);
          if (aggregator) {
            moduleLines.push(
              `    aggregated = ${aggregator}({"messages": [*state.get("messages", []), *messages]})`,
              "    messages.extend(aggregated.get(\"messages\", []))",
            );
          }
          moduleLines.push("    return {\"messages\": messages}", "");
        } else if (module.strategy === "loop") {
          const iterations = Number.isInteger(module.maxIterations) && module.maxIterations > 0 ? module.maxIterations : 1;
          moduleLines.push(
            `def ${functionName}(state: WorkflowState) -> dict:`,
            "    current_messages = list(state.get(\"messages\", []))",
            "    produced = []",
            `    stop_condition = ${toPythonLiteral(module.stopCondition || "")}`,
            `    for _ in range(${iterations}):`,
            `        for worker in [${participants.join(", ")}]:`,
            "            result = worker({\"messages\": current_messages})",
            "            new_messages = result.get(\"messages\", [])",
            "            produced.extend(new_messages)",
            "            current_messages.extend(new_messages)",
            "    return {\"messages\": produced}",
            "",
          );
          if (module.stopCondition) {
            connectorDiagnostics.push({
              code: "LANGGRAPH-LOOP-STOP-ADAPTED",
              severity: "warning",
              message: `Loop module ${module.name} uses TurnCount as its hard limit; its natural-language stop condition is retained as metadata.`,
              path: module.name,
            });
          }
        }
      });

      const nodeFunction = (node) => node.type === "module"
        ? moduleFunctions.get(node.ref)
        : agentFunctions.get(node.ref);
      const graphLines = ["builder = StateGraph(WorkflowState)"];
      gearIR.workflow.nodes.forEach((node) => {
        graphLines.push(`builder.add_node(${toPythonLiteral(node.id)}, ${nodeFunction(node)})`);
      });
      const incoming = new Map(gearIR.workflow.nodes.map((node) => [node.id, []]));
      const outgoing = new Map(gearIR.workflow.nodes.map((node) => [node.id, []]));
      gearIR.workflow.edges.forEach((edge) => {
        incoming.get(edge.to)?.push(edge.from);
        outgoing.get(edge.from)?.push(edge.to);
      });
      const roots = gearIR.workflow.nodes.filter((node) => !incoming.get(node.id)?.length);
      roots.forEach((node) => graphLines.push(`builder.add_edge(START, ${toPythonLiteral(node.id)})`));
      gearIR.workflow.nodes.forEach((node) => {
        const predecessors = incoming.get(node.id) || [];
        if (predecessors.length === 1) {
          graphLines.push(`builder.add_edge(${toPythonLiteral(predecessors[0])}, ${toPythonLiteral(node.id)})`);
        } else if (predecessors.length > 1) {
          graphLines.push(`builder.add_edge(${toPythonLiteral(predecessors)}, ${toPythonLiteral(node.id)})`);
        }
      });
      gearIR.workflow.nodes.filter((node) => !outgoing.get(node.id)?.length)
        .forEach((node) => graphLines.push(`builder.add_edge(${toPythonLiteral(node.id)}, END)`));
      if (gearIR.workflow.memory) {
        graphLines.push("checkpointer = InMemorySaver()", "workflow = builder.compile(checkpointer=checkpointer)");
      } else {
        graphLines.push("workflow = builder.compile()");
      }

      const imports = [
        "import os",
        "from concurrent.futures import ThreadPoolExecutor",
        "from typing import Annotated, TypedDict",
        "from langchain.chat_models import init_chat_model",
        "from langchain_core.messages import AnyMessage, HumanMessage, SystemMessage",
        "from langgraph.checkpoint.memory import InMemorySaver",
        "from langgraph.graph import END, START, StateGraph",
        "from langgraph.graph.message import add_messages",
        "from dotenv import load_dotenv",
        "",
        "load_dotenv()",
        "",
        "class WorkflowState(TypedDict):",
        "    messages: Annotated[list[AnyMessage], add_messages]",
      ];
      const runLines = [
        "if __name__ == \"__main__\":",
        "    user_input = os.environ.get(\"GEAR_INPUT\", \"Run the configured Gear workflow.\")",
        ...(gearIR.workflow.memory
          ? ["    result = workflow.invoke({\"messages\": [HumanMessage(content=user_input)]}, {\"configurable\": {\"thread_id\": \"gear-local\"}})"]
          : ["    result = workflow.invoke({\"messages\": [HumanMessage(content=user_input)]})"]),
        "    print(result[\"messages\"][-1].content if result.get(\"messages\") else result)",
      ];
      const template = getTemplate("langgraph") || "{{imports}}\n\n{{agents_code}}\n\n{{modules_code}}\n\n{{graph_code}}\n\n{{run_code}}";
      const orchestration = renderTemplate(template, {
        imports: imports.join("\n"),
        agents_code: agentLines.join("\n").trim(),
        modules_code: moduleLines.join("\n").trim(),
        graph_code: graphLines.join("\n"),
        run_code: runLines.join("\n"),
      });
      const consumedPaths = [
        "AgentIdentity.Name", "AgentIdentity.Purpose", "AgentIdentity.ContextDescription",
        "LLMConfiguration.Provider", "LLMConfiguration.Model", "LLMConfiguration.BaseURL",
        "LLMConfiguration.Timeout", "LLMConfiguration.MaxRetries",
        "LLMConfiguration.ModelParameters.Temperature", "LLMConfiguration.ModelParameters.MaxTokens",
        "LLMConfiguration.ModelParameters.TopP", "LLMConfiguration.ModelParameters.StopSequences",
        "LLMConfiguration.ModelParameters.FrequencyPenalty", "LLMConfiguration.ModelParameters.PresencePenalty",
        "LLMConfiguration.ModelParameters.Seed", "TaskSpecification.TaskName",
        "TaskSpecification.TaskDescription", "TaskSpecification.ExpectedOutput", "Reasoning", "Memory",
        "ModuleName", "Strategy.Parallel.ParallelAgents", "Strategy.Parallel.Aggregator",
        "Strategy.Loop.LoopAgents", "Strategy.Loop.TurnCount", "Strategy.Loop.StopCondition",
        "WorkflowName", "Items.Agents", "Items.Modules", "Edges.From", "Edges.To",
      ];
      const report = createConversionReport({
        frameworkId: "langgraph",
        gearIR,
        mappingEntries: [...agentMapping, ...moduleMapping, ...workflowMapping],
        consumedPaths,
        diagnostics: connectorDiagnostics,
      });
      return { outputs: { agents: agentManifest, orchestration, report } };
    },
  };
})(window);
