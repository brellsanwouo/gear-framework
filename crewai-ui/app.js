const agentsContainer = document.getElementById("agentsContainer");
const agentTemplate = document.getElementById("agentTemplate");
const addAgentButton = document.getElementById("addAgent");
const outputCrewai = document.getElementById("outputCrewai");
const outputAdk = document.getElementById("outputAdk");
const copyCrewaiButton = document.getElementById("copyCrewai");
const downloadCrewaiButton = document.getElementById("downloadCrewai");
const copyAdkButton = document.getElementById("copyAdk");
const downloadAdkButton = document.getElementById("downloadAdk");
const mappingSummary = document.getElementById("mappingSummary");

let bindingTable = null;

const fallbackMapping = {
  agent_identity: {
    name: { crewai: "Identity.Role", adk: "BaseAgent.Name" },
    purpose: { crewai: "Identity.Goal", adk: "Configurations.Instruction" },
    context_description: { crewai: "Identity.Backstory", adk: "BaseAgent.Description" },
  },
  llm_configuration: {
    model: { crewai: "LLMConfiguration.Model", adk: "LLMAgentConfig.Model" },
    model_parameters: {
      temperature: {
        crewai: "LLMConfiguration.Advanced_configs.Temperature",
        adk: "LLMAgentConfig.GenerateContentConfig.Temperature",
      },
      max_tokens: {
        crewai: "LLMConfiguration.Advanced_configs.MaxTokens",
        adk: "LLMAgentConfig.GenerateContentConfig.MaxOutputTokens",
      },
      top_p: { crewai: "LLMConfiguration.Advanced_configs.Top_p", adk: "LLMAgentConfig.GenerateContentConfig.TopP" },
      stop_sequences: { crewai: "LLMConfiguration.Advanced_configs.Stop", adk: "Model-level configuration" },
      frequency_penalty: { crewai: "LLMConfiguration.Advanced_configs.FrequencyPenalty", adk: "Default (not exposed)" },
      presence_penalty: { crewai: "LLMConfiguration.Advanced_configs.PresencePenalty", adk: "Default (not exposed)" },
      seed: { crewai: "LLMConfiguration.Advanced_configs.Seed", adk: "Default (determinism via config)" },
    },
    api_configuration: {
      api_key: { crewai: "LLMConfiguration.API_KEY", adk: "Project-level environment configuration" },
      timeout: { crewai: "LLMConfiguration.Advanced_configs.Timeout", adk: "System-level timeout" },
      max_retries: { crewai: "LLMConfiguration.Advanced_configs.MaxRetries", adk: "Retry logic in guardrails" },
    },
    safety_configuration: { crewai: "Task.ValidationAndSafety.Guardrail", adk: "LLMAgentConfig.GenerateContentConfig.SafetySettings" },
  },
  instruction_definition: {
    task_specification: {
      task_name: { crewai: "Task.Essential.Name", adk: "BaseAgent.Name" },
      task_description: { crewai: "Task.Essential.Description", adk: "Configurations.Instruction" },
      expected_output: { crewai: "Task.Essential.ExpectedOutput", adk: "Configurations.DataStructure.OutputSchema" },
    },
  },
  tools: {
    tool_scope: {
      agent_level_tools: { crewai: "Agent_Tools", adk: "Configurations.Tools" },
      task_level_tools: { crewai: "Task.Execution.Task_Tools", adk: "Configurations.Tools" },
    },
  },
  execution_control: {
    delegation_control: { crewai: "BehavioralControls.AllowDelegation", adk: "BaseAgent.SubAgents" },
    code_execution_control: { crewai: "BehavioralControls.AllowCodeExecution", adk: "Configurations.CodeExecutor" },
    async_execution_control: { crewai: "Task.Execution.AsyncExecution", adk: "BaseAgent.AgentType" },
    human_interaction_control: { crewai: "Task.Execution.HumanInput", adk: "Custom function tool" },
    verbosity_control: { crewai: "BehavioralControls.Verbose", adk: "Logging configuration" },
    caching_control: { crewai: "BehavioralControls.Cache", adk: "System-level caching" },
  },
  memory_system: {
    short_term_memory: { crewai: "Memory.True_Memory.ShortTermMemory", adk: "State management (implicit)" },
    long_term_memory: { crewai: "Memory.True_Memory.LongTermMemory", adk: "External storage" },
    entity_memory: { crewai: "Memory.True_Memory.EntityMemory", adk: "Custom state tracking" },
    contextual_memory: { crewai: "Memory.True_Memory.ContextualMemory", adk: "Configurations.IncludeContents" },
  },
  guardrails_and_validation: {
    validation_rules: {
      guardrail_max_retries: { crewai: "Task.ValidationAndSafety.GuardrailMaxRetries", adk: "Custom retry logic" },
    },
  },
};

const mappingKeys = [
  "agent_identity.name",
  "agent_identity.purpose",
  "agent_identity.context_description",
  "agent_type.single_agent",
  "llm_configuration.model",
  "llm_configuration.model_parameters.temperature",
  "llm_configuration.model_parameters.max_tokens",
  "llm_configuration.model_parameters.top_p",
  "llm_configuration.model_parameters.stop_sequences",
  "llm_configuration.model_parameters.frequency_penalty",
  "llm_configuration.model_parameters.presence_penalty",
  "llm_configuration.model_parameters.seed",
  "llm_configuration.api_configuration.api_key",
  "llm_configuration.api_configuration.timeout",
  "llm_configuration.api_configuration.max_retries",
  "llm_configuration.safety_configuration",
  "instruction_definition.task_specification.task_name",
  "instruction_definition.task_specification.task_description",
  "instruction_definition.task_specification.expected_output",
  "tools.tool_scope.agent_level_tools",
  "tools.tool_scope.task_level_tools",
  "guardrails_and_validation.validation_rules.guardrail_max_retries",
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

const setIf = (target, key, value) => {
  if (value === null || value === "" || value === undefined) {
    return;
  }
  target[key] = value;
};

const getMappingPath = (key, framework) => {
  if (!bindingTable) {
    return null;
  }
  const parts = key.split(".");
  let current = bindingTable;
  for (const part of parts) {
    current = current?.[part];
  }
  return current?.[framework] || null;
};

const renderMappingBadges = () => {
  document.querySelectorAll("[data-mapping-key]").forEach((badge) => {
    const key = badge.dataset.mappingKey;
    const crewaiPath = getMappingPath(key, "crewai") || "—";
    const adkPath = getMappingPath(key, "adk") || "—";
    badge.textContent = `CrewAI: ${crewaiPath} | ADK: ${adkPath}`;
  });

  mappingSummary.innerHTML = "";
  mappingKeys.forEach((key) => {
    const crewaiPath = getMappingPath(key, "crewai");
    const adkPath = getMappingPath(key, "adk");
    const item = document.createElement("li");
    item.textContent = `${key} → CrewAI: ${crewaiPath || "—"} | ADK: ${adkPath || "—"}`;
    mappingSummary.appendChild(item);
  });
};

const buildCrewaiConfig = (data) => {
  const identity = {
    Role: data.role,
    Goal: data.goal,
    Backstory: data.backstory,
  };

  const advancedConfigs = {};
  setIf(advancedConfigs, "Temperature", parseNumber(data.temperature));
  setIf(advancedConfigs, "MaxTokens", parseNumber(data.maxTokens));
  setIf(advancedConfigs, "Top_p", parseNumber(data.topP));
  if (data.stop) {
    setIf(advancedConfigs, "Stop", parseList(data.stop));
  }
  setIf(advancedConfigs, "FrequencyPenalty", parseNumber(data.frequencyPenalty));
  setIf(advancedConfigs, "PresencePenalty", parseNumber(data.presencePenalty));
  setIf(advancedConfigs, "Seed", parseNumber(data.seed));
  setIf(advancedConfigs, "Timeout", parseNumber(data.timeout));
  setIf(advancedConfigs, "MaxRetries", parseNumber(data.maxRetries));

  const llmConfiguration = {
    Model: data.model,
  };
  if (Object.keys(advancedConfigs).length) {
    llmConfiguration.Advanced_configs = advancedConfigs;
  }
  setIf(llmConfiguration, "API_KEY", data.apiKey);

  const task = {
    Essential: {
      Name: data.taskName,
      Description: data.taskDescription,
      ExpectedOutput: data.expectedOutput,
    },
  };

  const taskTools = parseList(data.taskTools);
  if (taskTools.length || data.asyncExecution || data.humanInput || data.outputFormat === "markdown") {
    task.Execution = {
      Task_Tools: taskTools.length ? taskTools : undefined,
      AsyncExecution: data.asyncExecution || undefined,
      HumanInput: data.humanInput || undefined,
      Markdown: data.outputFormat === "markdown" || undefined,
    };
  }

  const outputDefinition = {};
  if (data.outputFormat === "json") {
    outputDefinition.OutputJson = true;
  }
  if (data.outputFormat === "structured") {
    outputDefinition.OutputPydantic = true;
  }
  if (data.outputFormat === "file") {
    outputDefinition.OutputFile = true;
    outputDefinition.CreateDirectory = data.createDir || undefined;
  }
  if (data.outputSchema) {
    outputDefinition.OutputSchema = data.outputSchema;
  }
  if (Object.keys(outputDefinition).length) {
    task.Output = outputDefinition;
  }

  const validationAndSafety = {};
  setIf(validationAndSafety, "Guardrail", data.guardrail);
  setIf(validationAndSafety, "GuardrailMaxRetries", parseNumber(data.guardrailMaxRetries));

  const guardrailTypes = {};
  if (data.validationFunction) {
    guardrailTypes.FunctionBased = true;
  }
  if (data.validationLLM) {
    guardrailTypes.LLMBased = true;
  }
  if (Object.keys(guardrailTypes).length) {
    validationAndSafety.GuardrailTypes = guardrailTypes;
  }

  if (Object.keys(validationAndSafety).length) {
    task.ValidationAndSafety = validationAndSafety;
  }

  const behavioralControls = {
    AllowDelegation: data.allowDelegation || false,
    AllowCodeExecution: data.allowCodeExecution || false,
    Verbose: data.verbose || false,
    Cache: data.cache ?? true,
  };

  const agentTools = parseList(data.agentTools);

  const memory = {};
  const memoryTypes = {
    ShortTermMemory: data.shortTermMemory || false,
    LongTermMemory: data.longTermMemory || false,
    EntityMemory: data.entityMemory || false,
    ContextualMemory: data.contextualMemory || false,
  };
  const anyMemoryEnabled = Object.values(memoryTypes).some(Boolean);
  if (anyMemoryEnabled) {
    memory.True_Memory = memoryTypes;
  } else {
    memory.False_Memory = true;
  }

  return {
    Identity: identity,
    AgentType: mapCrewaiAgentType(data.agentType),
    LLMConfiguration: llmConfiguration,
    Task: task,
    Agent_Tools: agentTools.length ? agentTools : undefined,
    BehavioralControls: behavioralControls,
    Memory: memory,
  };
};

const buildAdkConfig = (data) => {
  const instruction = buildInstruction(data);
  const generateContentConfig = {};
  setIf(generateContentConfig, "Temperature", parseNumber(data.temperature));
  setIf(generateContentConfig, "MaxOutputTokens", parseNumber(data.maxTokens));
  setIf(generateContentConfig, "TopP", parseNumber(data.topP));
  if (data.stop) {
    setIf(generateContentConfig, "StopSequences", parseList(data.stop));
  }
  if (data.guardrail) {
    setIf(generateContentConfig, "SafetySettings", data.guardrail);
  }

  const tools = [...parseList(data.agentTools), ...parseList(data.taskTools)];

  const configurations = {
    Instruction: instruction,
  };
  if (tools.length) {
    configurations.Tools = { ToolList: tools };
  }
  if (data.allowCodeExecution) {
    configurations.CodeExecutor = "enabled";
  }
  if (data.contextualMemory) {
    configurations.IncludeContents = "conversation_history";
  }

  const dataStructure = {};
  if (data.outputSchema) {
    dataStructure.OutputSchema = data.outputSchema;
  }
  if (data.outputFormat === "json") {
    dataStructure.OutputFormat = "JSON";
  }
  if (data.outputFormat === "structured") {
    dataStructure.OutputFormat = "Structured";
  }
  if (data.outputFormat === "markdown") {
    dataStructure.OutputFormat = "Markdown";
  }
  if (data.outputFormat === "file") {
    dataStructure.OutputFormat = "File";
    dataStructure.FileOutput = { CreateDirectory: data.createDir || false };
  }
  if (Object.keys(dataStructure).length) {
    configurations.DataStructure = dataStructure;
  }

  const guardrails = {};
  setIf(guardrails, "GuardrailMaxRetries", parseNumber(data.guardrailMaxRetries));
  const validationStrategy = {};
  if (data.validationFunction) {
    validationStrategy.FunctionBasedValidation = true;
  }
  if (data.validationLLM) {
    validationStrategy.LLMBasedValidation = true;
  }
  if (Object.keys(validationStrategy).length) {
    guardrails.ValidationStrategy = validationStrategy;
  }

  return {
    BaseAgent: {
      Name: data.role,
      Description: data.backstory,
      AgentType: mapAdkAgentType(data.agentType),
    },
    Configurations: configurations,
    LLMAgentConfig: {
      Model: data.model,
      GenerateContentConfig: Object.keys(generateContentConfig).length ? generateContentConfig : undefined,
    },
    Guardrails: Object.keys(guardrails).length ? guardrails : undefined,
  };
};

const mapCrewaiAgentType = (value) => {
  const mapping = {
    single: "SingleAgent",
    sequential: "SequentialAgent",
    parallel: "ParallelAgent",
    loop: "LoopAgent",
    custom: "CustomAgent",
  };
  return mapping[value] || "SingleAgent";
};

const mapAdkAgentType = (value) => {
  const mapping = {
    single: "LlmAgent",
    sequential: "SequentialAgent",
    parallel: "ParallelAgent",
    loop: "LoopAgent",
    custom: "CustomAgent",
  };
  return mapping[value] || "LlmAgent";
};

const buildInstruction = (data) => {
  const parts = [];
  if (data.goal) {
    parts.push(`Objectif: ${data.goal}`);
  }
  if (data.taskName) {
    parts.push(`Tâche: ${data.taskName}`);
  }
  if (data.taskDescription) {
    parts.push(data.taskDescription);
  }
  return parts.join("\n");
};

const getField = (container, name) => container.querySelector(`[data-field="${name}"]`);

const getAgentData = (card) => {
  const getValue = (name) => getField(card, name)?.value || "";
  const getChecked = (name) => Boolean(getField(card, name)?.checked);

  return {
    role: getValue("role"),
    goal: getValue("goal"),
    backstory: getValue("backstory"),
    agentType: getValue("agentType"),
    model: getValue("model"),
    temperature: getValue("temperature"),
    maxTokens: getValue("maxTokens"),
    topP: getValue("topP"),
    stop: getValue("stop"),
    frequencyPenalty: getValue("frequencyPenalty"),
    presencePenalty: getValue("presencePenalty"),
    seed: getValue("seed"),
    apiKey: getValue("apiKey"),
    timeout: getValue("timeout"),
    maxRetries: getValue("maxRetries"),
    taskName: getValue("taskName"),
    taskDescription: getValue("taskDescription"),
    expectedOutput: getValue("expectedOutput"),
    agentTools: getValue("agentTools"),
    taskTools: getValue("taskTools"),
    allowDelegation: getChecked("allowDelegation"),
    allowCodeExecution: getChecked("allowCodeExecution"),
    asyncExecution: getChecked("asyncExecution"),
    humanInput: getChecked("humanInput"),
    verbose: getChecked("verbose"),
    cache: getChecked("cache"),
    shortTermMemory: getChecked("shortTermMemory"),
    longTermMemory: getChecked("longTermMemory"),
    entityMemory: getChecked("entityMemory"),
    contextualMemory: getChecked("contextualMemory"),
    outputFormat: getValue("outputFormat"),
    outputSchema: getValue("outputSchema"),
    createDir: getChecked("createDir"),
    guardrail: getValue("guardrail"),
    guardrailMaxRetries: getValue("guardrailMaxRetries"),
    validationFunction: getChecked("validationFunction"),
    validationLLM: getChecked("validationLLM"),
  };
};

const updateAgentTitles = () => {
  const cards = Array.from(agentsContainer.querySelectorAll(".agent-card"));
  cards.forEach((card, index) => {
    const title = card.querySelector(".agent-title");
    const role = getField(card, "role")?.value?.trim();
    title.textContent = role ? `— ${role}` : "(nouvel agent)";
    card.querySelector(".agent-index").textContent = index + 1;
  });
};

const updateOutput = () => {
  const cards = Array.from(agentsContainer.querySelectorAll(".agent-card"));
  const agentsData = cards.map(getAgentData);
  updateAgentTitles();

  const crewaiPayload = { agents: agentsData.map(buildCrewaiConfig) };
  const adkPayload = { agents: agentsData.map(buildAdkConfig) };
  outputCrewai.textContent = jsyaml.dump(crewaiPayload, { noRefs: true, lineWidth: 120 }).trim();
  outputAdk.textContent = jsyaml.dump(adkPayload, { noRefs: true, lineWidth: 120 }).trim();
};

const copyOutput = async (element, button, label) => {
  await navigator.clipboard.writeText(element.textContent);
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

const createAgentCard = () => {
  const fragment = agentTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".agent-card");
  const removeButton = fragment.querySelector(".remove-agent");

  removeButton.addEventListener("click", (event) => {
    event.preventDefault();
    const cards = agentsContainer.querySelectorAll(".agent-card");
    if (cards.length <= 1) {
      return;
    }
    card.remove();
    updateOutput();
  });

  card.querySelectorAll("input, textarea, select").forEach((input) => {
    input.addEventListener("input", updateOutput);
    input.addEventListener("change", updateOutput);
  });

  agentsContainer.appendChild(fragment);
  updateOutput();
};

const loadBindingTable = async () => {
  try {
    const response = await fetch("../binding_table_for_agent.yml");
    if (!response.ok) {
      throw new Error("Binding table not found");
    }
    const yamlText = await response.text();
    bindingTable = jsyaml.load(yamlText);
  } catch (error) {
    bindingTable = fallbackMapping;
  }
  renderMappingBadges();
  updateOutput();
};

addAgentButton.addEventListener("click", createAgentCard);
copyCrewaiButton.addEventListener("click", () => copyOutput(outputCrewai, copyCrewaiButton, "Copier CrewAI"));
downloadCrewaiButton.addEventListener("click", () => downloadOutput(outputCrewai, "crewai_agents.yml"));
copyAdkButton.addEventListener("click", () => copyOutput(outputAdk, copyAdkButton, "Copier ADK"));
downloadAdkButton.addEventListener("click", () => downloadOutput(outputAdk, "adk_agents.yml"));

loadBindingTable();
createAgentCard();
