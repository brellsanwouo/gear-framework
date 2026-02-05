(function (window) {
  if (!window) return;
  // Google ADK assembler plugin: builds ADK YAML + runnable workflow script.
  window.GearAssemblyPlugins = window.GearAssemblyPlugins || {};
  const utils = window.GearAssemblyEngine?.utils;
  if (!utils) return;

  const {
    applyMapping,
    getMappedValue,
    toCrewaiModel,
    ensureUniqueKey,
    toPythonLiteral,
    toPythonName,
    parseNameList,
    parseNumberValue,
    renderTemplate,
    getTemplate,
  } = utils;

  const setIfMeaningful = (obj, key, value) => {
    if (!obj || !key) return;
    if (value === undefined || value === null) return;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return;
      obj[key] = trimmed;
      return;
    }
    if (typeof value === "boolean") {
      if (value) obj[key] = true;
      return;
    }
    obj[key] = value;
  };

  const buildAdkAgentConfigFromGear = (gearAgent, mapped) => {
    const baseAgent = { AgentType: "LlmAgent" };
    const llmAgentConfig = {};
    const generateContentConfig = {};
    const configurations = {};
    const dataStructure = {};
    const planner = {};
    const builtInPlanner = {};
    const thinkingConfig = {};

    setIfMeaningful(baseAgent, "Name", getMappedValue(mapped, "BaseAgent.Name"));
    const descriptionParts = [gearAgent.AgentIdentity?.Purpose, gearAgent.AgentIdentity?.ContextDescription]
      .map((value) => (value ?? "").toString().trim())
      .filter(Boolean);
    if (descriptionParts.length) {
      setIfMeaningful(baseAgent, "Description", descriptionParts.join("\n"));
    }

    const modelValue = toCrewaiModel(
      gearAgent.LLMConfiguration?.Provider,
      getMappedValue(mapped, "LLMAgentConfig.Model"),
    );
    setIfMeaningful(llmAgentConfig, "Model", modelValue);
    setIfMeaningful(
      generateContentConfig,
      "Temperature",
      getMappedValue(mapped, "LLMAgentConfig.GenerateContentConfig.Temperature"),
    );
    setIfMeaningful(
      generateContentConfig,
      "MaxOutputTokens",
      getMappedValue(mapped, "LLMAgentConfig.GenerateContentConfig.MaxOutputTokens"),
    );
    setIfMeaningful(generateContentConfig, "TopP", getMappedValue(mapped, "LLMAgentConfig.GenerateContentConfig.TopP"));
    setIfMeaningful(generateContentConfig, "TopK", getMappedValue(mapped, "LLMAgentConfig.GenerateContentConfig.TopK"));
    if (Object.keys(generateContentConfig).length) {
      llmAgentConfig.GenerateContentConfig = generateContentConfig;
    }

    setIfMeaningful(configurations, "Instruction", getMappedValue(mapped, "Configurations.Instruction"));
    setIfMeaningful(dataStructure, "OutputKey", getMappedValue(mapped, "Configurations.DataStructure.OutputKey"));
    if (gearAgent.TaskSpecification?.ExpectedOutput) {
      dataStructure.OutputSchema = {
        description: gearAgent.TaskSpecification.ExpectedOutput,
        type: "string",
      };
    }
    if (Object.keys(dataStructure).length) {
      configurations.DataStructure = dataStructure;
    }

    if (getMappedValue(mapped, "Configurations.Planner.BuiltInPlanner.ThinkingConfig.IncludeThoughts") === true) {
      thinkingConfig.IncludeThoughts = true;
    }
    if (Object.keys(thinkingConfig).length) {
      builtInPlanner.ThinkingConfig = thinkingConfig;
      planner.BuiltInPlanner = builtInPlanner;
      configurations.Planner = planner;
    }

    if (getMappedValue(mapped, "Configurations.CodeExecutor") === true) {
      configurations.CodeExecutor = true;
    }

    const result = { BaseAgent: baseAgent };
    if (Object.keys(llmAgentConfig).length) {
      result.LLMAgentConfig = llmAgentConfig;
    }
    if (Object.keys(configurations).length) {
      result.Configurations = configurations;
    }
    return result;
  };

  const buildModuleConfigs = (moduleStates, mappingEntries) => {
    if (!mappingEntries) {
      return { items: [], error: "# Mapping ADK module indisponible. Vérifie connectors/frameworks/adk/module.mapping.yml" };
    }
    const items = (moduleStates || [])
      .map((moduleData, index) => {
        const mappedModule = applyMapping(moduleData, mappingEntries);
        const name = getMappedValue(mappedModule, "Runtime.Module.Name") || moduleData.ModuleName || `Module ${index + 1}`;
        const strategy = getMappedValue(mappedModule, "Runtime.Module.ADKAgentType.ParallelAgent")
          ? "parallel"
          : getMappedValue(mappedModule, "Runtime.Module.ADKAgentType.LoopAgent")
            ? "loop"
            : null;
        if (!strategy) {
          return null;
        }
        const parallelAgents = parseNameList(getMappedValue(mappedModule, "Runtime.Module.Parallel.SubAgents"));
        const aggregator = String(getMappedValue(mappedModule, "Runtime.Module.Parallel.Aggregator") || "").trim();
        const loopAgents = parseNameList(getMappedValue(mappedModule, "Runtime.Module.Loop.SubAgents"));
        const turnCount = parseNumberValue(getMappedValue(mappedModule, "Runtime.Module.Loop.MaxIterations"));
        if (strategy === "parallel" && !aggregator) {
          return { error: `# Module parallel sans aggregator: ${name}` };
        }
        return {
          name,
          strategy,
          parallelAgents,
          aggregator,
          loopAgents,
          turnCount,
        };
      })
      .filter(Boolean);
    const errorItem = items.find((item) => item?.error);
    if (errorItem?.error) {
      return { items: [], error: errorItem.error };
    }
    return { items };
  };

  const buildAdkWorkflowCode = (gearAgents, moduleConfigs, workflowYaml, workflowItems, mappings) => {
    if (!Array.isArray(mappings?.adkMulti) || !mappings.adkMulti.length) {
      return "# Mapping ADK workflow indisponible. Vérifie connectors/frameworks/adk/multiagent.mapping.yml";
    }
    if (!gearAgents.length) {
      return "# Aucun agent ADK defini.";
    }
    const mappedWorkflow = applyMapping(workflowYaml || {}, mappings.adkMulti);
    const workflowMemoryEnabled = getMappedValue(mappedWorkflow, "Runtime.Memory.WorkflowEnabled") === true;
    const memoryServiceClass = getMappedValue(mappedWorkflow, "Runtime.Memory.MemoryServiceClass");
    const memoryToolClass = getMappedValue(mappedWorkflow, "Runtime.Memory.AgentToolClass");

    const agentMappedList = gearAgents.map((agent) =>
      applyMapping(agent, Array.isArray(mappings.adkAgent) ? mappings.adkAgent : []),
    );
    const agentMemoryMap = agentMappedList.map(
      (mappedAgent) => getMappedValue(mappedAgent, "Runtime.Memory.AgentEnabled") === true,
    );
    const anyMemoryEnabled = workflowMemoryEnabled || agentMemoryMap.some(Boolean);

    const importLines = [
      "import asyncio",
      "from google.adk.agents import Agent, SequentialAgent, ParallelAgent, LoopAgent",
      "from google.adk.models.lite_llm import LiteLlm",
      "from google.adk.runners import Runner",
      "from google.adk.sessions import InMemorySessionService",
    ];
    if (anyMemoryEnabled) {
      if (!memoryServiceClass || !memoryToolClass) {
        return "# Mapping ADK invalide: Runtime.Memory.MemoryServiceClass et Runtime.Memory.AgentToolClass sont requis.";
      }
      importLines.push(`from google.adk.memory import ${memoryServiceClass}`);
      importLines.push(`from google.adk.tools.preload_memory_tool import ${memoryToolClass}`);
    }
    importLines.push("from dotenv import load_dotenv", "", "load_dotenv()", "");

    const usedNames = new Set();
    const agentVarMap = new Map();
    const agentNameMap = new Map();
    const moduleVarMap = new Map();
    const moduleSequenceVarMap = new Map();

    const makeUniqueVar = (base, fallback) => {
      let candidate = toPythonName(base, fallback);
      let suffix = 2;
      while (usedNames.has(candidate)) {
        candidate = `${candidate}_${suffix}`;
        suffix += 1;
      }
      usedNames.add(candidate);
      return candidate;
    };

    const agentLines = [];
    gearAgents.forEach((gearAgent, index) => {
      const name = gearAgent.AgentIdentity?.Name || `Agent ${index + 1}`;
      const agentVar = makeUniqueVar(name, `agent_${index + 1}`);
      agentVarMap.set(name, agentVar);
      agentNameMap.set(name, name);
      const modelValue =
        toCrewaiModel(
          gearAgent.LLMConfiguration?.Provider,
          gearAgent.LLMConfiguration?.Model,
        ) || "gemini-2.5-flash-lite";
      const instruction = gearAgent.TaskSpecification?.TaskDescription || "";
      const outputKey = gearAgent.TaskSpecification?.TaskName || "";
      const memoryEnabled = workflowMemoryEnabled || agentMemoryMap[index] === true;

      const args = [
        `  name=${toPythonLiteral(name)},`,
        `  model=LiteLlm(model=${toPythonLiteral(modelValue)}),`,
      ];
      if (instruction) {
        args.push(`  instruction=${toPythonLiteral(instruction)},`);
      }
      if (outputKey) {
        args.push(`  output_key=${toPythonLiteral(outputKey)},`);
      }
      if (anyMemoryEnabled && memoryEnabled) {
        args.push(`  tools=[${memoryToolClass}()],`);
      }
      agentLines.push(`${agentVar} = Agent(`, ...args, `)`, "");
    });

    const moduleLines = [];
    moduleConfigs.forEach((moduleConfig, index) => {
      const moduleVar = makeUniqueVar(moduleConfig.name, `module_${index + 1}`);
      moduleVarMap.set(moduleConfig.name, moduleVar);
      if (moduleConfig.strategy === "parallel") {
        const subAgents = moduleConfig.parallelAgents
          .map((name) => agentVarMap.get(name))
          .filter(Boolean);
        moduleLines.push(
          `${moduleVar} = ParallelAgent(`,
          `  name=${toPythonLiteral(moduleConfig.name)},`,
          `  sub_agents=[${subAgents.join(", ")}],`,
          `)`,
          "",
        );
        if (moduleConfig.aggregator) {
          const aggregatorVar = agentVarMap.get(moduleConfig.aggregator);
          if (aggregatorVar) {
            const pipelineVar = makeUniqueVar(`${moduleConfig.name}_pipeline`, `module_pipeline_${index + 1}`);
            moduleSequenceVarMap.set(moduleConfig.name, pipelineVar);
            moduleLines.push(
              `${pipelineVar} = SequentialAgent(`,
              `  name=${toPythonLiteral(`${moduleConfig.name}Pipeline`)},`,
              `  sub_agents=[${moduleVar}, ${aggregatorVar}],`,
              `)`,
              "",
            );
          }
        }
        return;
      }
      if (moduleConfig.strategy === "loop") {
        const subAgents = moduleConfig.loopAgents
          .map((name) => agentVarMap.get(name))
          .filter(Boolean);
        const args = [
          `  name=${toPythonLiteral(moduleConfig.name)},`,
          `  sub_agents=[${subAgents.join(", ")}],`,
        ];
        if (moduleConfig.turnCount !== null) {
          args.push(`  max_iterations=${moduleConfig.turnCount},`);
        }
        moduleLines.push(`${moduleVar} = LoopAgent(`, ...args, `)`, "");
        moduleSequenceVarMap.set(moduleConfig.name, moduleVar);
      }
    });

    const orderedAgents =
      Array.isArray(workflowItems) && workflowItems.length
        ? workflowItems
            .filter((item) => item.type === "agent")
            .map((item) => item.label || item.id)
            .filter(Boolean)
        : Array.from(agentVarMap.keys());

    const sequenceItems = Array.isArray(workflowItems) ? workflowItems : [];
    const orderedVars =
      sequenceItems.length > 0
        ? sequenceItems
            .map((item) => {
              const key = item.label || item.id;
              if (item.type === "module") {
                return moduleSequenceVarMap.get(key) || moduleVarMap.get(key) || null;
              }
              return agentVarMap.get(key) || null;
            })
            .filter(Boolean)
        : orderedAgents.length
          ? orderedAgents.map((name) => agentVarMap.get(name)).filter(Boolean)
          : Array.from(agentVarMap.values());

    const runnerLines = [];
    if (anyMemoryEnabled) {
      runnerLines.push(`memory_service = ${memoryServiceClass}()`, "");
    }

    const rootName = getMappedValue(mappedWorkflow, "SystemDefinition.RootAgent") || "RootWorkflow";
    const appName = getMappedValue(mappedWorkflow, "Infrastructure.Runner.Configuration.AppName") || "gear-framework";

    const rootLines = [
      "root_agent = SequentialAgent(",
      `  name=${toPythonLiteral(String(rootName))},`,
      `  sub_agents=[${orderedVars.join(", ")}],`,
      ")",
      "",
      "runner = Runner(",
      "  agent=root_agent,",
      "  session_service=InMemorySessionService(),",
      ...(anyMemoryEnabled ? ["  memory_service=memory_service,"] : []),
      `  app_name=${toPythonLiteral(String(appName))},`,
      ")",
      "async def _run():",
      '    return await runner.run_debug(\"{}\")',
      "result = asyncio.run(_run())",
      "print(result)",
    ];

    const template = getTemplate("adk") || "{{imports}}\n\n{{agents_code}}\n\n{{modules_code}}\n\n{{runner_block}}\n\n{{post_run}}";
    return renderTemplate(template, {
      imports: importLines.join("\n"),
      agents_code: agentLines.join("\n").trim(),
      modules_code: moduleLines.join("\n").trim(),
      runner_block: [...runnerLines, ...rootLines].join("\n"),
      post_run: "",
    });
  };

  window.GearAssemblyPlugins.adk = {
    assemble(input) {
      const mappings = input?.mappings || {};
      const agentMapping = Array.isArray(mappings.adkAgent) ? mappings.adkAgent : null;
      if (!agentMapping) {
        return {
          error: "# Mapping ADK indisponible. Vérifie connectors/frameworks/adk/agent.mapping.yml",
        };
      }
      const gearAgents = Array.isArray(input?.gearAgents) ? input.gearAgents : [];
      const adkAgents = {};
      const usedKeys = new Set();
      gearAgents.forEach((gearAgent, index) => {
        const mapped = applyMapping(gearAgent, agentMapping);
        const key = ensureUniqueKey(gearAgent.AgentIdentity?.Name, "agent", index + 1, usedKeys);
        adkAgents[key] = buildAdkAgentConfigFromGear(gearAgent, mapped);
      });

      const moduleMapping = Array.isArray(mappings.adkModule) ? mappings.adkModule : null;
      const moduleConfigResult = buildModuleConfigs(input?.gearModules || [], moduleMapping);
      if (moduleConfigResult.error) {
        return { error: moduleConfigResult.error };
      }
      const moduleConfigs = moduleConfigResult.items;
      moduleConfigs.forEach((moduleConfig, index) => {
        const moduleKey = ensureUniqueKey(moduleConfig.name, "module", index + 1, usedKeys);
        const subAgents =
          moduleConfig.strategy === "parallel"
            ? moduleConfig.parallelAgents
            : moduleConfig.loopAgents;
        adkAgents[moduleKey] = {
          BaseAgent: {
            AgentType: moduleConfig.strategy === "parallel" ? "ParallelAgent" : "LoopAgent",
            Name: moduleConfig.name,
            SubAgents: subAgents.map((name) => ({ Name: name })),
          },
        };
        if (moduleConfig.strategy === "parallel" && moduleConfig.aggregator) {
          const pipelineKey = ensureUniqueKey(`${moduleConfig.name}Pipeline`, "pipeline", index + 1, usedKeys);
          adkAgents[pipelineKey] = {
            BaseAgent: {
              AgentType: "SequentialAgent",
              Name: `${moduleConfig.name}Pipeline`,
              SubAgents: [{ Name: moduleConfig.name }, { Name: moduleConfig.aggregator }],
            },
          };
        }
      });

      const workflowCode = buildAdkWorkflowCode(
        gearAgents,
        moduleConfigs,
        input?.workflowYaml || {},
        input?.workflowItems || [],
        mappings,
      );

      return {
        outputs: {
          agents: adkAgents,
          orchestration: workflowCode,
        },
      };
    },
  };
})(window);
