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
    createConversionReport,
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
      obj[key] = value;
      return;
    }
    obj[key] = value;
  };

  const buildAdkDescriptionFromGear = (gearAgent) => {
    const descriptionParts = [gearAgent?.AgentIdentity?.Purpose, gearAgent?.AgentIdentity?.ContextDescription]
      .map((value) => (value ?? "").toString().trim())
      .filter(Boolean);
    return descriptionParts.length ? descriptionParts.join("\n") : "";
  };

  const buildAdkInstructionFromGear = (gearAgent) => {
    const base = (gearAgent?.TaskSpecification?.TaskDescription ?? "").toString().trim();
    const expected = (gearAgent?.TaskSpecification?.ExpectedOutput ?? "").toString().trim();
    if (!expected) {
      return base;
    }
    if (!base) {
      return expected;
    }
    return `${base}\n\n${expected}`;
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
    setIfMeaningful(llmAgentConfig, "Provider", gearAgent.LLMConfiguration?.Provider);
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
    setIfMeaningful(generateContentConfig, "StopSequences", getMappedValue(mapped, "LLMAgentConfig.GenerateContentConfig.StopSequences"));
    setIfMeaningful(generateContentConfig, "FrequencyPenalty", getMappedValue(mapped, "LLMAgentConfig.GenerateContentConfig.FrequencyPenalty"));
    setIfMeaningful(generateContentConfig, "PresencePenalty", getMappedValue(mapped, "LLMAgentConfig.GenerateContentConfig.PresencePenalty"));
    setIfMeaningful(generateContentConfig, "Seed", getMappedValue(mapped, "LLMAgentConfig.GenerateContentConfig.Seed"));
    if (Object.keys(generateContentConfig).length) {
      llmAgentConfig.GenerateContentConfig = generateContentConfig;
    }
    const liteLlm = {};
    setIfMeaningful(liteLlm, "ApiBase", getMappedValue(mapped, "LLMAgentConfig.LiteLlm.ApiBase"));
    setIfMeaningful(liteLlm, "Timeout", getMappedValue(mapped, "LLMAgentConfig.LiteLlm.Timeout"));
    setIfMeaningful(liteLlm, "NumRetries", getMappedValue(mapped, "LLMAgentConfig.LiteLlm.NumRetries"));
    setIfMeaningful(liteLlm, "AdditionalArgs", getMappedValue(mapped, "LLMAgentConfig.LiteLlm.AdditionalArgs"));
    if (Object.keys(liteLlm).length) {
      llmAgentConfig.LiteLlm = liteLlm;
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
      return { items: [], error: "# ADK module mapping unavailable. Check connectors/frameworks/adk/module.mapping.yml" };
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
        const aggregator = getMappedValue(mappedModule, "Runtime.Module.Parallel.Aggregator") || null;
        const loopAgents = parseNameList(getMappedValue(mappedModule, "Runtime.Module.Loop.SubAgents"));
        const turnCount = parseNumberValue(getMappedValue(mappedModule, "Runtime.Module.Loop.MaxIterations"));
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

  const buildAdkWorkflowCode = (gearAgents, moduleConfigs, workflowYaml, workflowPlan, mappings) => {
    if (!Array.isArray(mappings?.adkMulti) || !mappings.adkMulti.length) {
      return "# ADK workflow mapping unavailable. Check connectors/frameworks/adk/multiagent.mapping.yml";
    }
    if (!gearAgents.length) {
      return "# No ADK agent is defined.";
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
      "import os",
      "from copy import deepcopy",
      "from google.adk.agents import Agent, SequentialAgent, ParallelAgent, LoopAgent",
      "from google.adk.models.lite_llm import LiteLlm",
      "from google.adk.runners import Runner",
      "from google.adk.sessions import InMemorySessionService",
      "from google.genai import types",
    ];
    if (anyMemoryEnabled) {
      if (!memoryServiceClass || !memoryToolClass) {
        return "# Invalid ADK mapping: Runtime.Memory.MemoryServiceClass and Runtime.Memory.AgentToolClass are required.";
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
      const additionalParams = gearAgent.LLMConfiguration?.ModelParameters?.AdditionalParams;
      const modelOptions = additionalParams && typeof additionalParams === "object" ? { ...additionalParams } : {};
      if (gearAgent.LLMConfiguration?.BaseURL) modelOptions.api_base = gearAgent.LLMConfiguration.BaseURL;
      if (gearAgent.LLMConfiguration?.Timeout !== undefined) modelOptions.timeout = gearAgent.LLMConfiguration.Timeout;
      if (gearAgent.LLMConfiguration?.MaxRetries !== undefined) modelOptions.num_retries = gearAgent.LLMConfiguration.MaxRetries;
      const modelExpression = Object.keys(modelOptions).length
        ? `LiteLlm(model=${toPythonLiteral(modelValue)}, **${toPythonLiteral(modelOptions)})`
        : `LiteLlm(model=${toPythonLiteral(modelValue)})`;
      const instruction = buildAdkInstructionFromGear(gearAgent);
      const outputKey = gearAgent.TaskSpecification?.TaskName || "";
      const memoryEnabled = workflowMemoryEnabled || agentMemoryMap[index] === true;
      const description = buildAdkDescriptionFromGear(gearAgent);

      const args = [
        `  name=${toPythonLiteral(name)},`,
        `  model=${modelExpression},`,
      ];
      const mappedAgent = agentMappedList[index] || {};
      const generationConfig = [
        ["temperature", getMappedValue(mappedAgent, "LLMAgentConfig.GenerateContentConfig.Temperature")],
        ["max_output_tokens", getMappedValue(mappedAgent, "LLMAgentConfig.GenerateContentConfig.MaxOutputTokens")],
        ["top_p", getMappedValue(mappedAgent, "LLMAgentConfig.GenerateContentConfig.TopP")],
        ["top_k", getMappedValue(mappedAgent, "LLMAgentConfig.GenerateContentConfig.TopK")],
        ["stop_sequences", getMappedValue(mappedAgent, "LLMAgentConfig.GenerateContentConfig.StopSequences")],
        ["frequency_penalty", getMappedValue(mappedAgent, "LLMAgentConfig.GenerateContentConfig.FrequencyPenalty")],
        ["presence_penalty", getMappedValue(mappedAgent, "LLMAgentConfig.GenerateContentConfig.PresencePenalty")],
        ["seed", getMappedValue(mappedAgent, "LLMAgentConfig.GenerateContentConfig.Seed")],
      ].filter(([, value]) => value !== undefined && value !== null && value !== "");
      if (generationConfig.length) {
        args.push(
          "  generate_content_config=types.GenerateContentConfig(",
          ...generationConfig.map(([key, value]) => `    ${key}=${toPythonLiteral(value)},`),
          "  ),",
        );
      }
      if (description) {
        args.push(`  description=${toPythonLiteral(description)},`);
      }
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
          `  sub_agents=[${subAgents.map((name) => `deepcopy(${name})`).join(", ")}],`,
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
              `  sub_agents=[${moduleVar}, deepcopy(${aggregatorVar})],`,
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
          `  sub_agents=[${subAgents.map((name) => `deepcopy(${name})`).join(", ")}],`,
        ];
        if (moduleConfig.turnCount !== null) {
          args.push(`  max_iterations=${moduleConfig.turnCount},`);
        }
        moduleLines.push(`${moduleVar} = LoopAgent(`, ...args, `)`, "");
        moduleSequenceVarMap.set(moduleConfig.name, moduleVar);
      }
    });

    const resolveWorkflowVar = (item) => {
      const key = item?.ref || item?.label || item?.id;
      const variable = item?.type === "module"
        ? moduleSequenceVarMap.get(key) || moduleVarMap.get(key) || null
        : agentVarMap.get(key) || null;
      return variable ? `deepcopy(${variable})` : null;
    };
    const executionLayers = Array.isArray(workflowPlan?.executionLayers) && workflowPlan.executionLayers.length
      ? workflowPlan.executionLayers
      : Array.from(agentVarMap.keys()).map((name, index) => [{ id: `agent_${index + 1}`, ref: name, type: "agent" }]);
    const stageLines = [];
    const orderedVars = [];
    executionLayers.forEach((layer, index) => {
      const layerVars = layer.map(resolveWorkflowVar).filter(Boolean);
      if (layerVars.length <= 1) {
        if (layerVars[0]) orderedVars.push(layerVars[0]);
        return;
      }
      const stageVar = makeUniqueVar(`workflow_stage_${index + 1}`, `workflow_stage_${index + 1}`);
      stageLines.push(
        `${stageVar} = ParallelAgent(`,
        `  name=${toPythonLiteral(`WorkflowStage${index + 1}`)},`,
        `  sub_agents=[${layerVars.join(", ")}],`,
        ")",
        "",
      );
      orderedVars.push(stageVar);
    });

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
      "",
      "def _event_text(events) -> str:",
      "  for event in reversed(events):",
      "    content = getattr(event, \"content\", None)",
      "    parts = getattr(content, \"parts\", None) or []",
      "    text = \"\".join(getattr(part, \"text\", \"\") or \"\" for part in parts)",
      "    if text:",
      "      return text",
      "  return \"\"",
      "",
      "async def run_workflow(user_input: str) -> str:",
      "  events = await runner.run_debug(user_input, quiet=True)",
      "  return _event_text(events)",
      "",
      "if __name__ == \"__main__\":",
      "  prompt = os.environ.get(\"GEAR_INPUT\", \"\")",
      "  print(asyncio.run(run_workflow(prompt)))",
    ];

    const template = getTemplate("adk") || "{{imports}}\n\n{{agents_code}}\n\n{{modules_code}}\n\n{{runner_block}}\n\n{{post_run}}";
    return renderTemplate(template, {
      imports: importLines.join("\n"),
      agents_code: agentLines.join("\n").trim(),
      modules_code: [...moduleLines, ...stageLines].join("\n").trim(),
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
          error: "# ADK mapping unavailable. Check connectors/frameworks/adk/agent.mapping.yml",
        };
      }
      const gearIR = input?.gearIR;
      if (gearIR && !gearIR.valid) {
        return {
          error: gearIR.diagnostics
            .filter((item) => item.severity === "error")
            .map((item) => `# ${item.code}: ${item.message}`)
            .join("\n"),
          diagnostics: gearIR.diagnostics,
        };
      }
      const gearAgents = gearIR ? gearIR.agents.map((agent) => agent.source) : Array.isArray(input?.gearAgents) ? input.gearAgents : [];
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
      });

      const workflowCode = buildAdkWorkflowCode(
        gearAgents,
        moduleConfigs,
        input?.workflowYaml || {},
        gearIR?.workflow || { executionLayers: (input?.workflowItems || []).map((item) => [item]) },
        mappings,
      );

      const consumedPaths = [
        "AgentIdentity.Name",
        "AgentIdentity.Purpose",
        "AgentIdentity.ContextDescription",
        "LLMConfiguration.Provider",
        "LLMConfiguration.Model",
        "LLMConfiguration.BaseURL",
        "LLMConfiguration.Timeout",
        "LLMConfiguration.MaxRetries",
        "LLMConfiguration.ModelParameters.Temperature",
        "LLMConfiguration.ModelParameters.MaxTokens",
        "LLMConfiguration.ModelParameters.TopP",
        "LLMConfiguration.ModelParameters.TopK",
        "LLMConfiguration.ModelParameters.StopSequences",
        "LLMConfiguration.ModelParameters.AdditionalParams",
        "LLMConfiguration.ModelParameters.FrequencyPenalty",
        "LLMConfiguration.ModelParameters.PresencePenalty",
        "LLMConfiguration.ModelParameters.Seed",
        "TaskSpecification.TaskName",
        "TaskSpecification.TaskDescription",
        "TaskSpecification.ExpectedOutput",
        "Memory",
        "ModuleName",
        "Strategy.Parallel.ParallelAgents",
        "Strategy.Parallel.Aggregator",
        "Strategy.Loop.LoopAgents",
        "Strategy.Loop.TurnCount",
        "WorkflowName",
        "Items.Agents",
        "Items.Modules",
        "Edges.From",
        "Edges.To",
      ];
      const report = createConversionReport
        ? createConversionReport({
            frameworkId: "adk",
            gearIR,
            mappingEntries: [...agentMapping, ...(mappings.adkModule || []), ...(mappings.adkMulti || [])],
            consumedPaths,
          })
        : { framework: "adk", diagnostics: gearIR?.diagnostics || [] };

      return {
        outputs: {
          agents: adkAgents,
          modules: moduleConfigs,
          orchestration: workflowCode,
          report,
        },
      };
    },
  };
})(window);
