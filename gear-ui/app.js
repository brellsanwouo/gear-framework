const agentsContainer = document.getElementById("agentsContainer");
const agentTemplate = document.getElementById("agentTemplate");
const addAgentButton = document.getElementById("addAgent");
const outputCrewaiAgents = document.getElementById("outputCrewaiAgents");
const outputCrewaiTasks = document.getElementById("outputCrewaiTasks");
const outputCrewaiOrchestration = document.getElementById("outputCrewaiOrchestration");
const outputCrewaiCombined = document.getElementById("outputCrewaiCombined");
const outputCrewaiOrchestrationCombined = document.getElementById("outputCrewaiOrchestrationCombined");
const outputAdkAgents = document.getElementById("outputAdkAgents");
const outputAdkOrchestration = document.getElementById("outputAdkOrchestration");
const outputAdkCombined = document.getElementById("outputAdkCombined");
const copyCrewaiButton = document.getElementById("copyCrewai");
const downloadCrewaiButton = document.getElementById("downloadCrewai");
const copyIconButtons = document.querySelectorAll("[data-copy-target]");
const mappingSummary = document.getElementById("mappingSummary");
const mappingSummaryAdk = document.getElementById("mappingSummaryAdk");
const runOrchestrationButton = document.getElementById("runOrchestration");
const orchestrationInputsField = document.getElementById("orchestrationInputs");
const orchestrationRunOutput = document.getElementById("orchestrationRunOutput");
const orchestrationStatus = document.getElementById("orchestrationStatus");
const adkOrchestrationInputsField = document.getElementById("adkOrchestrationInputs");
const adkOrchestrationRunOutput = document.getElementById("adkOrchestrationRunOutput");
const adkOrchestrationStatus = document.getElementById("adkOrchestrationStatus");
const runAdkOrchestrationButton = document.getElementById("runAdkOrchestration");
const adkOrchestrationRunCode = document.getElementById("adkOrchestrationRunCode");
const orchestrationPanel = document.getElementById("orchestrationPanel");
const orchestrationTypeSelect = document.getElementById("orchestrationType");
const orchestrationTurnCount = document.getElementById("orchestrationTurnCount");
const orchestrationAggregator = document.getElementById("orchestrationAggregator");
const orchestrationRootAgent = document.getElementById("orchestrationRootAgent");
const orchestrationMemory = document.getElementById("orchestrationMemory");
const orchestrationWarnings = document.getElementById("orchestrationWarnings");
const orchestrationAgents = document.getElementById("orchestrationAgents");
const orchestrationEditor = document.getElementById("orchestrationEditor");
const removeOrchestrationToken = document.getElementById("removeOrchestrationToken");
const clearOrchestrationEditor = document.getElementById("clearOrchestrationEditor");

let bindingTable = null;
let agentCounter = 0;

const LLM_PROVIDER_OPTIONS = ["gemini", "ollama", "openai"];
const DEFAULT_LLM_PROVIDER = "gemini";

const fallbackMapping = {
  AgentIdentity: {
    Name: { crewai: "Identity.Role" },
    Purpose: { crewai: "Identity.Goal" },
    ContextDescription: { crewai: "Identity.Backstory" },
  },
  LLMConfiguration: {
    Model: { crewai: "LLMConfiguration.Model" },
    APIConfiguration: {
      APIKey: { crewai: "LLMConfiguration.API_KEY" },
      Timeout: { crewai: "LLMConfiguration.Advanced_configs.Timeout" },
      MaxRetries: { crewai: "LLMConfiguration.Advanced_configs.MaxRetries" },
    },
    ModelParameters: {
      Temperature: { crewai: "LLMConfiguration.Advanced_configs.Temperature" },
      MaxTokens: { crewai: "LLMConfiguration.Advanced_configs.MaxTokens" },
      TopP: { crewai: "LLMConfiguration.Advanced_configs.Top_p" },
      StopSequences: { crewai: "LLMConfiguration.Advanced_configs.Stop" },
      TopK: { crewai: null },
      FrequencyPenalty: { crewai: "LLMConfiguration.Advanced_configs.FrequencyPenalty" },
      PresencePenalty: { crewai: "LLMConfiguration.Advanced_configs.PresencePenalty" },
      Seed: { crewai: "LLMConfiguration.Advanced_configs.Seed" },
      AdditionalParams: { crewai: null },
    },
  },
  TaskSpecification: {
    TaskName: { crewai: "Task.Essential.Name" },
    TaskDescription: { crewai: "Task.Essential.Description" },
    ExpectedOutput: { crewai: "Task.Essential.ExpectedOutput" },
    AssignedAgent: { crewai: "Task.Essential.This_Agent" },
  },
  Tools: {
    AgentLevel: { crewai: "Agent_Tools" },
    TaskLevel: { crewai: "Task.Execution.Task_Tools" },
  },
  ExecutionControl: {
    DelegationControl: { crewai: "BehavioralControls.AllowDelegation" },
    CodeExecutionControl: { crewai: "BehavioralControls.AllowCodeExecution" },
    AsyncExecutionControl: { crewai: "Task.Execution.AsyncExecution" },
    HumanInteractionControl: { crewai: "Task.Execution.HumanInput" },
    VerbosityControl: { crewai: "BehavioralControls.Verbose" },
    CachingControl: { crewai: "BehavioralControls.Cache" },
  },
  Capabilities: {
    Memory: { crewai: "Memory" },
    Reasoning: { crewai: "Reasoning" },
  },
};

const mappingKeys = [
  "AgentIdentity.Name",
  "AgentIdentity.Purpose",
  "AgentIdentity.ContextDescription",
  "LLMConfiguration.Model",
  "LLMConfiguration.APIConfiguration.APIKey",
  "LLMConfiguration.APIConfiguration.Timeout",
  "LLMConfiguration.APIConfiguration.MaxRetries",
  "LLMConfiguration.ModelParameters.Temperature",
  "LLMConfiguration.ModelParameters.MaxTokens",
  "LLMConfiguration.ModelParameters.TopP",
  "LLMConfiguration.ModelParameters.StopSequences",
  "LLMConfiguration.ModelParameters.TopK",
  "LLMConfiguration.ModelParameters.FrequencyPenalty",
  "LLMConfiguration.ModelParameters.PresencePenalty",
  "LLMConfiguration.ModelParameters.Seed",
  "LLMConfiguration.ModelParameters.AdditionalParams",
  "TaskSpecification.TaskName",
  "TaskSpecification.TaskDescription",
  "TaskSpecification.ExpectedOutput",
  "TaskSpecification.AssignedAgent",
  "Tools.AgentLevel",
  "Tools.TaskLevel",
  "ExecutionControl.DelegationControl",
  "ExecutionControl.CodeExecutionControl",
  "ExecutionControl.AsyncExecutionControl",
  "ExecutionControl.HumanInteractionControl",
  "ExecutionControl.VerbosityControl",
  "ExecutionControl.CachingControl",
  "Capabilities.Memory",
  "Capabilities.Reasoning",
];

const parseList = (value) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const parseNumber = (value) => {
  if (value === "" || value === null || Number.isNaN(Number(value))) {
    return null;
  }
  return Number(value);
};

const parseJson = (value) => {
  if (!value || value.trim() === "") {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
};

const toPythonLiteral = (value) => {
  if (value === null || value === undefined) {
    return "None";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "None";
  }
  if (typeof value === "boolean") {
    return value ? "True" : "False";
  }
  if (Array.isArray(value)) {
    return `[${value.map(toPythonLiteral).join(", ")}]`;
  }
  const json = JSON.stringify(value, null, 2);
  return json
    .replace(/\btrue\b/g, "True")
    .replace(/\bfalse\b/g, "False")
    .replace(/\bnull\b/g, "None");
};

const buildGearYamlFromData = (data) => {
  const agent = {};
  const identity = {};
  const llmConfig = {};
  const apiConfig = {};
  const modelParams = {};
  const task = {};
  const exec = {};

  setIf(identity, "Name", data.name || "");
  setIf(identity, "Purpose", data.purpose || "");
  setIf(identity, "ContextDescription", data.contextDescription || "");
  if (Object.keys(identity).length) {
    agent.AgentIdentity = identity;
  }

  const provider = data.llmProvider || DEFAULT_LLM_PROVIDER;
  const modelName = data.model || "";
  setIf(llmConfig, "Model", modelName ? `${provider}:${modelName}` : "");
  if (data.showAdvancedLlm) {
    setIf(apiConfig, "Timeout", parseNumber(data.timeout));
    setIf(apiConfig, "MaxRetries", parseNumber(data.maxRetries));
    setIf(modelParams, "Temperature", parseNumber(data.temperature));
    setIf(modelParams, "MaxTokens", parseNumber(data.maxTokens));
    setIf(modelParams, "TopP", parseNumber(data.topP));
    const stopSequences = parseList(data.stopSequences);
    if (stopSequences.length) {
      setIf(modelParams, "StopSequences", stopSequences);
    }
    setIf(modelParams, "TopK", parseNumber(data.topK));
    setIf(modelParams, "FrequencyPenalty", parseNumber(data.frequencyPenalty));
    setIf(modelParams, "PresencePenalty", parseNumber(data.presencePenalty));
    setIf(modelParams, "Seed", parseNumber(data.seed));
    const additionalParams = parseJson(data.additionalParams);
    if (additionalParams) {
      setIf(modelParams, "AdditionalParams", additionalParams);
    }
  }

  if (Object.keys(apiConfig).length) {
    llmConfig.APIConfiguration = apiConfig;
  }
  if (Object.keys(modelParams).length) {
    llmConfig.ModelParameters = modelParams;
  }
  if (Object.keys(llmConfig).length) {
    agent.LLMConfiguration = llmConfig;
  }

  setIf(task, "TaskName", data.taskName || "");
  setIf(task, "TaskDescription", data.taskDescription || "");
  setIf(task, "ExpectedOutput", data.expectedOutput || "");
  setIf(task, "AssignedAgent", data.assignedAgent || "");
  if (Object.keys(task).length) {
    agent.TaskSpecification = task;
  }

  const tools = parseList(data.tools);
  if (tools.length) {
    agent.Tools = tools;
  }

  setIf(exec, "DelegationControl", Boolean(data.delegationControl));
  setIf(exec, "CodeExecutionControl", Boolean(data.codeExecutionControl));
  setIf(exec, "AsyncExecutionControl", Boolean(data.asyncExecutionControl));
  setIf(exec, "HumanInteractionControl", Boolean(data.humanInteractionControl));
  setIf(exec, "VerbosityControl", Boolean(data.verbosityControl));
  setIf(exec, "CachingControl", data.cachingControl ?? true);
  if (Object.keys(exec).length) {
    agent.ExecutionControl = exec;
  }

  setIf(agent, "Memory", Boolean(data.memory));
  setIf(agent, "Reasoning", Boolean(data.reasoning));

  return jsyaml.dump(agent, { noRefs: true, lineWidth: 120 }).trim();
};

const setIf = (target, key, value) => {
  if (value === null || value === "" || value === undefined) {
    return;
  }
  target[key] = value;
};

const getMappingPath = (key, target = "crewai") => {
  if (!bindingTable) {
    return null;
  }
  const root = target === "adk" ? bindingTable?.mapping_adk : bindingTable?.mapping;
  if (!root) {
    return null;
  }
  const parts = key.split(".");
  let current = root;
  for (const part of parts) {
    current = current?.[part];
  }
  return target === "adk" ? current?.adk || null : current?.crewai || null;
};

const renderMappingBadges = () => {
  document.querySelectorAll("[data-mapping-key]").forEach((badge) => {
    const key = badge.dataset.mappingKey;
    const crewaiPath = getMappingPath(key, "crewai") || "—";
    badge.textContent = `CrewAI: ${crewaiPath}`;
  });

  if (mappingSummary) {
    mappingSummary.innerHTML = "";
    mappingKeys.forEach((key) => {
      const crewaiPath = getMappingPath(key, "crewai");
      const item = document.createElement("li");
      item.textContent = `${key} → CrewAI: ${crewaiPath || "—"}`;
      mappingSummary.appendChild(item);
    });
  }

  if (mappingSummaryAdk) {
    mappingSummaryAdk.innerHTML = "";
    mappingKeys.forEach((key) => {
      const adkPath = getMappingPath(key, "adk");
      const item = document.createElement("li");
      item.textContent = `${key} → ADK: ${adkPath || "—"}`;
      mappingSummaryAdk.appendChild(item);
    });
  }
};

const buildCrewaiAgentConfig = (data) => {
  const agentTools = parseList(data.tools);
  const stopSequences = parseList(data.stopSequences);
  const additionalParams = parseJson(data.additionalParams);
  const hasAdvanced = Boolean(data.showAdvancedLlm);
  const provider = data.llmProvider || DEFAULT_LLM_PROVIDER;
  const modelName = data.model || "";
  const modelValue = modelName ? `${provider}/${modelName}` : "";
  const config = {
    role: data.name || "",
    goal: data.purpose || "",
    backstory: data.contextDescription || "",
  };

  const llmConfig = {};
  if (modelValue) {
    llmConfig.model = modelValue;
  }
  if (hasAdvanced) {
    if (data.temperature !== "") {
      llmConfig.temperature = parseNumber(data.temperature);
    }
    if (data.maxTokens !== "") {
      llmConfig.max_tokens = parseNumber(data.maxTokens);
    }
    if (data.topP !== "") {
      llmConfig.top_p = parseNumber(data.topP);
    }
    if (stopSequences.length) {
      llmConfig.stop = stopSequences;
    }
    if (data.topK !== "") {
      llmConfig.top_k = parseNumber(data.topK);
    }
    if (data.frequencyPenalty !== "") {
      llmConfig.frequency_penalty = parseNumber(data.frequencyPenalty);
    }
    if (data.presencePenalty !== "") {
      llmConfig.presence_penalty = parseNumber(data.presencePenalty);
    }
    if (data.seed !== "") {
      llmConfig.seed = parseNumber(data.seed);
    }
    if (additionalParams) {
      llmConfig.additional_params = additionalParams;
    }
  }
  if (Object.keys(llmConfig).length === 1 && llmConfig.model) {
    setIf(config, "llm", llmConfig.model);
  } else if (Object.keys(llmConfig).length > 0) {
    setIf(config, "llm", llmConfig);
  }
  config.verbose = data.verbosityControl || false;
  config.allow_delegation = data.delegationControl || false;
  config.allow_code_execution = data.codeExecutionControl || false;
  if (data.codeExecutionControl) {
    setIf(config, "code_execution_mode", "safe");
  }
  if (data.maxRetries !== "") {
    setIf(config, "max_retry_limit", parseNumber(data.maxRetries));
  }
  if (data.timeout !== "") {
    setIf(config, "max_execution_time", parseNumber(data.timeout));
  }
  config.cache = data.cachingControl ?? true;
  config.reasoning = data.reasoning || false;
  config.memory = data.memory || false;
  if (agentTools.length) {
    setIf(config, "tools", agentTools);
  }

  return config;
};

const buildCrewaiTaskConfig = (data, agentKey) => {
  const config = {
    description: data.taskDescription || data.purpose || "",
    expected_output: data.expectedOutput || "",
    agent: data.assignedAgent || agentKey,
  };

  if (data.asyncExecutionControl) {
    setIf(config, "async_execution", true);
  }
  if (data.humanInteractionControl) {
    setIf(config, "human_input", true);
  }

  return config;
};

const buildAdkAgentConfig = (data) => {
  const baseAgent = {};
  const llmAgentConfig = {};
  const generateContentConfig = {};
  const configurations = {};
  const dataStructure = {};
  const planner = {};
  const builtInPlanner = {};
  const thinkingConfig = {};
  const provider = data.llmProvider || DEFAULT_LLM_PROVIDER;
  const modelName = data.model || "";
  const modelValue = modelName ? `${provider}:${modelName}` : "";

  baseAgent.AgentType = "LlmAgent";
  setIf(baseAgent, "Name", data.name || "");
  const descriptionParts = [data.purpose, data.contextDescription]
    .map((value) => value?.toString().trim())
    .filter(Boolean);
  if (descriptionParts.length) {
    setIf(baseAgent, "Description", descriptionParts.join("\n"));
  }

  setIf(llmAgentConfig, "Model", modelValue);
  if (data.showAdvancedLlm) {
    setIf(generateContentConfig, "Temperature", parseNumber(data.temperature));
    setIf(generateContentConfig, "MaxOutputTokens", parseNumber(data.maxTokens));
    setIf(generateContentConfig, "TopP", parseNumber(data.topP));
    setIf(generateContentConfig, "TopK", parseNumber(data.topK));
  }
  if (Object.keys(generateContentConfig).length) {
    llmAgentConfig.GenerateContentConfig = generateContentConfig;
  }

  setIf(configurations, "Instruction", data.taskDescription || data.purpose || "");
  const tools = parseList(data.tools);
  if (tools.length) {
    configurations.Tools = tools;
  }
  if (data.taskName) {
    setIf(dataStructure, "OutputKey", data.taskName);
  }
  const outputSchema = parseJson(data.expectedOutput);
  if (outputSchema && typeof outputSchema === "object" && !Array.isArray(outputSchema)) {
    setIf(dataStructure, "OutputSchema", outputSchema);
  }
  if (Object.keys(dataStructure).length) {
    configurations.DataStructure = dataStructure;
  }
  if (data.codeExecutionControl) {
    configurations.CodeExecutor = true;
  }
  if (data.reasoning) {
    thinkingConfig.IncludeThoughts = true;
    builtInPlanner.ThinkingConfig = thinkingConfig;
    planner.BuiltInPlanner = builtInPlanner;
    configurations.Planner = planner;
  }

  const config = {
    BaseAgent: baseAgent,
  };
  if (Object.keys(llmAgentConfig).length) {
    config.LLMAgentConfig = llmAgentConfig;
  }
  if (Object.keys(configurations).length) {
    config.Configurations = configurations;
  }
  return config;
};

const toPythonName = (value, fallback) => {
  const base = (value || "").toString().trim();
  if (!base) {
    return fallback;
  }
  const sanitized = base
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9_\s]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .toLowerCase();
  return sanitized.length ? sanitized : fallback;
};

const buildCrewaiOrchestration = (agentsPayload, tasksPayload, orchestrationConfig = {}) => {
  const agentKeys = Object.keys(agentsPayload);
  if (!agentKeys.length) {
    return "";
  }

  const importLines = [
    "from crewai import Agent, Crew, Task, Process, LLM",
    "import os",
    "import sys",
    "from dotenv import load_dotenv",
    "",
    "load_dotenv()",
    "",
  ];

  const llmLines = [];
  const agentLines = [];
  const taskLines = [];
  const llmVars = [];
  const agentVars = [];
  const taskVars = [];
  const usedAgentNames = new Set();

  const makeUniqueVar = (base, fallback) => {
    let candidate = toPythonName(base, fallback);
    let suffix = 2;
    while (usedAgentNames.has(candidate)) {
      candidate = `${candidate}_${suffix}`;
      suffix += 1;
    }
    usedAgentNames.add(candidate);
    return candidate;
  };

  const agentVarMap = {};
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
    agentVars.push(agentVar);

    const agentConfig = agentsPayload[agentKey] || {};
    let llmVar = "None";
    if (agentConfig.llm) {
      const llmConfig = agentConfig.llm;
      const llmName = `${agentVar}_llm`;
      if (typeof llmConfig === "string") {
        llmLines.push(
          `${llmName} = LLM(`,
          `  model=${toPythonLiteral(llmConfig)}`,
          `)`,
          ""
        );
      } else {
        const llmArgs = Object.entries(llmConfig)
          .filter(([, value]) => value !== null && value !== undefined && value !== "")
          .map(([key, value]) => `  ${key}=${toPythonLiteral(value)},`);
        llmLines.push(`${llmName} = LLM(`, ...llmArgs, `)`, "");
      }
      llmVar = llmName;
    }
    llmVars.push(llmVar);

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

  const taskKeys = Object.keys(tasksPayload);
  const taskVarMap = {};
  taskKeys.forEach((taskKey, index) => {
    const taskVar = toPythonName(taskKey, `task_${index + 1}`);
    taskVars.push(taskVar);
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

  const crewLines = [];
  const orchestrationType = orchestrationConfig?.type || "Sequential";
  const processValue = "sequential";
  const memoryEnabled = orchestrationConfig.memory === true;

  const orderedAgentKeys = [];
  const orderedTaskKeys = [];
  const definition = orchestrationConfig?.definition || "";
  if (definition.trim()) {
    const rawParts = definition.split("->");
    rawParts.forEach((part) => {
      const cleaned = part.replace(/[()|]/g, "").trim();
      if (!cleaned || cleaned.toLowerCase() === "end") {
        return;
      }
      const key = agentNameMap.get(cleaned);
      if (key && !orderedAgentKeys.includes(key)) {
        orderedAgentKeys.push(key);
      }
    });
  }
  orderedAgentKeys.forEach((agentKey) => {
    const agentRole = agentsPayload[agentKey]?.role?.toString().trim();
    taskKeys.forEach((taskKey) => {
      const taskAgent = tasksPayload[taskKey]?.agent;
      if ((taskAgent === agentKey || (agentRole && taskAgent === agentRole)) && !orderedTaskKeys.includes(taskKey)) {
        orderedTaskKeys.push(taskKey);
      }
    });
  });

  crewLines.push(
    "crew = Crew(",
    `  agents=[${orderedAgentKeys.map((agentKey) => agentVarMap[agentKey]).join(", ")}],`,
    `  tasks=[${orderedTaskKeys.map((taskKey) => taskVarMap[taskKey]).join(", ")}],`,
    `  process=Process.${processValue},`
  );
  if (memoryEnabled) {
    crewLines.push("  memory=True,");
  }
  crewLines.push(")");

  return [...importLines, ...llmLines, ...agentLines, ...taskLines, ...crewLines].join("\n").trim();
};

const buildAdkOrchestration = (agentsData, orchestrationConfig = {}) => {
  const agentKeys = agentsData.map((data, index) => ensureKey(data.name, "agent", index + 1));
  if (!agentKeys.length) {
    return "";
  }

  const memoryEnabled = Boolean(orchestrationConfig?.memory) || agentsData.some((data) => Boolean(data?.memory));

  const agentNameMap = new Map();
  agentKeys.forEach((agentKey, index) => {
    const label = agentsData[index]?.name?.toString().trim();
    if (label) {
      agentNameMap.set(label, agentKey);
    }
    agentNameMap.set(agentKey, agentKey);
  });

  const parseStepGroups = (definition) => {
    if (!definition || !definition.trim()) {
      return [];
    }
    const steps = [];
    definition.split("->").forEach((segment) => {
      const cleaned = segment.replace(/[()]/g, "").trim();
      if (!cleaned || cleaned.toLowerCase() === "end") {
        return;
      }
      const names = cleaned
        .split("|")
        .map((name) => name.trim())
        .filter(Boolean);
      const keys = [];
      names.forEach((name) => {
        const key = agentNameMap.get(name);
        if (key && !keys.includes(key)) {
          keys.push(key);
        }
      });
      if (keys.length) {
        steps.push(keys);
      }
    });
    return steps;
  };

  const flattenUnique = (groups) => {
    const ordered = [];
    groups.forEach((group) => {
      group.forEach((item) => {
        if (!ordered.includes(item)) {
          ordered.push(item);
        }
      });
    });
    return ordered;
  };

  const definition = orchestrationConfig?.definition || "";
  const orchestrationType = orchestrationConfig?.type || "Sequential";
  const importLines = [
    "from google.adk.agents import Agent, SequentialAgent, ParallelAgent, LoopAgent",
    "from google.adk.models.google_llm import Gemini",
    "from google.adk.runners import Runner",
    "from google.adk.sessions import InMemorySessionService",
    "from google.adk.tools import google_search",
    ...(memoryEnabled
      ? [
          "from google.adk.memory import InMemoryMemoryService",
          "from google.adk.tools import load_memory",
          "from google.adk.tools.preload_memory_tool import PreloadMemoryTool",
        ]
      : []),
    "",
    "try:",
    "    from dotenv import load_dotenv",
    "    load_dotenv()",
    "except Exception:",
    "    pass",
    "",
  ];

  const agentVarMap = {};
  const agentLines = [];
  const toolIdentifierMap = {
    google_search: "google_search",
    load_memory: "load_memory",
  };

  if (memoryEnabled) {
    agentLines.push(
      "memory_service = InMemoryMemoryService()",
      "",
      "async def auto_save_session_to_memory_callback(callback_context):",
      "    try:",
      "        await callback_context._invocation_context.memory_service.add_session_to_memory(",
      "            callback_context._invocation_context.session",
      "        )",
      "    except Exception as exc:",
      "        print(f\"[memory] add_session_to_memory failed: {exc}\")",
      "",
      ""
    );
  }

  agentKeys.forEach((agentKey, index) => {
    const data = agentsData[index] || {};
    const agentVar = toPythonName(agentKey, `agent_${index + 1}`);
    agentVarMap[agentKey] = agentVar;
    const provider = data.llmProvider || DEFAULT_LLM_PROVIDER;
    const rawModel = data.model || "gemini-2.5-flash-lite";
    const modelValue = provider === "gemini" ? rawModel : `${provider}:${rawModel}`;

    const baseTools = parseList(data.tools)
      .map((tool) => tool.toLowerCase().replace(/\s+/g, "_"))
      .map((tool) => toolIdentifierMap[tool])
      .filter(Boolean);

    const agentMemoryEnabled = Boolean(orchestrationConfig?.memory) || Boolean(data?.memory);
    const tools = [...baseTools];
    if (agentMemoryEnabled) {
      if (!tools.includes("load_memory")) {
        tools.push("load_memory");
      }
      if (Boolean(orchestrationConfig?.memory) && !tools.includes("PreloadMemoryTool()")) {
        tools.unshift("PreloadMemoryTool()");
      }
    }

    const args = [
      `  name=${toPythonLiteral(data.name || agentKey)}`,
      `  model=Gemini(model=${toPythonLiteral(modelValue)})`,
    ];
    let instruction = data.taskDescription || data.purpose || "";
    if (agentMemoryEnabled) {
      instruction = [instruction, "Utilise la mémoire (load_memory) si une information utile vient de conversations précédentes."]
        .map((value) => value?.toString().trim())
        .filter(Boolean)
        .join("\n\n");
    }
    if (instruction) {
      args.push(`  instruction=${toPythonLiteral(instruction)}`);
    }
    if (data.taskName) {
      args.push(`  output_key=${toPythonLiteral(data.taskName)}`);
    }
    if (tools.length) {
      args.push(`  tools=[${tools.join(", ")}]`);
    }

    if (agentMemoryEnabled) {
      args.push("  after_agent_callback=auto_save_session_to_memory_callback");
    }

    if (provider !== "gemini") {
      agentLines.push(`# NOTE: Provider '${provider}' sélectionné. Adapte le client modèle si nécessaire.`);
    }
    agentLines.push(`${agentVar} = Agent(`, ...args.map((line) => `${line},`), ")", "");
  });

  const orchestrationLines = [];
  const pipelineVars = [];
  let stepIndex = 0;

  const addStep = (group) => {
    if (!group.length) {
      return;
    }
    if (group.length === 1) {
      pipelineVars.push(agentVarMap[group[0]]);
      return;
    }
    stepIndex += 1;
    const parallelVar = `parallel_step_${stepIndex}`;
    const subAgents = group.map((key) => agentVarMap[key]).join(", ");
    orchestrationLines.push(
      `${parallelVar} = ParallelAgent(`,
      `  name=${toPythonLiteral(`ParallelStep${stepIndex}`)},`,
      `  sub_agents=[${subAgents}],`,
      ")",
      ""
    );
    pipelineVars.push(parallelVar);
  };

  if (orchestrationType === "Loop") {
    const hasLoopGroup = definition.includes("(") && definition.includes(")");
    let loopGroup = [];
    let prefixSteps = [];
    let suffixSteps = [];

    if (hasLoopGroup) {
      const start = definition.indexOf("(");
      const end = definition.lastIndexOf(")");
      const before = definition.slice(0, start);
      const inside = definition.slice(start + 1, end);
      const after = definition.slice(end + 1);
      prefixSteps = parseStepGroups(before);
      suffixSteps = parseStepGroups(after);
      loopGroup = flattenUnique(parseStepGroups(inside));
    }

    if (!loopGroup.length) {
      const parsed = parseStepGroups(definition);
      loopGroup = flattenUnique(parsed.length ? parsed : agentKeys.map((key) => [key]));
    }

    prefixSteps.forEach(addStep);

    const loopVar = "loop_agent";
    const loopAgents = loopGroup.map((key) => agentVarMap[key]).join(", ");
    const maxIterations = orchestrationConfig?.turnCount ? parseNumber(orchestrationConfig.turnCount) : null;
    const loopLines = [
      `${loopVar} = LoopAgent(`,
      `  name=${toPythonLiteral("LoopAgent")},`,
      `  sub_agents=[${loopAgents}],`,
    ];
    if (maxIterations !== null && maxIterations !== undefined && !Number.isNaN(maxIterations)) {
      loopLines.push(`  max_iterations=${maxIterations},`);
    }
    loopLines.push(")", "");
    orchestrationLines.push(...loopLines);
    pipelineVars.push(loopVar);

    suffixSteps.forEach(addStep);
  } else {
    let steps = parseStepGroups(definition);
    if (!steps.length) {
      if (orchestrationType === "Parallel") {
        steps = [agentKeys];
      } else {
        steps = agentKeys.map((key) => [key]);
      }
    }
    steps.forEach(addStep);
  }

  if (pipelineVars.length === 1) {
    orchestrationLines.push(`root_agent = ${pipelineVars[0]}`);
  } else {
    orchestrationLines.push(
      "root_agent = SequentialAgent(",
      `  name=${toPythonLiteral("RootWorkflow")},`,
      `  sub_agents=[${pipelineVars.join(", ")}],`,
      ")"
    );
  }

  orchestrationLines.push("", "# runner = Runner(agent=root_agent, session_service=InMemorySessionService(), app_name=\"gear-ui\")");

  return [...importLines, ...agentLines, ...orchestrationLines].join("\n").trim();
};

const updateOrchestrationWarnings = (config) => {
  if (!orchestrationWarnings) {
    return;
  }
  const warnings = [];
  const definition = config.definition || "";
  const hasParallelSymbol = /\|/.test(definition);
  const hasLoopSymbol = /[()]/.test(definition);

  if (config.type === "Parallel" || hasParallelSymbol) {
    warnings.push("Parallel non supporté en CrewAI Lite → process inchangé (sequential)." );
    if (config.aggregator) {
      warnings.push("Aggregator non supporté en CrewAI Lite.");
    }
  }
  if (config.type === "Loop" || hasLoopSymbol) {
    warnings.push("Loop non supporté en CrewAI Lite → process inchangé (sequential)." );
    if (config.turnCount) {
      warnings.push("TurnCount non supporté en CrewAI Lite.");
    }
  }
  if (config.rootAgent) {
    warnings.push("RootAgent non supporté en CrewAI Lite (ManagerAgent hiérarchique requis).");
  }

  if (warnings.length) {
    orchestrationWarnings.innerHTML = `<ul><li>${warnings.join("</li><li>")}</li></ul>`;
    orchestrationWarnings.classList.add("is-visible");
  } else {
    orchestrationWarnings.textContent = "";
    orchestrationWarnings.classList.remove("is-visible");
  }
};

const ensureKey = (value, prefix, index) => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length ? trimmed : `${prefix}_${index}`;
};

const getField = (container, name) => container.querySelector(`[data-field="${name}"]`);

const getMode = (card) => {
  const checked = card.querySelector("input[data-field=\"agentMode\"]:checked");
  return checked?.value || "form";
};

const parseGearYaml = (yamlText) => {
  if (!yamlText || yamlText.trim() === "") {
    return { data: null, error: null, empty: true };
  }
  try {
    const parsed = jsyaml.load(yamlText);
    if (!parsed || typeof parsed !== "object") {
      return { data: null, error: "YAML invalide.", empty: false };
    }
    return { data: parsed, error: null, empty: false };
  } catch (error) {
    return { data: null, error: "YAML invalide.", empty: false };
  }
};

const gearYamlToData = (gear) => {
  const identity = gear?.AgentIdentity || {};
  const llm = gear?.LLMConfiguration || {};
  const api = llm?.APIConfiguration || {};
  const params = llm?.ModelParameters || {};
  const task = gear?.TaskSpecification || {};
  const exec = gear?.ExecutionControl || {};
  const modelRaw = llm.Model || "";
  let llmProvider = DEFAULT_LLM_PROVIDER;
  let model = modelRaw;
  if (typeof modelRaw === "string" && modelRaw.includes(":")) {
    const [prefix, ...rest] = modelRaw.split(":");
    const candidate = prefix.toLowerCase();
    if (LLM_PROVIDER_OPTIONS.includes(candidate)) {
      llmProvider = candidate;
      model = rest.join(":");
    }
  }
  const hasAdvanced =
    api.Timeout !== undefined ||
    api.MaxRetries !== undefined ||
    params.Temperature !== undefined ||
    params.MaxTokens !== undefined ||
    params.TopP !== undefined ||
    params.StopSequences !== undefined ||
    params.TopK !== undefined ||
    params.FrequencyPenalty !== undefined ||
    params.PresencePenalty !== undefined ||
    params.Seed !== undefined ||
    params.AdditionalParams !== undefined;

  const expectedOutput =
    task.ExpectedOutput ??
    task.Expected_output ??
    task.expected_output ??
    task.Expectedoutput ??
    "";

  return {
    name: identity.Name || "",
    purpose: identity.Purpose || "",
    contextDescription: identity.ContextDescription || "",
    model: model || "",
    llmProvider,
    showAdvancedLlm: hasAdvanced,
    timeout: api.Timeout ?? "",
    maxRetries: api.MaxRetries ?? "",
    temperature: params.Temperature ?? "",
    maxTokens: params.MaxTokens ?? "",
    topP: params.TopP ?? "",
    stopSequences: Array.isArray(params.StopSequences) ? params.StopSequences.join(", ") : "",
    topK: params.TopK ?? "",
    frequencyPenalty: params.FrequencyPenalty ?? "",
    presencePenalty: params.PresencePenalty ?? "",
    seed: params.Seed ?? "",
    additionalParams: params.AdditionalParams ? JSON.stringify(params.AdditionalParams, null, 2) : "",
    taskName: task.TaskName || "",
    taskDescription: task.TaskDescription || "",
    expectedOutput: expectedOutput || "",
    assignedAgent: task.AssignedAgent || "",
    tools: Array.isArray(gear.Tools) ? gear.Tools.join(", ") : "",
    delegationControl: Boolean(exec.DelegationControl),
    codeExecutionControl: Boolean(exec.CodeExecutionControl),
    asyncExecutionControl: Boolean(exec.AsyncExecutionControl),
    humanInteractionControl: Boolean(exec.HumanInteractionControl),
    verbosityControl: Boolean(exec.VerbosityControl),
    cachingControl: exec.CachingControl ?? true,
    memory: Boolean(gear.Memory),
    reasoning: Boolean(gear.Reasoning),
    
  };
};

const getAgentData = (card) => {
  const getValue = (name) => getField(card, name)?.value || "";
  const getChecked = (name) => Boolean(getField(card, name)?.checked);

  return {
    name: getValue("name"),
    purpose: getValue("purpose"),
    contextDescription: getValue("contextDescription"),
    model: getValue("model"),
    llmProvider: getValue("llmProvider") || DEFAULT_LLM_PROVIDER,
    showAdvancedLlm: getChecked("showAdvancedLlm"),
    timeout: getValue("timeout"),
    maxRetries: getValue("maxRetries"),
    temperature: getValue("temperature"),
    maxTokens: getValue("maxTokens"),
    topP: getValue("topP"),
    stopSequences: getValue("stopSequences"),
    topK: getValue("topK"),
    frequencyPenalty: getValue("frequencyPenalty"),
    presencePenalty: getValue("presencePenalty"),
    seed: getValue("seed"),
    additionalParams: getValue("additionalParams"),
    taskName: getValue("taskName"),
    taskDescription: getValue("taskDescription"),
    expectedOutput: getValue("expectedOutput"),
    assignedAgent: getValue("assignedAgent"),
    tools: getValue("tools"),
    delegationControl: getChecked("delegationControl"),
    codeExecutionControl: getChecked("codeExecutionControl"),
    asyncExecutionControl: getChecked("asyncExecutionControl"),
    humanInteractionControl: getChecked("humanInteractionControl"),
    verbosityControl: getChecked("verbosityControl"),
    cachingControl: getChecked("cachingControl"),
    memory: getChecked("memory"),
    reasoning: getChecked("reasoning"),
  };
};

const setFieldValue = (card, name, value) => {
  const field = getField(card, name);
  if (!field) {
    return;
  }
  if (field.type === "checkbox") {
    field.checked = Boolean(value);
    return;
  }
  field.value = value ?? "";
};

const updateFormFromData = (card, data) => {
  setFieldValue(card, "name", data.name);
  setFieldValue(card, "purpose", data.purpose);
  setFieldValue(card, "contextDescription", data.contextDescription);
  setFieldValue(card, "model", data.model);
  setFieldValue(card, "llmProvider", data.llmProvider || DEFAULT_LLM_PROVIDER);
  setFieldValue(card, "showAdvancedLlm", data.showAdvancedLlm);
  setFieldValue(card, "timeout", data.timeout);
  setFieldValue(card, "maxRetries", data.maxRetries);
  setFieldValue(card, "temperature", data.temperature);
  setFieldValue(card, "maxTokens", data.maxTokens);
  setFieldValue(card, "topP", data.topP);
  setFieldValue(card, "stopSequences", data.stopSequences);
  setFieldValue(card, "topK", data.topK);
  setFieldValue(card, "frequencyPenalty", data.frequencyPenalty);
  setFieldValue(card, "presencePenalty", data.presencePenalty);
  setFieldValue(card, "seed", data.seed);
  setFieldValue(card, "additionalParams", data.additionalParams);
  setFieldValue(card, "taskName", data.taskName);
  setFieldValue(card, "taskDescription", data.taskDescription);
  setFieldValue(card, "expectedOutput", data.expectedOutput);
  setFieldValue(card, "assignedAgent", data.assignedAgent);
  setFieldValue(card, "tools", data.tools);
  setFieldValue(card, "delegationControl", data.delegationControl);
  setFieldValue(card, "codeExecutionControl", data.codeExecutionControl);
  setFieldValue(card, "asyncExecutionControl", data.asyncExecutionControl);
  setFieldValue(card, "humanInteractionControl", data.humanInteractionControl);
  setFieldValue(card, "verbosityControl", data.verbosityControl);
  setFieldValue(card, "cachingControl", data.cachingControl ?? true);
  setFieldValue(card, "memory", data.memory);
  setFieldValue(card, "reasoning", data.reasoning);
  card.classList.toggle("show-llm-advanced", Boolean(data.showAdvancedLlm));
};

const getAgentPayload = (card) => {
  const mode = getMode(card);
  const yamlError = getField(card, "yamlError");
  if (mode === "yaml") {
    const yamlText = getField(card, "gearYaml")?.value || "";
    const { data, error, empty } = parseGearYaml(yamlText);
    if (yamlError) {
      yamlError.textContent = error || "";
    }
    if (empty) {
      return { data: null, mode, error: null };
    }
    if (error) {
      return { data: null, mode, error };
    }
    return { data: gearYamlToData(data), mode, error: null };
  }
  if (yamlError) {
    yamlError.textContent = "";
  }
  return { data: getAgentData(card), mode, error: null };
};

const updateAgentTitles = () => {
  const cards = Array.from(agentsContainer.querySelectorAll(".agent-card"));
  cards.forEach((card, index) => {
    const title = card.querySelector(".agent-title");
    let name = getField(card, "name")?.value?.trim();
    if (getMode(card) === "yaml") {
      const yamlText = getField(card, "gearYaml")?.value || "";
      const parsed = parseGearYaml(yamlText);
      name = parsed.data?.AgentIdentity?.Name || "";
      title.textContent = name ? `— ${name}` : parsed.error ? "(yaml invalide)" : "(nouvel agent)";
    } else {
      title.textContent = name ? `— ${name}` : "(nouvel agent)";
    }
    card.querySelector(".agent-index").textContent = index + 1;
  });
};

const updateOrchestrationVisibility = () => {
  if (!orchestrationPanel || !orchestrationTypeSelect) {
    return;
  }
  const mode = orchestrationTypeSelect.value || "Sequential";
  orchestrationPanel.dataset.mode = mode;
};

const refreshRootAgentOptions = (agentsData) => {
  if (!orchestrationRootAgent) {
    return;
  }
  const previousValue = orchestrationRootAgent.value;
  const options = [{ value: "", label: "(aucun)" }];

  agentsData.forEach((data, index) => {
    const label = data?.name?.trim() || `Agent ${index + 1}`;
    const value = label;
    options.push({ value, label });
  });

  orchestrationRootAgent.innerHTML = "";
  options.forEach((option) => {
    const item = document.createElement("option");
    item.value = option.value;
    item.textContent = option.label;
    orchestrationRootAgent.appendChild(item);
  });

  if (options.some((option) => option.value === previousValue)) {
    orchestrationRootAgent.value = previousValue;
  }
};

const refreshOrchestrationAgentTokens = (agentsData) => {
  if (!orchestrationAgents) {
    return;
  }
  orchestrationAgents.innerHTML = "";
  agentsData.forEach((data, index) => {
    const label = data?.name?.trim() || `Agent ${index + 1}`;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "token-button";
    button.dataset.token = `${label} `;
    button.textContent = label;
    button.addEventListener("click", () => insertToken(button.dataset.token));
    orchestrationAgents.appendChild(button);
  });
};

const insertToken = (token) => {
  if (!orchestrationEditor) {
    return;
  }
  const start = orchestrationEditor.selectionStart ?? orchestrationEditor.value.length;
  const end = orchestrationEditor.selectionEnd ?? orchestrationEditor.value.length;
  const value = orchestrationEditor.value;
  orchestrationEditor.value = `${value.slice(0, start)}${token}${value.slice(end)}`;
  orchestrationEditor.focus();
  const cursor = start + token.length;
  orchestrationEditor.selectionStart = cursor;
  orchestrationEditor.selectionEnd = cursor;
  updateOutput();
};

const removeLastToken = () => {
  if (!orchestrationEditor) {
    return;
  }
  const value = orchestrationEditor.value;
  if (!value.trim()) {
    return;
  }
  const updated = value.replace(/\s*\S+\s*$/, "");
  orchestrationEditor.value = updated;
  orchestrationEditor.focus();
  updateOutput();
};

const getOrchestrationConfig = () => {
  return {
    type: orchestrationTypeSelect?.value || "Sequential",
    turnCount: parseNumber(orchestrationTurnCount?.value ?? ""),
    aggregator: orchestrationAggregator?.value?.trim() || "",
    rootAgent: orchestrationRootAgent?.value || "",
    memory: Boolean(orchestrationMemory?.checked),
    definition: orchestrationEditor?.value?.trim() || "",
  };
};

const updateOutput = () => {
  const cards = Array.from(agentsContainer.querySelectorAll(".agent-card"));
  const agentsData = cards
    .map(getAgentPayload)
    .map((payload) => payload.data)
    .filter(Boolean);
  updateAgentTitles();
  refreshRootAgentOptions(agentsData);
  refreshOrchestrationAgentTokens(agentsData);
  updateOrchestrationVisibility();

  const agentsPayload = {};
  const tasksPayload = {};
  const tasksYamlPayload = {};
  const adkAgentsPayload = {};

  agentsData.forEach((data, index) => {
    const agentKey = ensureKey(data.name, "agent", index + 1);
    const taskKey = ensureKey(data.taskName, "task", index + 1);
    agentsPayload[agentKey] = buildCrewaiAgentConfig(data);
    tasksPayload[taskKey] = buildCrewaiTaskConfig(data, agentKey);
    const yamlTask = { ...tasksPayload[taskKey] };
    if (data.taskName) {
      yamlTask.name = data.taskName;
    }
    tasksYamlPayload[taskKey] = yamlTask;
    adkAgentsPayload[agentKey] = buildAdkAgentConfig(data);
  });

  const yamlOptions = { noRefs: true, lineWidth: -1 };
  const agentsYaml = jsyaml.dump(agentsPayload, yamlOptions).trim();
  const tasksYaml = jsyaml.dump(tasksYamlPayload, yamlOptions).trim();
  const combinedYaml = jsyaml.dump({ agents: agentsPayload, tasks: tasksYamlPayload }, yamlOptions).trim();
  const orchestrationConfig = getOrchestrationConfig();
  const orchestrationCode = buildCrewaiOrchestration(agentsPayload, tasksPayload, orchestrationConfig);
  const adkAgentsYaml = jsyaml.dump(adkAgentsPayload, yamlOptions).trim();
  const adkOrchestrationYaml = buildAdkOrchestration(agentsData, orchestrationConfig);
  updateOrchestrationWarnings(orchestrationConfig);

  outputCrewaiAgents.textContent = agentsYaml;
  outputCrewaiTasks.textContent = tasksYaml;
  outputCrewaiCombined.textContent = combinedYaml;
  outputCrewaiOrchestration.textContent = orchestrationCode;
  outputCrewaiOrchestrationCombined.textContent = orchestrationCode;
  if (outputAdkAgents) {
    outputAdkAgents.textContent = adkAgentsYaml;
  }
  if (outputAdkOrchestration) {
    outputAdkOrchestration.textContent = adkOrchestrationYaml;
  }
  if (outputAdkCombined) {
    outputAdkCombined.textContent = adkAgentsYaml;
  }
};

const copyOutput = async (element, button, label) => {
  await navigator.clipboard.writeText(element.textContent);
  if (button.classList.contains("icon-button")) {
    return;
  }
  button.textContent = "Copié ✔";
  setTimeout(() => {
    button.textContent = label;
  }, 1500);
};

const downloadOutput = (element, filename) => {
  const blob = new Blob([element.textContent], { type: "text/yaml" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const parseInputs = (value) => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return {};
  }
  const parsed = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Les inputs doivent être un objet JSON.");
  }
  return parsed;
};

const setOrchestrationStatus = (message, isError = false) => {
  if (!orchestrationStatus) {
    return;
  }
  orchestrationStatus.textContent = message;
  orchestrationStatus.style.color = isError ? "#b91c1c" : "";
};

const setAdkOrchestrationStatus = (message, isError = false) => {
  if (!adkOrchestrationStatus) {
    return;
  }
  adkOrchestrationStatus.textContent = message;
  adkOrchestrationStatus.style.color = isError ? "#b91c1c" : "";
};

const runOrchestration = async () => {
  if (!runOrchestrationButton || !orchestrationRunOutput) {
    return;
  }
  const code = outputCrewaiOrchestrationCombined.textContent.trim();
  if (!code) {
    setOrchestrationStatus("Aucune orchestration à exécuter.", true);
    return;
  }

  let inputs = {};
  try {
    inputs = parseInputs(orchestrationInputsField?.value || "");
  } catch (error) {
    setOrchestrationStatus(error.message || "Inputs JSON invalide.", true);
    return;
  }

  runOrchestrationButton.disabled = true;
  orchestrationRunOutput.textContent = "";
  setOrchestrationStatus("Exécution en cours...");

  try {
    const response = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, inputs }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Erreur lors de l'exécution.");
    }

    const stdout = payload.stdout ?? "";
    const stderr = payload.stderr ?? "";
    const returnCode = payload.returncode ?? "";
    orchestrationRunOutput.textContent =
      `--- STDOUT ---\n${stdout}\n\n` +
      `--- STDERR ---\n${stderr}\n\n` +
      `--- CODE DE SORTIE ---\n${returnCode}\n`;
    const hasError = payload.returncode !== 0 || Boolean(payload.stderr);
    setOrchestrationStatus(hasError ? "Exécution terminée avec erreurs." : "Exécution terminée.", hasError);
  } catch (error) {
    setOrchestrationStatus(error.message || "Erreur lors de l'exécution.", true);
  } finally {
    runOrchestrationButton.disabled = false;
  }
};

const runAdkOrchestration = async () => {
  if (!runAdkOrchestrationButton || !adkOrchestrationRunOutput) {
    return;
  }
  const code = outputAdkOrchestration?.textContent?.trim() || "";
  if (!code) {
    setAdkOrchestrationStatus("Aucune orchestration à exécuter.", true);
    return;
  }

  let inputs = {};
  try {
    inputs = parseInputs(adkOrchestrationInputsField?.value || "");
  } catch (error) {
    setAdkOrchestrationStatus(error.message || "Inputs JSON invalide.", true);
    return;
  }

  const prompt = typeof inputs.prompt === "string" && inputs.prompt.trim()
    ? inputs.prompt.trim()
    : JSON.stringify(inputs || "");

  const runSnippet = [
    "",
    "runner = Runner(agent=root_agent, session_service=InMemorySessionService(), memory_service=(memory_service if \"memory_service\" in globals() else None), app_name=\"gear-ui\")",
    "import asyncio",
    "async def _run():",
    `    return await runner.run_debug(${toPythonLiteral(prompt)})`,
    "result = asyncio.run(_run())",
    "print(result)",
  ].join("\n");

  const fullCode = `${code}\n${runSnippet}`;

  runAdkOrchestrationButton.disabled = true;
  adkOrchestrationRunOutput.textContent = "";
  if (adkOrchestrationRunCode) {
    adkOrchestrationRunCode.textContent = fullCode;
  }
  setAdkOrchestrationStatus("Exécution en cours...");

  try {
    const response = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: fullCode, inputs: { prompt }, target: "adk" }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Erreur lors de l'exécution.");
    }

    const stdout = payload.stdout ?? "";
    const stderr = payload.stderr ?? "";
    const returnCode = payload.returncode ?? "";
    adkOrchestrationRunOutput.textContent =
      `--- STDOUT ---\n${stdout}\n\n` +
      `--- STDERR ---\n${stderr}\n\n` +
      `--- CODE DE SORTIE ---\n${returnCode}\n`;
    const hasError = payload.returncode !== 0 || Boolean(payload.stderr);
    setAdkOrchestrationStatus(hasError ? "Exécution terminée avec erreurs." : "Exécution terminée.", hasError);
  } catch (error) {
    setAdkOrchestrationStatus(error.message || "Erreur lors de l'exécution.", true);
  } finally {
    runAdkOrchestrationButton.disabled = false;
  }
};

const getCopySourceByTarget = (target) => {
  switch (target) {
    case "agents":
      return outputCrewaiAgents;
    case "tasks":
      return outputCrewaiTasks;
    case "orchestration":
      return outputCrewaiOrchestration;
    case "adk-agents":
      return outputAdkAgents;
    case "adk-orchestration":
      return outputAdkOrchestration;
    default:
      return outputCrewaiCombined;
  }
};

const createAgentCard = () => {
  const fragment = agentTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".agent-card");
  const removeButton = fragment.querySelector(".remove-agent");
  const duplicateButton = fragment.querySelector(".duplicate-agent");
  const modeInputs = fragment.querySelectorAll("input[data-field=\"agentMode\"]");
  const advancedToggle = fragment.querySelector("input[data-field=\"showAdvancedLlm\"]");
  const yamlField = fragment.querySelector("[data-field=\"gearYaml\"]");
  agentCounter += 1;
  const modeName = `agentMode-${agentCounter}`;
  modeInputs.forEach((input) => {
    input.name = modeName;
  });

  removeButton.addEventListener("click", (event) => {
    event.preventDefault();
    const cards = agentsContainer.querySelectorAll(".agent-card");
    if (cards.length <= 1) {
      return;
    }
    card.remove();
    updateOutput();
  });

  if (duplicateButton) {
    duplicateButton.addEventListener("click", (event) => {
      event.preventDefault();
      const mode = getMode(card);
      const newCard = createAgentCard();
      if (!newCard) {
        return;
      }

      const setMode = () => {
        const targetInput = newCard.querySelector(
          `input[data-field="agentMode"][value="${mode}"]`
        );
        if (targetInput) {
          targetInput.checked = true;
        }
        newCard.classList.toggle("is-yaml", mode === "yaml");
        const tabItems = newCard.querySelectorAll(".segmented-item");
        tabItems.forEach((item) => {
          const radio = item.querySelector("input[data-field=\"agentMode\"]");
          item.setAttribute("aria-selected", radio?.checked ? "true" : "false");
        });
      };

      if (mode === "yaml") {
        const yamlText = getField(card, "gearYaml")?.value || "";
        setMode();
        newCard.dataset.syncing = "true";
        const targetYaml = getField(newCard, "gearYaml");
        if (targetYaml) {
          targetYaml.value = yamlText;
        }
        newCard.dataset.syncing = "false";
      } else {
        const data = getAgentData(card);
        setMode();
        updateFormFromData(newCard, data);
        const targetYaml = getField(newCard, "gearYaml");
        if (targetYaml) {
          targetYaml.value = buildGearYamlFromData(data);
        }
      }

      updateOutput();
    });
  }

  modeInputs.forEach((input) => {
    input.addEventListener("change", () => {
      card.classList.toggle("is-yaml", getMode(card) === "yaml");
      const tabItems = card.querySelectorAll(".segmented-item");
      tabItems.forEach((item) => {
        const radio = item.querySelector("input[data-field=\"agentMode\"]");
        item.setAttribute("aria-selected", radio?.checked ? "true" : "false");
      });
      updateOutput();
    });
  });

  if (advancedToggle) {
    advancedToggle.addEventListener("change", () => {
      card.classList.toggle("show-llm-advanced", advancedToggle.checked);
      updateOutput();
    });
  }

  const syncFormToYaml = () => {
    if (card.dataset.syncing === "true") {
      return;
    }
    const data = getAgentData(card);
    const yamlText = buildGearYamlFromData(data);
    card.dataset.syncing = "true";
    if (yamlField) {
      yamlField.value = yamlText;
    }
    card.dataset.syncing = "false";
  };

  const syncYamlToForm = () => {
    if (card.dataset.syncing === "true") {
      return;
    }
    const yamlText = yamlField?.value || "";
    const parsed = parseGearYaml(yamlText);
    if (parsed.error || parsed.empty || !parsed.data) {
      return;
    }
    const data = gearYamlToData(parsed.data);
    card.dataset.syncing = "true";
    updateFormFromData(card, data);
    card.dataset.syncing = "false";
  };

  card.querySelectorAll("input, textarea").forEach((input) => {
    if (input.dataset.field === "gearYaml") {
      input.addEventListener("input", () => {
        syncYamlToForm();
        updateOutput();
      });
      input.addEventListener("change", () => {
        syncYamlToForm();
        updateOutput();
      });
      return;
    }
    input.addEventListener("input", () => {
      syncFormToYaml();
      updateOutput();
    });
    input.addEventListener("change", () => {
      syncFormToYaml();
      updateOutput();
    });
  });

  agentsContainer.appendChild(fragment);
  card.classList.toggle("is-yaml", getMode(card) === "yaml");
  if (advancedToggle?.checked) {
    card.classList.add("show-llm-advanced");
  }
  const tabItems = card.querySelectorAll(".segmented-item");
  tabItems.forEach((item) => {
    const radio = item.querySelector("input[data-field=\"agentMode\"]");
    item.setAttribute("aria-selected", radio?.checked ? "true" : "false");
  });
  if (yamlField) {
    yamlField.value = buildGearYamlFromData(getAgentData(card));
  }
  updateOutput();
  return card;
};

const loadBindingTable = async () => {
  try {
    const response = await fetch("../conversion_table.yml");
    if (!response.ok) {
      throw new Error("Conversion table not found");
    }
    const yamlText = await response.text();
    const parsed = jsyaml.load(yamlText) || {};
    bindingTable = parsed?.mapping
      ? parsed
      : { mapping: parsed || fallbackMapping, mapping_adk: {} };
  } catch (error) {
    bindingTable = { mapping: fallbackMapping, mapping_adk: {} };
  }
  renderMappingBadges();
  updateOutput();
};

const outputTabs = document.querySelectorAll("[data-output-tab]");
const outputPanels = document.querySelectorAll("[data-output-panel]");
const adkOutputTabs = document.querySelectorAll("[data-adk-output-tab]");
const adkOutputPanels = document.querySelectorAll("[data-adk-output-panel]");
const targetTabs = document.querySelectorAll("[data-target-tab]");
const targetPanels = document.querySelectorAll("[data-target-panel]");

const getActiveTarget = () => {
  return document.querySelector("[data-target-panel].is-active")?.dataset.targetPanel || "crewai";
};

const updateTargetActions = () => {
  const isCrewai = getActiveTarget() === "crewai";
  if (copyCrewaiButton) {
    copyCrewaiButton.disabled = false;
    copyCrewaiButton.textContent = isCrewai
      ? copyCrewaiButton.dataset.labelCrewai
      : copyCrewaiButton.dataset.labelAdk;
  }
  if (downloadCrewaiButton) {
    downloadCrewaiButton.disabled = false;
    downloadCrewaiButton.textContent = isCrewai
      ? downloadCrewaiButton.dataset.labelCrewai
      : downloadCrewaiButton.dataset.labelAdk;
  }
};

const setTargetTab = (tabName) => {
  targetPanels.forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.targetPanel === tabName);
  });
  targetTabs.forEach((tab) => {
    const isActive = tab.dataset.targetTab === tabName;
    tab.setAttribute("aria-selected", isActive ? "true" : "false");
    const radio = tab.querySelector("input");
    if (radio) {
      radio.checked = isActive;
    }
  });
  updateTargetActions();
};

const setOutputTab = (tabName) => {
  outputPanels.forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.outputPanel === tabName);
  });
  outputTabs.forEach((tab) => {
    const isActive = tab.dataset.outputTab === tabName;
    tab.setAttribute("aria-selected", isActive ? "true" : "false");
    const radio = tab.querySelector("input");
    if (radio) {
      radio.checked = isActive;
    }
  });
};

const setAdkOutputTab = (tabName) => {
  adkOutputPanels.forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.adkOutputPanel === tabName);
  });
  adkOutputTabs.forEach((tab) => {
    const isActive = tab.dataset.adkOutputTab === tabName;
    tab.setAttribute("aria-selected", isActive ? "true" : "false");
    const radio = tab.querySelector("input");
    if (radio) {
      radio.checked = isActive;
    }
  });
};

outputTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    setOutputTab(tab.dataset.outputTab);
  });
});

adkOutputTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    setAdkOutputTab(tab.dataset.adkOutputTab);
  });
});

targetTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    setTargetTab(tab.dataset.targetTab);
  });
});

addAgentButton.addEventListener("click", createAgentCard);
copyCrewaiButton.addEventListener("click", () => {
  const isCrewai = getActiveTarget() === "crewai";
  if (isCrewai) {
    const activePanel = document.querySelector("[data-output-panel].is-active");
    const isOrchestration = activePanel?.dataset.outputPanel === "orchestration";
    const source = isOrchestration ? outputCrewaiOrchestrationCombined : outputCrewaiCombined;
    const label = isOrchestration ? "Copier orchestration" : "Copier CrewAI";
    copyOutput(source, copyCrewaiButton, label);
    return;
  }
  const activePanel = document.querySelector("[data-adk-output-panel].is-active");
  const isOrchestration = activePanel?.dataset.adkOutputPanel === "orchestration";
  const source = isOrchestration ? outputAdkOrchestration : outputAdkCombined;
  const label = isOrchestration ? "Copier orchestration" : "Copier ADK";
  copyOutput(source, copyCrewaiButton, label);
});
downloadCrewaiButton.addEventListener("click", () => {
  const isCrewai = getActiveTarget() === "crewai";
  if (isCrewai) {
    const activePanel = document.querySelector("[data-output-panel].is-active");
    const isOrchestration = activePanel?.dataset.outputPanel === "orchestration";
    if (isOrchestration) {
      downloadOutput(outputCrewaiOrchestrationCombined, "crewai_orchestration.py");
      return;
    }
    downloadOutput(outputCrewaiCombined, "crewai_agents.yml");
    return;
  }
  const activePanel = document.querySelector("[data-adk-output-panel].is-active");
  const isOrchestration = activePanel?.dataset.adkOutputPanel === "orchestration";
  if (isOrchestration) {
    downloadOutput(outputAdkOrchestration, "adk_orchestration.yml");
    return;
  }
  downloadOutput(outputAdkCombined, "adk_agents.yml");
});

if (runOrchestrationButton) {
  runOrchestrationButton.addEventListener("click", runOrchestration);
}

if (runAdkOrchestrationButton) {
  runAdkOrchestrationButton.addEventListener("click", runAdkOrchestration);
}

if (removeOrchestrationToken) {
  removeOrchestrationToken.addEventListener("click", removeLastToken);
}

if (clearOrchestrationEditor) {
  clearOrchestrationEditor.addEventListener("click", () => {
    if (orchestrationEditor) {
      orchestrationEditor.value = "";
    }
    updateOutput();
  });
}

const orchestrationInputs = [
  orchestrationTypeSelect,
  orchestrationTurnCount,
  orchestrationAggregator,
  orchestrationRootAgent,
  orchestrationMemory,
  orchestrationEditor,
].filter(Boolean);

orchestrationInputs.forEach((input) => {
  input.addEventListener("input", updateOutput);
  input.addEventListener("change", () => {
    if (input === orchestrationTypeSelect) {
      updateOrchestrationVisibility();
    }
    updateOutput();
  });
});

document.querySelectorAll(".token-button[data-token]").forEach((button) => {
  button.addEventListener("click", () => insertToken(button.dataset.token));
});

copyIconButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const target = button.dataset.copyTarget;
    const source = getCopySourceByTarget(target);
    copyOutput(source, button, "");
    button.classList.add("is-copied");
    setTimeout(() => {
      button.classList.remove("is-copied");
    }, 1200);
  });
});

loadBindingTable();
createAgentCard();
setOutputTab("agents");
setAdkOutputTab("agents");
setTargetTab("crewai");
