(function (window) {
  if (!window) return;
  // CrewAI assembler plugin: turns Gear YAML into CrewAI YAML + workflow code.
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

  const normalizeLlmValue = (llmValue) => {
    if (!llmValue) return null;
    if (typeof llmValue === "string") {
      return toCrewaiModel(null, llmValue);
    }
    if (typeof llmValue === "object") {
      const provider = llmValue.provider || llmValue.Provider;
      const model = llmValue.model || llmValue.Model;
      if (model) {
        return { ...llmValue, model: toCrewaiModel(provider, model) };
      }
      return { ...llmValue };
    }
    return null;
  };

  const buildCrewaiAgentConfigFromGear = (gearAgent, mapped) => {
    const config = {};
    setIfMeaningful(config, "role", getMappedValue(mapped, "Identity.Role"));
    setIfMeaningful(config, "goal", getMappedValue(mapped, "Identity.Goal"));
    setIfMeaningful(config, "backstory", getMappedValue(mapped, "Identity.Backstory"));
    const llmConfig = {};
    setIfMeaningful(llmConfig, "provider", gearAgent.LLMConfiguration?.Provider);
    setIfMeaningful(llmConfig, "model", getMappedValue(mapped, "LLMConfiguration.Model"));
    if (Object.keys(llmConfig).length) {
      setIfMeaningful(config, "llm", llmConfig);
    } else {
      const modelValue = toCrewaiModel(
        gearAgent.LLMConfiguration?.Provider,
        getMappedValue(mapped, "LLMConfiguration.Model"),
      );
      setIfMeaningful(config, "llm", modelValue);
    }
    setIfMeaningful(config, "verbose", getMappedValue(mapped, "BehavioralControls.Verbose") === true);
    setIfMeaningful(
      config,
      "allow_delegation",
      getMappedValue(mapped, "BehavioralControls.AllowDelegation") === true,
    );
    setIfMeaningful(
      config,
      "allow_code_execution",
      getMappedValue(mapped, "BehavioralControls.AllowCodeExecution") === true,
    );
    setIfMeaningful(config, "cache", getMappedValue(mapped, "BehavioralControls.Cache") === true);
    setIfMeaningful(config, "reasoning", getMappedValue(mapped, "Reasoning") === true);
    setIfMeaningful(config, "memory", getMappedValue(mapped, "Memory") === true);
    return config;
  };

  const buildCrewaiTaskConfigFromGear = (gearAgent, mapped, agentKey, taskKey) => {
    const config = {};
    setIfMeaningful(config, "description", getMappedValue(mapped, "Task.Essential.Description") || "");
    setIfMeaningful(config, "expected_output", getMappedValue(mapped, "Task.Essential.ExpectedOutput") || "");
    setIfMeaningful(config, "agent", getMappedValue(mapped, "Task.Essential.This_Agent") || agentKey);
    setIfMeaningful(config, "name", getMappedValue(mapped, "Task.Essential.Name") || taskKey);
    setIfMeaningful(config, "async_execution", getMappedValue(mapped, "Task.Execution.AsyncExecution") === true);
    setIfMeaningful(config, "human_input", getMappedValue(mapped, "Task.Execution.HumanInput") === true);
    return config;
  };

  const buildCrewaiWorkflowCode = (agentsPayload, tasksPayload, workflowYaml, workflowItems, mappings) => {
    if (!Array.isArray(mappings?.crewaiMulti) || !mappings.crewaiMulti.length) {
      return "# Mapping CrewAI workflow indisponible. Vérifie connectors/frameworks/crewai/multiagent.mapping.yml";
    }
    const agentKeys = Object.keys(agentsPayload || {});
    if (!agentKeys.length) {
      return "# Aucun agent CrewAI defini.";
    }

    const importLines = [
      "from crewai import Agent, Crew, Task, Process, LLM",
      "import os",
      "import sys",
      "from dotenv import load_dotenv",
      "",
      "load_dotenv()",
    ];

    const llmLines = [];
    const agentLines = [];
    const taskLines = [];
    const usedNames = new Set();
    const agentVarMap = {};
    const taskVarMap = {};

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

    const agentNameMap = new Map();
    agentKeys.forEach((agentKey) => {
      const role = agentsPayload[agentKey]?.role?.toString().trim();
      if (role && !agentNameMap.has(role)) {
        agentNameMap.set(role, agentKey);
      }
      if (!agentNameMap.has(agentKey)) {
        agentNameMap.set(agentKey, agentKey);
      }
    });

    agentKeys.forEach((agentKey, index) => {
      const agentVar = makeUniqueVar(agentKey, `agent_${index + 1}`);
      agentVarMap[agentKey] = agentVar;
      const agentConfig = agentsPayload[agentKey] || {};
      let llmVar = "None";
      const normalizedLlm = normalizeLlmValue(agentConfig.llm);
      if (normalizedLlm) {
        const llmName = `${agentVar}_llm`;
        if (typeof normalizedLlm === "string") {
          llmLines.push(
            `${llmName} = LLM(`,
            `  model=${toPythonLiteral(normalizedLlm)}`,
            `)`,
            "",
          );
        } else {
          const llmArgs = Object.entries(normalizedLlm)
            .filter(([, value]) => value !== null && value !== undefined && value !== "")
            .map(([key, value]) => `  ${key}=${toPythonLiteral(value)},`);
          llmLines.push(`${llmName} = LLM(`, ...llmArgs, `)`, "");
        }
        llmVar = llmName;
      }

      const args = Object.entries(agentConfig)
        .filter(([, value]) => {
          if (value === null || value === undefined) return false;
          if (typeof value === "string" && value.trim() === "") return false;
          if (Array.isArray(value) && value.length === 0) return false;
          return true;
        })
        .map(([key, value]) => {
          if (key === "llm") {
            return `  ${key}=${llmVar},`;
          }
          return `  ${key}=${toPythonLiteral(value)},`;
        });

      agentLines.push(`${agentVar} = Agent(`, ...args, `)`, "");
    });

    const taskKeys = Object.keys(tasksPayload || {});
    taskKeys.forEach((taskKey, index) => {
      const taskVar = makeUniqueVar(taskKey, `task_${index + 1}`);
      taskVarMap[taskKey] = taskVar;
      const taskConfig = tasksPayload[taskKey] || {};
      const args = Object.entries(taskConfig)
        .filter(([, value]) => {
          if (value === null || value === undefined) return false;
          if (typeof value === "string" && value.trim() === "") return false;
          if (Array.isArray(value) && value.length === 0) return false;
          return true;
        })
        .map(([key, value]) => {
          if (key === "agent" && typeof value === "string" && agentVarMap[value]) {
            return `  ${key}=${agentVarMap[value]},`;
          }
          return `  ${key}=${toPythonLiteral(value)},`;
        });
      taskLines.push(`${taskVar} = Task(`, ...args, `)`, "");
    });

    const mappedWorkflow = applyMapping(workflowYaml || {}, mappings.crewaiMulti);
    const mappedProcessRaw = getMappedValue(mappedWorkflow, "Crew.EssentialComponents.Process");
    if (!mappedProcessRaw) {
      return "# Mapping CrewAI invalide: Crew.EssentialComponents.Process requis.";
    }
    const processValue = String(mappedProcessRaw).toLowerCase();
    const mappedMemory = getMappedValue(mappedWorkflow, "Crew.MemoryAndPerformance.Memory");
    const memoryValue = typeof mappedMemory === "boolean" ? mappedMemory : false;

    const orderedAgents =
      Array.isArray(workflowItems) && workflowItems.length
        ? workflowItems
            .filter((item) => item.type === "agent")
            .map((item) => agentNameMap.get(item.label || item.id) || item.label || item.id)
            .filter((key) => agentKeys.includes(key))
        : agentKeys.slice();

    const orderedTasks = [];
    orderedAgents.forEach((agentKey) => {
      const agentRole = agentsPayload[agentKey]?.role?.toString().trim();
      taskKeys.forEach((taskKey) => {
        const taskAgent = tasksPayload[taskKey]?.agent;
        if ((taskAgent === agentKey || (agentRole && taskAgent === agentRole)) && !orderedTasks.includes(taskKey)) {
          orderedTasks.push(taskKey);
        }
      });
    });

    const fallbackAgents = orderedAgents.length ? orderedAgents : agentKeys;
    const fallbackTasks = orderedTasks.length ? orderedTasks : taskKeys;

    const crewLines = [
      "crew = Crew(",
      `  agents=[${fallbackAgents.map((key) => agentVarMap[key]).join(", ")}],`,
      `  tasks=[${fallbackTasks.map((key) => taskVarMap[key]).join(", ")}],`,
      `  process=Process.${processValue},`,
    ];
    if (memoryValue) {
      crewLines.push("  memory=True,");
    }
    crewLines.push(")");
    const kickoffLines = ["", "result = crew.kickoff()", "", 'print(\"result:\", result)'];

    const template = getTemplate("crewai") || "{{imports}}\n\n{{agents_code}}\n\n{{tasks_code}}\n\n{{crew_block}}\n\n{{post_run}}";
    const agentsCode = [...llmLines, ...agentLines].join("\n").trim();
    return renderTemplate(template, {
      imports: importLines.join("\n"),
      agents_code: agentsCode,
      tasks_code: taskLines.join("\n").trim(),
      crew_block: crewLines.join("\n"),
      post_run: kickoffLines.join("\n"),
    });
  };

  window.GearAssemblyPlugins.crewai = {
    assemble(input) {
      const mappings = input?.mappings || {};
      const mappingEntries = Array.isArray(mappings.crewaiAgent) ? mappings.crewaiAgent : null;
      if (!mappingEntries) {
        return {
          error: "# Mapping CrewAI indisponible. Vérifie connectors/frameworks/crewai/agent.mapping.yml",
        };
      }
      const gearAgents = Array.isArray(input?.gearAgents) ? input.gearAgents : [];
      const agentsPayload = {};
      const tasksPayload = {};
      const usedAgentKeys = new Set();
      const usedTaskKeys = new Set();

      gearAgents.forEach((gearAgent, index) => {
        const mapped = applyMapping(gearAgent, mappingEntries);
        const agentKey = ensureUniqueKey(gearAgent.AgentIdentity?.Name, "agent", index + 1, usedAgentKeys);
        agentsPayload[agentKey] = buildCrewaiAgentConfigFromGear(gearAgent, mapped);
        const taskKey = ensureUniqueKey(
          gearAgent.TaskSpecification?.TaskName,
          "task",
          index + 1,
          usedTaskKeys,
        );
        tasksPayload[taskKey] = buildCrewaiTaskConfigFromGear(gearAgent, mapped, agentKey, taskKey);
      });

      const workflowCode = buildCrewaiWorkflowCode(
        agentsPayload,
        tasksPayload,
        input?.workflowYaml || {},
        input?.workflowItems || [],
        mappings,
      );

      return {
        outputs: {
          agents: agentsPayload,
          tasks: tasksPayload,
          orchestration: workflowCode,
        },
      };
    },
  };
})(window);
