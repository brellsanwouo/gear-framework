const agentStatusEl = document.getElementById("agentStatus");
const orchestrationStatusEl = document.getElementById("orchestrationStatus");
const loadDefaultButton = document.getElementById("loadDefault");
const uvlFileInput = document.getElementById("uvlFileInput");
const addAgentButton = document.getElementById("addAgent");
const agentsContainer = document.getElementById("agentsContainer");
const agentTemplate = document.getElementById("agentTemplate");
const loadOrchestrationDefaultButton = document.getElementById("loadOrchestrationDefault");
const addOrchestrationButton = document.getElementById("addOrchestration");
const orchestrationUvlFileInput = document.getElementById("orchestrationUvlFileInput");
const orchestrationContainer = document.getElementById("orchestrationContainer");
const orchestrationTemplate = document.getElementById("orchestrationTemplate");
const connectorsStatusEl = document.getElementById("connectorsStatus");
const connectorsListEl = document.getElementById("connectorsList");
const targetTabLabels = document.querySelectorAll("[data-target-tab]");
const targetPanels = document.querySelectorAll("[data-target-panel]");
const outputTabLabels = document.querySelectorAll("[data-output-tab]");
const outputBlocks = document.querySelectorAll("[data-output-panel]");
const outputTextBlocks = document.querySelectorAll("[data-output]");
const outputCopyButtons = document.querySelectorAll(".output-code .icon-button");

const GROUP_KEYWORDS = new Set(["mandatory", "optional", "alternative"]);
const DEFAULT_AGENT_UVL_PATH = "gear/gear-agent.uvl";
const DEFAULT_ORCHESTRATION_UVL_PATH = "gear/gear-multiagent.uvl";
const CONNECTORS_REGISTRY_PATH = "connectors/registry.yml";
const CREWAI_AGENT_MAPPING_PATH = "connectors/frameworks/crewai/agent.mapping.yml";
const CREWAI_MULTI_MAPPING_PATH = "connectors/frameworks/crewai/multiagent.mapping.yml";

let agentModel = null;
let orchestrationModel = null;
let agentStates = [];
let orchestrationStates = [];
let agentCounter = 0;
let crewaiAgentMapping = null;
let crewaiMultiMapping = null;

const CREWAI_FALLBACK_MAPPING = [
  { from: "AgentIdentity.Name", to: "Identity.Role", kind: "equivalent" },
  { from: "AgentIdentity.Purpose", to: "Identity.Goal", kind: "equivalent" },
  { from: "AgentIdentity.ContextDescription", to: "Identity.Backstory", kind: "equivalent" },
  { from: "LLMConfiguration.Provider", to: null, kind: "not_mapped" },
  { from: "LLMConfiguration.Model", to: "LLMConfiguration.Model", kind: "direct" },
  { from: "LLMConfiguration.APIKey", to: "LLMConfiguration.API_KEY", kind: "equivalent" },
  { from: "LLMConfiguration.BaseURL", to: null, kind: "not_mapped" },
  { from: "LLMConfiguration.Timeout", to: "LLMConfiguration.Advanced_configs.Timeout", kind: "direct" },
  { from: "LLMConfiguration.MaxRetries", to: "LLMConfiguration.Advanced_configs.MaxRetries", kind: "direct" },
  { from: "LLMConfiguration.ModelParameters.Temperature", to: "LLMConfiguration.Advanced_configs.Temperature", kind: "direct" },
  { from: "LLMConfiguration.ModelParameters.MaxTokens", to: "LLMConfiguration.Advanced_configs.MaxTokens", kind: "direct" },
  { from: "LLMConfiguration.ModelParameters.TopP", to: "LLMConfiguration.Advanced_configs.Top_p", kind: "equivalent" },
  { from: "LLMConfiguration.ModelParameters.StopSequences", to: "LLMConfiguration.Advanced_configs.Stop", kind: "equivalent" },
  { from: "LLMConfiguration.ModelParameters.TopK", to: null, kind: "not_mapped" },
  { from: "LLMConfiguration.ModelParameters.FrequencyPenalty", to: "LLMConfiguration.Advanced_configs.FrequencyPenalty", kind: "direct" },
  { from: "LLMConfiguration.ModelParameters.PresencePenalty", to: "LLMConfiguration.Advanced_configs.PresencePenalty", kind: "direct" },
  { from: "LLMConfiguration.ModelParameters.Seed", to: "LLMConfiguration.Advanced_configs.Seed", kind: "direct" },
  { from: "LLMConfiguration.ModelParameters.AdditionalParams", to: null, kind: "not_mapped" },
  { from: "TaskSpecification.TaskName", to: "Task.Essential.Name", kind: "partial" },
  { from: "TaskSpecification.TaskDescription", to: "Task.Essential.Description", kind: "direct" },
  { from: "TaskSpecification.ExpectedOutput", to: "Task.Essential.ExpectedOutput", kind: "direct" },
  { from: "TaskSpecification.AssignedAgent", to: "Task.Essential.This_Agent", kind: "partial" },
  { from: "Tools", to: "Agent_Tools", kind: "partial" },
  { from: "ExecutionControl.DelegationControl", to: "BehavioralControls.AllowDelegation", kind: "partial" },
  { from: "ExecutionControl.CodeExecutionControl", to: "BehavioralControls.AllowCodeExecution", kind: "partial" },
  { from: "ExecutionControl.AsyncExecutionControl", to: "Task.Execution.AsyncExecution", kind: "partial" },
  { from: "ExecutionControl.HumanInteractionControl", to: "Task.Execution.HumanInput", kind: "partial" },
  { from: "ExecutionControl.VerbosityControl", to: "BehavioralControls.Verbose", kind: "partial" },
  { from: "ExecutionControl.CachingControl", to: "BehavioralControls.Cache", kind: "partial" },
  { from: "Memory", to: "Memory", kind: "partial" },
  { from: "Reasoning", to: "Reasoning", kind: "partial" },
];

const indentOf = (line) => {
  const match = line.match(/^\s*/);
  const raw = match ? match[0] : "";
  return raw.replace(/\t/g, "  ").length;
};

const parseFeatureLine = (line) => {
  const nameMatch = line.match(/^([A-Za-z0-9_]+)/);
  if (!nameMatch) {
    return null;
  }
  const name = nameMatch[1];
  const abstract = /abstract\s+true/.test(line);
  return { name, abstract };
};

const createImplicitGroup = (groups, features, parentFeatureId) => {
  const groupId = `${parentFeatureId}::implicit`;
  if (groups[groupId]) {
    return groups[groupId];
  }
  const group = {
    id: groupId,
    type: "optional",
    implicit: true,
    parentFeatureId,
    children: [],
  };
  groups[groupId] = group;
  features[parentFeatureId].groups.push(groupId);
  return group;
};

const parseUvl = (text) => {
  const features = {};
  const groups = {};
  const roots = [];
  const stack = [];
  let featureCounter = 0;
  let groupCounter = 0;

  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("//")) {
      continue;
    }
    if (trimmed.startsWith("namespace") || trimmed === "features") {
      continue;
    }

    const indent = indentOf(rawLine);
    while (stack.length && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    if (GROUP_KEYWORDS.has(trimmed)) {
      const parentFeatureCtx = [...stack].reverse().find((ctx) => ctx.kind === "feature");
      if (!parentFeatureCtx) {
        continue;
      }
      const groupId = `g${++groupCounter}`;
      const group = {
        id: groupId,
        type: trimmed,
        parentFeatureId: parentFeatureCtx.id,
        children: [],
      };
      groups[groupId] = group;
      features[parentFeatureCtx.id].groups.push(groupId);
      stack.push({ kind: "group", id: groupId, indent });
      continue;
    }

    const parsed = parseFeatureLine(trimmed);
    if (!parsed) {
      continue;
    }

    const featureId = `f${++featureCounter}`;
    const parentCtx = stack[stack.length - 1];
    let parentFeatureId = null;
    let parentGroupId = null;
    let relationType = "mandatory";

    if (parentCtx?.kind === "group") {
      const group = groups[parentCtx.id];
      parentFeatureId = group.parentFeatureId;
      parentGroupId = group.id;
      relationType = group.type;
      group.children.push(featureId);
    } else if (parentCtx?.kind === "feature") {
      parentFeatureId = parentCtx.id;
      relationType = "optional";
      const group = createImplicitGroup(groups, features, parentFeatureId);
      parentGroupId = group.id;
      group.children.push(featureId);
    }

    const feature = {
      id: featureId,
      name: parsed.name,
      abstract: parsed.abstract,
      parentFeatureId,
      parentGroupId,
      relationType,
      groups: [],
    };
    features[featureId] = feature;

    if (!parentFeatureId) {
      roots.push(featureId);
    }

    stack.push({ kind: "feature", id: featureId, indent });
  }

  return { features, groups, roots };
};

const setStatus = (message, isError = false, target = "agent") => {
  const el = target === "orchestration" ? orchestrationStatusEl : agentStatusEl;
  if (!el) {
    return;
  }
  el.textContent = message;
  el.classList.toggle("error", isError);
};

const setStatusForState = (state, message, isError = false) => {
  const target = state.kind === "orchestration" ? "orchestration" : "agent";
  setStatus(message, isError, target);
};

const setConnectorsStatus = (message, isError = false) => {
  if (!connectorsStatusEl) {
    return;
  }
  connectorsStatusEl.textContent = message;
  connectorsStatusEl.classList.toggle("error", isError);
};

const setActiveTargetPanel = (target) => {
  if (!targetPanels.length) {
    return;
  }
  targetPanels.forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.targetPanel === target);
  });
  targetTabLabels.forEach((label) => {
    label.setAttribute("aria-selected", label.dataset.targetTab === target ? "true" : "false");
  });
  const panel = document.querySelector(`[data-target-panel="${target}"]`);
  if (!panel) {
    return;
  }
  const labels = panel.querySelectorAll("[data-output-tab]");
  let selectedLabel = null;
  labels.forEach((label) => {
    const input = label.querySelector("input");
    if (input?.checked) {
      selectedLabel = label;
    }
  });
  if (!selectedLabel && labels.length) {
    const first = labels[0];
    const input = first.querySelector("input");
    if (input) {
      input.checked = true;
    }
    selectedLabel = first;
  }
  if (selectedLabel) {
    setActiveOutputPanel(selectedLabel.dataset.outputTab);
  }
};

const initializeOutputPanels = () => {
  const activeTargetLabel = Array.from(targetTabLabels).find((label) => {
    const input = label.querySelector("input");
    return input?.checked;
  });
  const target = activeTargetLabel?.dataset.targetTab || targetTabLabels[0]?.dataset.targetTab;
  if (target) {
    setActiveTargetPanel(target);
  }
};

const setActiveOutputPanel = (outputId) => {
  if (!outputBlocks.length) {
    return;
  }
  const prefix = outputId.split("-")[0];
  outputBlocks.forEach((block) => {
    const panelId = block.dataset.outputPanel || "";
    const isSameTarget = panelId.startsWith(`${prefix}-`);
    const isActive = panelId === outputId;
    block.classList.toggle("is-active", isSameTarget && isActive);
  });
  outputTabLabels.forEach((label) => {
    label.setAttribute("aria-selected", label.dataset.outputTab === outputId ? "true" : "false");
  });
};

const resolveBasePrefix = () => {
  let path = window.location.pathname || "/";
  if (!path.endsWith("/")) {
    path = path.slice(0, path.lastIndexOf("/") + 1);
  }
  if (path.endsWith("ui/")) {
    path = path.slice(0, -3);
  }
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  return path;
};

const BASE_PREFIX = resolveBasePrefix();

const buildUrlCandidates = (relativePath) => {
  const clean = String(relativePath || "").replace(/^\/+/, "");
  const candidates = [
    `${BASE_PREFIX}${clean}`,
    `/${clean}`,
    `../${clean}`,
  ];
  return [...new Set(candidates)];
};

const loadYamlFromUrlCandidates = async (relativePath) => {
  const urls = buildUrlCandidates(relativePath);
  let lastError = null;
  for (const url of urls) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status}`);
        continue;
      }
      const text = await response.text();
      if (!window.jsyaml?.load) {
        throw new Error("js-yaml indisponible");
      }
      return window.jsyaml.load(text);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Chargement impossible");
};

const loadCrewaiMappings = async () => {
  try {
    crewaiAgentMapping = await loadYamlFromUrlCandidates(CREWAI_AGENT_MAPPING_PATH);
    crewaiMultiMapping = await loadYamlFromUrlCandidates(CREWAI_MULTI_MAPPING_PATH);
  } catch (error) {
    console.error(error);
    crewaiAgentMapping = CREWAI_FALLBACK_MAPPING;
    crewaiMultiMapping = null;
  }
};

const renderConnectors = (registry) => {
  if (!connectorsListEl) {
    return;
  }
  connectorsListEl.innerHTML = "";
  const frameworks = Array.isArray(registry?.frameworks) ? registry.frameworks : [];
  if (!frameworks.length) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.textContent = "Aucun connecteur défini.";
    connectorsListEl.appendChild(empty);
    return;
  }

  for (const framework of frameworks) {
    const item = document.createElement("li");
    item.className = "connector-item";

    const title = document.createElement("div");
    title.className = "connector-title";
    title.textContent = framework.label || framework.id || "Framework";

    const description = document.createElement("div");
    description.className = "connector-description";
    description.textContent = framework.description || "";

    item.appendChild(title);
    if (description.textContent) {
      item.appendChild(description);
    }
    connectorsListEl.appendChild(item);
  }
};

const loadConnectorsRegistry = async () => {
  if (!connectorsStatusEl || !connectorsListEl) {
    return;
  }
  setConnectorsStatus(`Chargement de ${CONNECTORS_REGISTRY_PATH}…`);
  try {
    const registry = await loadYamlFromUrlCandidates(CONNECTORS_REGISTRY_PATH);
    renderConnectors(registry);
    setConnectorsStatus("Connecteurs chargés.");
  } catch (error) {
    console.error(error);
    setConnectorsStatus("Impossible de charger les connecteurs.", true);
  }
};

const featureChildCount = (model, featureId) => {
  const feature = model.features[featureId];
  return feature.groups.reduce((count, groupId) => {
    const group = model.groups[groupId];
    return count + (group?.children.length ?? 0);
  }, 0);
};

const isLeafFeature = (model, featureId) => featureChildCount(model, featureId) === 0;
const featureHasChildren = (model, featureId) => featureChildCount(model, featureId) > 0;

const buildPathIndex = (model) => {
  const featurePaths = {};
  if (!model) {
    return featurePaths;
  }

  const visit = (featureId, pathParts) => {
    const feature = model.features[featureId];
    if (!feature) {
      return;
    }
    const nextPath = [...pathParts, feature.name];
    featurePaths[featureId] = nextPath;
    for (const groupId of feature.groups) {
      const group = model.groups[groupId];
      for (const childId of group.children) {
        visit(childId, nextPath);
      }
    }
  };

  for (const rootId of model.roots) {
    visit(rootId, []);
  }

  return featurePaths;
};

const featurePath = (model, featureId) => {
  const pathParts = model.featurePaths?.[featureId];
  if (pathParts?.length) {
    return pathParts.join(" / ");
  }
  const parts = [];
  let current = model.features[featureId];
  while (current) {
    parts.push(current.name);
    current = current.parentFeatureId ? model.features[current.parentFeatureId] : null;
  }
  return parts.reverse().join(" / ");
};

const groupLabel = (type) => {
  if (type === "mandatory") return "obligatoire";
  if (type === "optional") return "optionnel";
  if (type === "alternative") return "alternative";
  return type;
};

const valueInputKind = (feature) => {
  const lower = feature.name.toLowerCase();
  if (lower.includes("description") || lower.includes("context") || lower.includes("purpose")) {
    return "textarea";
  }
  return "text";
};

const isAgentRefFeature = (state, feature) =>
  state.kind === "orchestration" && feature.name.toLowerCase() === "agentref";

const isAgentsFeature = (state, feature) =>
  state.kind === "orchestration" && feature.name.toLowerCase() === "agents";

const buildAgentOptionList = () => {
  return agentStates.map((agent, index) => {
    const name = findAgentTitle(agent);
    const fallback = `Agent ${index + 1}`;
    const label = name && name !== "(nouvel agent)" ? name : fallback;
    return { value: label, label };
  });
};

const debounce = (fn, delayMs) => {
  let timerId = null;
  return (...args) => {
    if (timerId) {
      clearTimeout(timerId);
    }
    timerId = setTimeout(() => fn(...args), delayMs);
  };
};

const coerceScalar = (raw) => {
  if (raw === null || raw === undefined) {
    return true;
  }
  const text = String(raw).trim();
  if (!text) {
    return true;
  }
  const lower = text.toLowerCase();
  if (lower === "true") return true;
  if (lower === "false") return false;
  if (lower === "null") return null;
  if (!Number.isNaN(Number(text)) && /^-?\d+(\.\d+)?$/.test(text)) {
    return Number(text);
  }
  return text;
};

const scalarToString = (value) => {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch (error) {
    return String(value);
  }
};

const setNestedValue = (target, pathParts, value) => {
  if (!pathParts.length) {
    return;
  }
  let cursor = target;
  for (let i = 0; i < pathParts.length - 1; i += 1) {
    const key = pathParts[i];
    const current = cursor[key];
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      cursor[key] = {};
    }
    cursor = cursor[key];
  }
  cursor[pathParts[pathParts.length - 1]] = value;
};

const getValueAtPath = (data, pathParts) => {
  let cursor = data;
  for (const key of pathParts) {
    if (!cursor || typeof cursor !== "object" || !(key in cursor)) {
      return { exists: false, value: undefined };
    }
    cursor = cursor[key];
  }
  return { exists: true, value: cursor };
};

const normalizeGearRoot = (data) => {
  if (!data || typeof data !== "object") {
    return {};
  }
  const keys = Object.keys(data);
  if (keys.length === 1 && (keys[0] === "GearAgent" || keys[0] === "GearMultiAgent")) {
    const inner = data[keys[0]];
    if (inner && typeof inner === "object") {
      return inner;
    }
  }
  return data;
};

const pathToParts = (path) => {
  if (!path || typeof path !== "string") {
    return [];
  }
  return path.split(".").filter(Boolean);
};

const applyMapping = (source, mappingEntries) => {
  const output = {};
  if (!source || !mappingEntries) {
    return output;
  }
  for (const entry of mappingEntries) {
    if (!entry || !entry.to || entry.kind === "not_mapped") {
      continue;
    }
    const fromList = Array.isArray(entry.from) ? entry.from : [entry.from];
    let matched = false;
    let value;
    for (const fromPath of fromList) {
      if (!fromPath) {
        continue;
      }
      const { exists, value: candidate } = getValueAtPath(source, pathToParts(fromPath));
      if (exists) {
        matched = true;
        value = candidate;
        break;
      }
    }
    if (!matched) {
      continue;
    }
    setNestedValue(output, pathToParts(entry.to), value);
  }
  return output;
};

const toCrewaiModel = (model) => {
  const text = String(model || "").trim();
  if (!text) {
    return "";
  }
  if (text.includes("/")) {
    return text;
  }
  if (text.includes(":")) {
    const [provider, rest] = text.split(":", 2);
    if (provider && rest) {
      return `${provider}/${rest}`;
    }
  }
  return text;
};

const setIfMeaningful = (obj, key, value) => {
  if (!obj || !key) {
    return;
  }
  if (value === undefined || value === null) {
    return;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    obj[key] = trimmed;
    return;
  }
  if (typeof value === "boolean") {
    if (value) {
      obj[key] = true;
    }
    return;
  }
  obj[key] = value;
};

const ensureUniqueKey = (base, fallbackPrefix, index, usedKeys) => {
  const seed = base?.trim() || `${fallbackPrefix}${index}`;
  let candidate = seed;
  let counter = 2;
  while (usedKeys.has(candidate)) {
    candidate = `${seed}_${counter}`;
    counter += 1;
  }
  usedKeys.add(candidate);
  return candidate;
};

const buildCrewaiAgentConfigFromGear = (gearAgent) => {
  const config = {};
  setIfMeaningful(config, "role", gearAgent.AgentIdentity?.Name);
  setIfMeaningful(config, "goal", gearAgent.AgentIdentity?.Purpose);
  setIfMeaningful(config, "backstory", gearAgent.AgentIdentity?.ContextDescription);
  const modelValue = toCrewaiModel(gearAgent.LLMConfiguration?.Model);
  setIfMeaningful(config, "llm", modelValue);
  setIfMeaningful(config, "verbose", gearAgent.ExecutionControl?.VerbosityControl === true);
  setIfMeaningful(config, "allow_delegation", gearAgent.ExecutionControl?.DelegationControl === true);
  setIfMeaningful(config, "allow_code_execution", gearAgent.ExecutionControl?.CodeExecutionControl === true);
  setIfMeaningful(config, "cache", gearAgent.ExecutionControl?.CachingControl === true);
  setIfMeaningful(config, "reasoning", gearAgent.Reasoning === true);
  setIfMeaningful(config, "memory", gearAgent.Memory === true);
  return config;
};

const buildCrewaiTaskConfigFromGear = (gearAgent, agentKey, taskKey) => {
  const config = {};
  const taskSpec = gearAgent.TaskSpecification || {};
  setIfMeaningful(config, "description", taskSpec.TaskDescription || "");
  setIfMeaningful(config, "expected_output", taskSpec.ExpectedOutput || "");
  setIfMeaningful(config, "agent", taskSpec.AssignedAgent || agentKey);
  setIfMeaningful(config, "name", taskSpec.TaskName || taskKey);
  setIfMeaningful(config, "async_execution", gearAgent.ExecutionControl?.AsyncExecutionControl === true);
  setIfMeaningful(config, "human_input", gearAgent.ExecutionControl?.HumanInteractionControl === true);
  return config;
};

const buildCrewaiOutputs = () => {
  const gearAgents = agentStates.map((state) => normalizeGearRoot(buildYamlObjectForAgent(state)));
  const agentsPayload = {};
  const tasksPayload = {};
  const usedAgentKeys = new Set();
  const usedTaskKeys = new Set();

  gearAgents.forEach((gearAgent, index) => {
    const agentKey = ensureUniqueKey(gearAgent.AgentIdentity?.Name, "agent", index + 1, usedAgentKeys);
    agentsPayload[agentKey] = buildCrewaiAgentConfigFromGear(gearAgent);
    const taskKey = ensureUniqueKey(
      gearAgent.TaskSpecification?.TaskName,
      "task",
      index + 1,
      usedTaskKeys,
    );
    tasksPayload[taskKey] = buildCrewaiTaskConfigFromGear(gearAgent, agentKey, taskKey);
  });

  return {
    agents: agentsPayload,
    tasks: tasksPayload,
  };
};

const buildAdkAgentConfigFromGear = (gearAgent) => {
  const baseAgent = { AgentType: "LlmAgent" };
  const llmAgentConfig = {};
  const generateContentConfig = {};
  const configurations = {};
  const dataStructure = {};
  const planner = {};
  const builtInPlanner = {};
  const thinkingConfig = {};

  setIfMeaningful(baseAgent, "Name", gearAgent.AgentIdentity?.Name);
  const descriptionParts = [gearAgent.AgentIdentity?.Purpose, gearAgent.AgentIdentity?.ContextDescription]
    .map((value) => (value ?? "").toString().trim())
    .filter(Boolean);
  if (descriptionParts.length) {
    setIfMeaningful(baseAgent, "Description", descriptionParts.join("\n"));
  }

  const modelValue = gearAgent.LLMConfiguration?.Model || "";
  setIfMeaningful(llmAgentConfig, "Model", modelValue);
  setIfMeaningful(generateContentConfig, "Temperature", gearAgent.LLMConfiguration?.ModelParameters?.Temperature);
  setIfMeaningful(generateContentConfig, "MaxOutputTokens", gearAgent.LLMConfiguration?.ModelParameters?.MaxTokens);
  setIfMeaningful(generateContentConfig, "TopP", gearAgent.LLMConfiguration?.ModelParameters?.TopP);
  setIfMeaningful(generateContentConfig, "TopK", gearAgent.LLMConfiguration?.ModelParameters?.TopK);
  if (Object.keys(generateContentConfig).length) {
    llmAgentConfig.GenerateContentConfig = generateContentConfig;
  }

  setIfMeaningful(configurations, "Instruction", gearAgent.TaskSpecification?.TaskDescription);
  setIfMeaningful(dataStructure, "OutputKey", gearAgent.TaskSpecification?.TaskName);
  if (gearAgent.TaskSpecification?.ExpectedOutput) {
    dataStructure.OutputSchema = {
      description: gearAgent.TaskSpecification.ExpectedOutput,
      type: "string",
    };
  }
  if (Object.keys(dataStructure).length) {
    configurations.DataStructure = dataStructure;
  }

  if (gearAgent.Reasoning === true) {
    thinkingConfig.IncludeThoughts = true;
  }
  if (Object.keys(thinkingConfig).length) {
    builtInPlanner.ThinkingConfig = thinkingConfig;
    planner.BuiltInPlanner = builtInPlanner;
    configurations.Planner = planner;
  }

  if (gearAgent.ExecutionControl?.CodeExecutionControl === true) {
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

const buildAdkOutputs = () => {
  const gearAgents = agentStates.map((state) => normalizeGearRoot(buildYamlObjectForAgent(state)));
  const adkAgents = {};
  const usedKeys = new Set();
  gearAgents.forEach((gearAgent, index) => {
    const key = ensureUniqueKey(gearAgent.AgentIdentity?.Name, "agent", index + 1, usedKeys);
    adkAgents[key] = buildAdkAgentConfigFromGear(gearAgent);
  });
  return { agents: adkAgents };
};

const isExplicitFalse = (value) => value === false;

const BOOLEAN_FEATURES = new Set([
  "memory",
  "reasoning",
  "delegationcontrol",
  "codeexecutioncontrol",
  "asyncexecutioncontrol",
  "humaninteractioncontrol",
  "verbositycontrol",
  "cachingcontrol",
]);

const NUMBER_FEATURES = new Set([
  "temperature",
  "maxtokens",
  "topp",
  "topk",
  "frequencypenalty",
  "presencepenalty",
  "seed",
  "timeout",
  "maxretries",
  "turncount",
]);

const normalizeFeatureName = (featureName) => String(featureName || "").trim().toLowerCase();

const isBooleanFeatureName = (featureName) => BOOLEAN_FEATURES.has(normalizeFeatureName(featureName));

const isNumberFeatureName = (featureName) => NUMBER_FEATURES.has(normalizeFeatureName(featureName));

const parseBoolean = (rawValue) => {
  const lower = String(rawValue).trim().toLowerCase();
  if (lower === "true") return true;
  if (lower === "false") return false;
  return null;
};

const isRequiredLeafFeature = (state, feature) =>
  feature.relationType === "mandatory" && isLeafFeature(state.model, feature.id);

const hasMeaningfulValue = (value) => {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim() !== "";
  }
  return true;
};

const getMissingRequiredCount = (state) => {
  const { model } = state;
  let missing = 0;
  Object.values(model.features).forEach((feature) => {
    if (!isRequiredLeafFeature(state, feature)) {
      return;
    }
    if (!isFeatureActive(state, feature.id)) {
      return;
    }
    const value = state.featureValues[feature.id];
    if (!hasMeaningfulValue(value)) {
      missing += 1;
    }
  });
  return missing;
};

const createFeatureState = (kind, model, label = "") => {
  const state = {
    id: `a${++agentCounter}`,
    kind,
    model,
    label,
    optionalSelections: {},
    alternativeSelections: {},
    featureValues: {},
    openNodes: {},
    isSyncingYaml: false,
    rootEl: null,
    els: {},
    builder: null,
  };
  resetFeatureState(state);
  return state;
};

const resetFeatureState = (state) => {
  state.optionalSelections = {};
  state.alternativeSelections = {};
  state.featureValues = {};
  state.openNodes = {};

  const { model } = state;
  for (const feature of Object.values(model.features)) {
    if (feature.relationType === "optional") {
      state.optionalSelections[feature.id] = false;
    }
    if (isLeafFeature(model, feature.id)) {
      state.featureValues[feature.id] = "";
    } else {
      state.openNodes[feature.id] = false;
    }
  }

  for (const group of Object.values(model.groups)) {
    if (group.type === "alternative") {
      state.alternativeSelections[group.id] = group.children[0] ?? null;
    }
  }
};

const isFeatureActive = (state, featureId) => {
  const { model } = state;
  const feature = model.features[featureId];
  if (!feature) {
    return false;
  }

  if (!feature.parentFeatureId) {
    return true;
  }

  const parentActive = isFeatureActive(state, feature.parentFeatureId);
  if (!parentActive) {
    return false;
  }

  if (feature.relationType === "mandatory") {
    return true;
  }
  if (feature.relationType === "optional") {
    return state.optionalSelections[featureId] === true;
  }
  if (feature.relationType === "alternative") {
    return state.alternativeSelections[feature.parentGroupId] === featureId;
  }

  return false;
};

const renderGroupHeading = (group) => {
  if (group.implicit) {
    return null;
  }
  const heading = document.createElement("div");
  heading.className = "group-heading";
  heading.textContent = groupLabel(group.type);
  return heading;
};

const renderFeature = (state, featureId, parentActive) => {
  const { model } = state;
  const feature = model.features[featureId];
  const active = parentActive && isFeatureActive(state, featureId);
  const hasChildren = featureHasChildren(model, feature.id);

  const li = document.createElement("li");
  li.className = "tree-node";

  const line = document.createElement("div");
  line.className = "node-line";
  if (!active) {
    line.classList.add("is-inactive");
  }

  const toggle = document.createElement("span");
  toggle.className = "feature-toggle";
  toggle.textContent = hasChildren ? "▸" : "▸";
  if (!hasChildren) {
    toggle.classList.add("feature-toggle--spacer");
    toggle.setAttribute("aria-hidden", "true");
  }
  line.appendChild(toggle);

  const parentGroup = feature.parentGroupId ? model.groups[feature.parentGroupId] : null;
  const groupType = parentGroup?.type ?? feature.relationType;

  if (groupType === "alternative") {
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = `${state.id}::${feature.parentGroupId}`;
    radio.checked = active;
    radio.disabled = !parentActive;
    radio.addEventListener("change", () => {
      state.alternativeSelections[feature.parentGroupId] = feature.id;
      renderAgent(state);
    });
    radio.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    line.appendChild(radio);
  } else {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = active;
    const disabledByParent = !parentActive;
    const disabledByRelation = groupType === "mandatory";
    checkbox.disabled = disabledByParent || disabledByRelation;
    checkbox.addEventListener("change", () => {
      state.optionalSelections[feature.id] = checkbox.checked;
      renderAgent(state);
    });
    checkbox.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    line.appendChild(checkbox);
  }

  const label = document.createElement("span");
  label.className = "node-label";
  label.textContent = feature.name;
  line.appendChild(label);

  if (parentGroup && !parentGroup.implicit) {
    const badge = document.createElement("span");
    badge.className = `badge group-${parentGroup.type}`;
    badge.textContent = groupLabel(parentGroup.type);
    line.appendChild(badge);
  }

  if (feature.abstract) {
    const abstractBadge = document.createElement("span");
    abstractBadge.className = "badge abstract";
    abstractBadge.textContent = "abstrait";
    line.appendChild(abstractBadge);
  }

  if (isLeafFeature(model, feature.id)) {
    const rawValue = state.featureValues[feature.id];
    const stringValue = Array.isArray(rawValue) ? "" : String(rawValue ?? "").trim();
    const isBoolean = isBooleanFeatureName(feature.name);
    const isRequired = isRequiredLeafFeature(state, feature);
    const isInvalid = active && isRequired && !isBoolean && stringValue === "";
    if (isInvalid) {
      line.classList.add("is-invalid");
    }
    if (isAgentsFeature(state, feature)) {
      const selectEl = document.createElement("select");
      selectEl.className = "feature-value";
      selectEl.multiple = true;
      selectEl.size = 4;
      selectEl.disabled = !active;

      const options = buildAgentOptionList();
      for (const option of options) {
        const opt = document.createElement("option");
        opt.value = option.value;
        opt.textContent = option.label;
        selectEl.appendChild(opt);
      }

      const currentValue = state.featureValues[feature.id];
      const selectedValues = Array.isArray(currentValue) ? currentValue : [];
      for (const option of selectEl.options) {
        option.selected = selectedValues.includes(option.value);
      }

      selectEl.addEventListener("change", () => {
        const selected = Array.from(selectEl.selectedOptions).map((opt) => opt.value);
        state.featureValues[feature.id] = selected;
        renderAgentSummary(state);
        renderAgentYaml(state);
        renderAgentHeader(state);
      });
      selectEl.addEventListener("click", (event) => {
        event.stopPropagation();
      });
      line.appendChild(selectEl);
    } else if (isAgentRefFeature(state, feature)) {
      const selectEl = document.createElement("select");
      selectEl.className = "feature-value";
      selectEl.disabled = !active;

      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "(choisir un agent)";
      selectEl.appendChild(placeholder);

      const options = buildAgentOptionList();
      for (const option of options) {
        const opt = document.createElement("option");
        opt.value = option.value;
        opt.textContent = option.label;
        selectEl.appendChild(opt);
      }

      const currentValue = state.featureValues[feature.id] ?? "";
      selectEl.value = currentValue;

      selectEl.addEventListener("change", () => {
        state.featureValues[feature.id] = selectEl.value;
        renderAgentSummary(state);
        renderAgentYaml(state);
        renderAgentHeader(state);
      });
      selectEl.addEventListener("click", (event) => {
        event.stopPropagation();
      });
      line.appendChild(selectEl);
    } else {
      const kind = valueInputKind(feature);
      const valueEl = document.createElement(kind === "textarea" ? "textarea" : "input");
      if (kind !== "textarea") {
        valueEl.type = "text";
      }
      valueEl.className = "feature-value";
      valueEl.placeholder = "valeur…";
      valueEl.value = state.featureValues[feature.id] ?? "";
      valueEl.disabled = !active;
      if (isInvalid) {
        valueEl.classList.add("is-invalid");
      }
    valueEl.addEventListener("input", () => {
      state.featureValues[feature.id] = valueEl.value;
      renderAgentSummary(state);
      renderAgentYaml(state);
      renderAgentHeader(state);
      if (state.kind === "agent" && feature.name.toLowerCase() === "name") {
        orchestrationStates.forEach((item) => renderAgent(item));
      }
    });
      valueEl.addEventListener("click", (event) => {
        event.stopPropagation();
      });
      line.appendChild(valueEl);
    }
  }

  if (!hasChildren) {
    li.appendChild(line);
    return li;
  }

  const details = document.createElement("details");
  details.className = "feature-details";
  details.open = state.openNodes[feature.id] !== false;
  details.addEventListener("toggle", () => {
    state.openNodes[feature.id] = details.open;
  });

  const summary = document.createElement("summary");
  summary.className = "feature-summary";
  summary.addEventListener("click", (event) => {
    // Prevent nested summaries from toggling ancestor <details>.
    event.stopPropagation();
  });
  summary.appendChild(line);
  details.appendChild(summary);

  const groupList = document.createElement("ul");
  for (const groupId of feature.groups) {
    const group = model.groups[groupId];
    const heading = renderGroupHeading(group);
    if (heading) {
      const headingLi = document.createElement("li");
      headingLi.appendChild(heading);
      groupList.appendChild(headingLi);
    }

    for (const childId of group.children) {
      groupList.appendChild(renderFeature(state, childId, active));
    }
  }

  details.appendChild(groupList);
  li.appendChild(details);

  return li;
};

const buildYamlObjectForAgent = (state) => {
  const { model } = state;
  const yamlObj = {};
  const activeLeaves = Object.values(model.features).filter(
    (feature) => isFeatureActive(state, feature.id) && isLeafFeature(model, feature.id),
  );

  for (const feature of activeLeaves) {
    const pathParts = model.featurePaths?.[feature.id] ?? [];
    if (!pathParts.length) {
      continue;
    }
    const rawValue = state.featureValues[feature.id];
    let value = null;
    if (Array.isArray(rawValue)) {
      value = rawValue.length ? rawValue : null;
    } else {
      const text = rawValue !== undefined ? String(rawValue).trim() : "";
      if (text !== "") {
        if (isBooleanFeatureName(feature.name)) {
          const boolValue = parseBoolean(text);
          value = boolValue === null ? true : boolValue;
        } else if (isNumberFeatureName(feature.name)) {
          const parsed = Number(text);
          value = Number.isNaN(parsed) ? text : parsed;
        } else {
          value = text;
        }
      } else if (isBooleanFeatureName(feature.name)) {
        value = true;
      } else {
        value = null;
      }
    }
    if (value !== null) {
      setNestedValue(yamlObj, pathParts, value);
    }
  }

  return yamlObj;
};

const dumpYaml = (data) => {
  if (window.jsyaml?.dump) {
    return window.jsyaml.dump(data, {
      noRefs: true,
      lineWidth: 120,
      sortKeys: false,
    });
  }
  return JSON.stringify(data, null, 2);
};

const addBlankLinesBetweenTopLevel = (yamlText) => {
  const lines = String(yamlText || "").split("\n");
  const output = [];
  let firstTopLevel = true;
  lines.forEach((line) => {
    const trimmed = line.trim();
    const isTopLevelKey = line && !line.startsWith(" ") && trimmed.endsWith(":");
    if (isTopLevelKey && !firstTopLevel) {
      output.push("");
    }
    if (isTopLevelKey) {
      firstTopLevel = false;
    }
    output.push(line);
  });
  return output.join("\n");
};

const dumpCrewaiYaml = (data) => {
  if (window.jsyaml?.dump) {
    const yamlText = window.jsyaml.dump(data, {
      noRefs: true,
      lineWidth: -1,
      sortKeys: false,
    });
    return addBlankLinesBetweenTopLevel(yamlText).trim();
  }
  return JSON.stringify(data, null, 2);
};

const createOrchestrationBuilderState = () => ({
  selectedAgents: [],
  lastAgentOptions: [],
  nodes: [],
  edges: [],
  nodeCounter: 0,
});

const nodeLabel = (node) => {
  if (node.type === "agent") {
    return `Agent: ${node.agentRef}`;
  }
  const name = node.name ? `${node.name}` : "orchestration";
  const suffix = node.strategy === "Loop" && node.turnCount ? ` (${node.turnCount})` : "";
  return `Orchestration: ${name} · ${node.strategy}${suffix}`;
};

const buildOrchestrationYaml = (state) => {
  if (!state.builder) {
    return buildYamlObjectForAgent(state);
  }
  const nodes = state.builder.nodes.map((node) => {
    if (node.type === "agent") {
      return {
        AgentNode: {
          AgentRef: node.agentRef,
        },
      };
    }
    const strategyPayload = {};
    if (node.strategy === "Loop") {
      strategyPayload.Loop = {};
      if (node.turnCount) {
        strategyPayload.Loop.TurnCount = node.turnCount;
      }
    } else if (node.strategy === "Parallel") {
      strategyPayload.Parallel = {};
      if (node.aggregator) {
        strategyPayload.Parallel.Aggregator = node.aggregator;
      }
    } else if (node.strategy === "custom") {
      strategyPayload.custom = {};
    } else {
      strategyPayload.Sequential = {};
    }
    const orchestrationNode = {
      Name: node.name || node.id,
      Strategy: strategyPayload,
    };
    if (Array.isArray(node.childNodes) && node.childNodes.length) {
      orchestrationNode.ChildNodes = node.childNodes.slice();
    }
    return {
      OrchestrationNode: orchestrationNode,
    };
  });

  const edges = state.builder.edges.map((edge) => ({
    FromNode: edge.from,
    ToNode: edge.to,
  }));

  const payload = {
    Agents: state.builder.selectedAgents.slice(),
    Orchestration: {
      Nodes: nodes,
      Edges: edges,
    },
  };

  return payload;
};

const pruneBuilderState = (state) => {
  if (!state.builder) {
    return;
  }
  const allowedAgents = new Set(state.builder.selectedAgents);
  state.builder.nodes = state.builder.nodes.filter((node) => {
    if (node.type === "agent") {
      return allowedAgents.has(node.agentRef);
    }
    return true;
  });
  const nodeIds = new Set(state.builder.nodes.map((node) => node.id));
  state.builder.edges = state.builder.edges.filter(
    (edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to),
  );
};

const renderOrchestrationBuilder = (state) => {
  if (!state.builder || !state.els.builderEl) {
    return;
  }
  const options = buildAgentOptionList();
  const optionValues = options.map((option) => option.value);
  state.builder.selectedAgents = state.builder.selectedAgents.filter((value) => optionValues.includes(value));
  if (!state.builder.selectedAgents.length && optionValues.length) {
    state.builder.selectedAgents = optionValues.slice();
  } else if (state.builder.lastAgentOptions.length === state.builder.selectedAgents.length) {
    const allPreviouslySelected = state.builder.lastAgentOptions.every((value) =>
      state.builder.selectedAgents.includes(value),
    );
    if (allPreviouslySelected) {
      const newOnes = optionValues.filter((value) => !state.builder.selectedAgents.includes(value));
      if (newOnes.length) {
        state.builder.selectedAgents = state.builder.selectedAgents.concat(newOnes);
      }
    }
  }
  state.builder.lastAgentOptions = optionValues.slice();
  const selectedSet = new Set(state.builder.selectedAgents);
  const { orchAgentsEl } = state.els;
  orchAgentsEl.innerHTML = "";
  options.forEach((option) => {
    const item = document.createElement("label");
    item.className = "agent-select-item";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedSet.has(option.value);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        state.builder.selectedAgents.push(option.value);
      } else {
        state.builder.selectedAgents = state.builder.selectedAgents.filter((val) => val !== option.value);
      }
      pruneBuilderState(state);
      renderOrchestrationBuilder(state);
      renderAgentYaml(state);
    });
    const span = document.createElement("span");
    span.textContent = option.label;
    item.appendChild(checkbox);
    item.appendChild(span);
    orchAgentsEl.appendChild(item);
  });

  const nodeType =
    state.els.nodeTypeSelect?.value || state.els.nodeTypeSelectClone?.value || "agent";
  if (state.els.nodeTypeSelectClone) {
    state.els.nodeTypeSelectClone.value = nodeType;
  }
  if (state.els.nodeTypeSelect) {
    state.els.nodeTypeSelect.value = nodeType;
  }
  if (state.els.nodeAgentFields && state.els.nodeOrchFields) {
    if (state.els.nodeInlineAgent) {
      state.els.nodeInlineAgent.style.display = nodeType === "agent" ? "" : "none";
    }
    if (state.els.nodeInlineOrch) {
      state.els.nodeInlineOrch.style.display = nodeType === "agent" ? "none" : "";
    }
    if (state.els.nodeInlineAdvanced) {
      state.els.nodeInlineAdvanced.style.display = nodeType === "agent" ? "none" : "";
    }
    state.els.nodeAgentFields.hidden = nodeType !== "agent";
    state.els.nodeOrchFields.hidden = nodeType === "agent";
    state.els.nodeOrchFields.style.display = nodeType === "agent" ? "none" : "";
    const orchInputs = state.els.nodeOrchFields.querySelectorAll("input, select");
    orchInputs.forEach((input) => {
      input.disabled = nodeType === "agent";
      if (nodeType === "agent" && input.type !== "hidden") {
        if (input.tagName === "SELECT") {
          input.selectedIndex = 0;
        } else {
          input.value = "";
        }
      }
    });
  }

  const nodeAgentSelect = state.els.nodeAgentSelect;
  if (nodeAgentSelect) {
    nodeAgentSelect.innerHTML = "";
    state.builder.selectedAgents.forEach((agentName) => {
      const opt = document.createElement("option");
      opt.value = agentName;
      opt.textContent = agentName;
      nodeAgentSelect.appendChild(opt);
    });
  }

  const strategy = state.els.nodeStrategySelect?.value || "Sequential";
  if (state.els.nodeTurnCountWrap) {
    state.els.nodeTurnCountWrap.hidden = strategy !== "Loop";
  }
  if (state.els.nodeAggregatorWrap) {
    state.els.nodeAggregatorWrap.hidden = strategy !== "Parallel";
  }
  if (state.els.nodeTurnCountInput) {
    state.els.nodeTurnCountInput.disabled = strategy !== "Loop";
    if (strategy !== "Loop") {
      state.els.nodeTurnCountInput.value = "";
    }
  }
  if (state.els.nodeAggregatorInput) {
    state.els.nodeAggregatorInput.disabled = strategy !== "Parallel";
    if (strategy !== "Parallel") {
      state.els.nodeAggregatorInput.value = "";
    }
  }
  if (state.els.nodeInlineAdvanced) {
    state.els.nodeInlineAdvanced.style.display = nodeType === "agent" ? "none" : "";
  }
  if (state.els.nodeChildrenWrap && state.els.nodeChildrenSelect) {
    state.els.nodeChildrenWrap.hidden = nodeType !== "orchestration";
    state.els.nodeChildrenSelect.innerHTML = "";
    state.builder.nodes.forEach((node) => {
      const item = document.createElement("label");
      item.className = "multi-select-item";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = node.id;
      checkbox.checked = Array.isArray(state.builder.tempChildNodes)
        ? state.builder.tempChildNodes.includes(node.id)
        : false;
      checkbox.addEventListener("change", () => {
        const selected = new Set(state.builder.tempChildNodes || []);
        if (checkbox.checked) {
          selected.add(node.id);
        } else {
          selected.delete(node.id);
        }
        state.builder.tempChildNodes = Array.from(selected);
      });
      const span = document.createElement("span");
      span.textContent = `${node.id}`;
      item.appendChild(checkbox);
      item.appendChild(span);
      state.els.nodeChildrenSelect.appendChild(item);
    });
  }

  if (state.els.nodeListEl) {
    state.els.nodeListEl.innerHTML = "";
    state.builder.nodes.forEach((node) => {
      const li = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = `${node.id} · ${nodeLabel(node)}`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "secondary";
      remove.textContent = "Supprimer";
      remove.addEventListener("click", () => {
        state.builder.nodes = state.builder.nodes.filter((item) => item.id !== node.id);
        pruneBuilderState(state);
        renderOrchestrationBuilder(state);
        renderAgentYaml(state);
      });
      li.appendChild(label);
      li.appendChild(remove);
      state.els.nodeListEl.appendChild(li);
    });
  }

  const nodeOptions = state.builder.nodes.map((node) => ({
    value: node.id,
    label: `${node.id} · ${nodeLabel(node)}`,
  }));
  const edgeFromSelect = state.els.edgeFromSelect;
  const edgeToSelect = state.els.edgeToSelect;
  if (edgeFromSelect && edgeToSelect) {
    edgeFromSelect.innerHTML = "";
    edgeToSelect.innerHTML = "";
    nodeOptions.forEach((opt) => {
      const fromOpt = document.createElement("option");
      fromOpt.value = opt.value;
      fromOpt.textContent = opt.label;
      edgeFromSelect.appendChild(fromOpt);
      const toOpt = document.createElement("option");
      toOpt.value = opt.value;
      toOpt.textContent = opt.label;
      edgeToSelect.appendChild(toOpt);
    });
  }

  if (state.els.edgeListEl) {
    state.els.edgeListEl.innerHTML = "";
    state.builder.edges.forEach((edge, index) => {
      const li = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = `${edge.from} → ${edge.to}`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "secondary";
      remove.textContent = "Supprimer";
      remove.addEventListener("click", () => {
        state.builder.edges = state.builder.edges.filter((_, idx) => idx !== index);
        renderOrchestrationBuilder(state);
        renderAgentYaml(state);
      });
      li.appendChild(label);
      li.appendChild(remove);
      state.els.edgeListEl.appendChild(li);
    });
  }

  renderOrchestrationGraph(state);
};

const renderOrchestrationGraph = (state) => {
  const svg = state.els.graphEl;
  if (!svg) {
    return;
  }
  const nodes = state.builder?.nodes || [];
  const edges = state.builder?.edges || [];
  const width = 600;
  const height = 160;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  if (!nodes.length) {
    svg.innerHTML = "";
    return;
  }
  const spacing = width / (nodes.length + 1);
  const positions = nodes.map((node, index) => ({
    id: node.id,
    x: spacing * (index + 1),
    y: height / 2,
  }));

  const lines = edges
    .map((edge) => {
      const from = positions.find((pos) => pos.id === edge.from);
      const to = positions.find((pos) => pos.id === edge.to);
      if (!from || !to) {
        return "";
      }
      return `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="#60a5fa" stroke-width="2" marker-end="url(#arrow)" />`;
    })
    .join("");

  const nodesMarkup = positions
    .map((pos) => {
      const label = nodes.find((node) => node.id === pos.id)?.type === "agent" ? "A" : "O";
      return `<g><circle cx="${pos.x}" cy="${pos.y}" r="18" fill="#1f2937" stroke="#93c5fd" stroke-width="2" /><text x="${pos.x}" y="${pos.y + 5}" text-anchor="middle" fill="#e2e8f0" font-size="12">${label}</text><text x="${pos.x}" y="${pos.y + 30}" text-anchor="middle" fill="#94a3b8" font-size="10">${pos.id}</text></g>`;
    })
    .join("");

  svg.innerHTML = `
    <defs>
      <marker id="arrow" markerWidth="10" markerHeight="10" refX="6" refY="3" orient="auto">
        <path d="M0,0 L0,6 L6,3 z" fill="#60a5fa" />
      </marker>
    </defs>
    ${lines}
    ${nodesMarkup}
  `;
};

const initOrchestrationBuilder = (state) => {
  if (state.builder) {
    return;
  }
  state.builder = createOrchestrationBuilderState();
  if (state.els.nodeTypeSelect) {
    state.els.nodeTypeSelect.addEventListener("change", () => renderOrchestrationBuilder(state));
  }
  if (state.els.nodeTypeSelectClone) {
    state.els.nodeTypeSelectClone.addEventListener("change", () => {
      if (state.els.nodeTypeSelect) {
        state.els.nodeTypeSelect.value = state.els.nodeTypeSelectClone.value;
      }
      renderOrchestrationBuilder(state);
    });
  }
  if (state.els.nodeStrategySelect) {
    state.els.nodeStrategySelect.addEventListener("change", () => renderOrchestrationBuilder(state));
  }
  if (state.els.addNodeButton) {
    state.els.addNodeButton.addEventListener("click", () => {
      const nodeType = state.els.nodeTypeSelect?.value || "agent";
      if (nodeType === "agent") {
        const agentRef = state.els.nodeAgentSelect?.value;
        if (!agentRef) {
          return;
        }
        const existingIds = new Set(state.builder.nodes.map((node) => node.id));
        let nodeId = agentRef;
        let suffix = 2;
        while (existingIds.has(nodeId)) {
          nodeId = `${agentRef}_${suffix}`;
          suffix += 1;
        }
        state.builder.nodes.push({
          id: nodeId,
          type: "agent",
          agentRef,
        });
      } else {
        const strategy = state.els.nodeStrategySelect?.value || "Sequential";
        const turnCount = Number(state.els.nodeTurnCountInput?.value || "");
        const aggregator = state.els.nodeAggregatorInput?.value?.trim() || "";
        const name = state.els.nodeOrchNameInput?.value?.trim();
        if (!name) {
          return;
        }
        const existingIds = new Set(state.builder.nodes.map((node) => node.id));
        let nodeId = name;
        let suffix = 2;
        while (existingIds.has(nodeId)) {
          nodeId = `${name}_${suffix}`;
          suffix += 1;
        }
        const childNodes = Array.isArray(state.builder.tempChildNodes)
          ? state.builder.tempChildNodes.slice()
          : [];
        state.builder.nodes.push({
          id: nodeId,
          type: "orchestration",
          name,
          strategy,
          turnCount: Number.isNaN(turnCount) ? null : turnCount,
          aggregator,
          childNodes,
        });
        state.builder.tempChildNodes = [];
      }
      renderOrchestrationBuilder(state);
      renderAgentYaml(state);
    });
  }
  if (state.els.addEdgeButton) {
    state.els.addEdgeButton.addEventListener("click", () => {
      const from = state.els.edgeFromSelect?.value;
      const to = state.els.edgeToSelect?.value;
      if (!from || !to) {
        return;
      }
      state.builder.edges.push({ from, to });
      renderOrchestrationBuilder(state);
      renderAgentYaml(state);
    });
  }
  if (state.els.autoChainButton) {
    state.els.autoChainButton.addEventListener("click", () => {
      const ids = state.builder.nodes.map((node) => node.id);
      state.builder.edges = [];
      for (let i = 0; i < ids.length - 1; i += 1) {
        state.builder.edges.push({ from: ids[i], to: ids[i + 1] });
      }
      renderOrchestrationBuilder(state);
      renderAgentYaml(state);
    });
  }
  renderOrchestrationBuilder(state);
};

const escapeHtml = (text) =>
  String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const decorateYamlText = (text) => {
  const lines = String(text ?? "").split("\n");
  return lines
    .map((line) => {
      if (!line.trim()) {
        return line;
      }
      const trimmed = line.trim();
      if (trimmed.startsWith("#")) {
        return `<span class="yaml-comment">${escapeHtml(line)}</span>`;
      }
      const match = line.match(/^(\s*)([^:#]+):(.*)$/);
      if (!match) {
        return escapeHtml(line);
      }
      const indent = match[1];
      const key = match[2].trim();
      const rest = match[3] ?? "";
      const hasValue = rest.trim().length > 0;
      let keyClass = "yaml-key";
      if (indent.length === 0) {
        keyClass += " yaml-root";
      } else if (hasValue) {
        keyClass += " yaml-leaf";
      } else {
        keyClass += " yaml-node";
      }
      if (!hasValue) {
        return `${escapeHtml(indent)}<span class="${keyClass}">${escapeHtml(key)}</span>:`;
      }
      return `${escapeHtml(indent)}<span class="${keyClass}">${escapeHtml(key)}</span>:<span class=\"yaml-value\">${escapeHtml(rest)}</span>`;
    })
    .join("\n");
};

const renderYamlPreview = (preEl, text) => {
  if (!preEl) {
    return;
  }
  preEl.innerHTML = decorateYamlText(text);
};

const setOutputText = (key, text) => {
  outputTextBlocks.forEach((block) => {
    if (block.dataset.output === key) {
      renderYamlPreview(block, text);
    }
  });
};

const updateOutputs = () => {
  const crewai = buildCrewaiOutputs();
  setOutputText("crewai-agents", dumpCrewaiYaml(crewai.agents));
  setOutputText("crewai-tasks", dumpCrewaiYaml(crewai.tasks));
  setOutputText("crewai-orchestration", "# Orchestration CrewAI a definir.");
  const adk = buildAdkOutputs();
  setOutputText("adk-agents", dumpYaml(adk.agents).trim());
  setOutputText("adk-orchestration", "# Orchestration ADK a definir.");
};

const scheduleOutputsUpdate = debounce(updateOutputs, 120);

const renderAgentYaml = (state) => {
  const yamlEl = state.els.yamlEl;
  if (!yamlEl) {
    return;
  }
  const yamlObj = state.kind === "orchestration" ? buildOrchestrationYaml(state) : buildYamlObjectForAgent(state);
  state.isSyncingYaml = true;
  const yamlText = dumpYaml(yamlObj).trim();
  yamlEl.value = yamlText;
  renderYamlPreview(state.els.yamlPreviewEl, yamlText);
  queueMicrotask(() => {
    state.isSyncingYaml = false;
  });
};

const renderAgentSummary = (state) => {
  const { model } = state;
  const activeEl = state.els.activeEl;
  const altEl = state.els.altEl;
  if (!activeEl || !altEl) {
    return;
  }

  const activeFeatures = Object.values(model.features)
    .filter((feature) => isFeatureActive(state, feature.id))
    .sort((a, b) => featurePath(model, a.id).localeCompare(featurePath(model, b.id), "fr"));

  activeEl.innerHTML = "";
  const visibleActive = activeFeatures.filter(
    (feature) => !feature.abstract || isLeafFeature(model, feature.id),
  );

  if (!visibleActive.length) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.textContent = "Aucune feature concrète active.";
    activeEl.appendChild(empty);
  } else {
    for (const feature of visibleActive) {
      const item = document.createElement("li");
      const path = featurePath(model, feature.id);
      const rawValue = state.featureValues[feature.id];
      const value = Array.isArray(rawValue)
        ? rawValue.join(", ")
        : (rawValue ?? "").trim();
      item.textContent = value ? `${path} = ${value}` : path;
      activeEl.appendChild(item);
    }
  }

  altEl.innerHTML = "";
  const alternativeGroups = Object.values(model.groups).filter((group) => group.type === "alternative");
  const shownGroups = alternativeGroups.filter((group) => isFeatureActive(state, group.parentFeatureId));

  if (!shownGroups.length) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.textContent = "Aucune alternative active.";
    altEl.appendChild(empty);
    return;
  }

  for (const group of shownGroups) {
    const selectedId = state.alternativeSelections[group.id];
    const selectedFeature = selectedId ? model.features[selectedId] : null;
    const item = document.createElement("li");
    const parentPath = featurePath(model, group.parentFeatureId);
    const selectedName = selectedFeature ? selectedFeature.name : "(aucun)";
    item.textContent = `${parentPath} → ${selectedName}`;
    altEl.appendChild(item);
  }
};

const findAgentTitle = (state) => {
  const { model } = state;
  const candidates = Object.values(model.features)
    .filter((feature) => isLeafFeature(model, feature.id) && feature.name.toLowerCase() === "name")
    .filter((feature) => isFeatureActive(state, feature.id))
    .map((feature) => (state.featureValues[feature.id] ?? "").trim())
    .filter(Boolean);
  if (candidates.length) {
    return candidates[0];
  }
  return "(nouvel agent)";
};

const renderAgentHeader = (state) => {
  const { titleEl } = state.els;
  if (!titleEl) {
    return;
  }
  if (state.kind !== "agent") {
    const label = state.label || "Orchestration";
    titleEl.textContent = label;
    return;
  }
  titleEl.textContent = findAgentTitle(state);
};

const renderMissingBadge = (state) => {
  const badge = state.els.missingBadge;
  if (!badge) {
    return;
  }
  const missingCount = getMissingRequiredCount(state);
  if (missingCount > 0) {
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
};

const activateAncestors = (state, featureId) => {
  const { model } = state;
  let currentId = featureId;
  while (currentId) {
    const feature = model.features[currentId];
    if (!feature) {
      break;
    }
    if (feature.relationType === "optional") {
      state.optionalSelections[currentId] = true;
    } else if (feature.relationType === "alternative" && feature.parentGroupId) {
      state.alternativeSelections[feature.parentGroupId] = currentId;
    }
    currentId = feature.parentFeatureId;
  }
};

const loadStateFromYamlObject = (state, data) => {
  resetFeatureState(state);
  const { model } = state;

  const alternativeGroups = Object.values(model.groups).filter((group) => group.type === "alternative");
  for (const group of alternativeGroups) {
    let selectedChild = state.alternativeSelections[group.id] ?? group.children[0] ?? null;
    for (const childId of group.children) {
      const pathParts = model.featurePaths?.[childId] ?? [];
      const { exists, value } = getValueAtPath(data, pathParts);
      if (exists && !isExplicitFalse(value)) {
        selectedChild = childId;
        break;
      }
    }
    state.alternativeSelections[group.id] = selectedChild;
  }

  for (const feature of Object.values(model.features)) {
    const pathParts = model.featurePaths?.[feature.id] ?? [];
    if (!pathParts.length) {
      continue;
    }
    const { exists, value } = getValueAtPath(data, pathParts);
    if (!exists || isExplicitFalse(value)) {
      continue;
    }

    activateAncestors(state, feature.id);

    if (isLeafFeature(model, feature.id)) {
      if (isAgentsFeature(state, feature)) {
        if (Array.isArray(value)) {
          state.featureValues[feature.id] = value.map(String);
        } else if (typeof value === "string" && value.trim() !== "") {
          state.featureValues[feature.id] = [value.trim()];
        } else {
          state.featureValues[feature.id] = [];
        }
      } else {
        state.featureValues[feature.id] = scalarToString(value);
      }
    } else if (feature.relationType === "optional") {
      state.optionalSelections[feature.id] = true;
    }
  }
};

const loadOrchestrationFromYamlObject = (state, data) => {
  if (!state.builder) {
    return;
  }
  const normalized = normalizeGearRoot(data);
  state.builder.selectedAgents = Array.isArray(normalized.Agents)
    ? normalized.Agents.map(String)
    : [];

  const nodesRaw = normalized.Orchestration?.Nodes;
  const nodes = [];
  if (Array.isArray(nodesRaw)) {
    nodesRaw.forEach((node, index) => {
      if (node?.AgentNode) {
        const agentRef = node.AgentNode.AgentRef || node.NodeId;
        nodes.push({
          id: agentRef || node.NodeId || `node_${index + 1}`,
          type: "agent",
          agentRef,
        });
      } else if (node?.OrchestrationNode) {
        const strategyBlock = node.OrchestrationNode.Strategy || {};
        const name = node.OrchestrationNode.Name || node.NodeId || `node_${index + 1}`;
        const strategy = Object.keys(strategyBlock)[0] || "Sequential";
        nodes.push({
          id: name || node.NodeId || `node_${index + 1}`,
          type: "orchestration",
          name,
          strategy,
          turnCount: strategyBlock.Loop?.TurnCount || null,
          aggregator: strategyBlock.Parallel?.Aggregator || "",
          childNodes: Array.isArray(node.OrchestrationNode.ChildNodes)
            ? node.OrchestrationNode.ChildNodes.slice()
            : [],
        });
      }
    });
  } else if (nodesRaw && typeof nodesRaw === "object") {
    Object.entries(nodesRaw).forEach(([nodeId, node]) => {
      if (node?.AgentNode) {
        const agentRef = node.AgentNode.AgentRef || nodeId;
        nodes.push({
          id: agentRef || nodeId,
          type: "agent",
          agentRef,
        });
      } else if (node?.OrchestrationNode) {
        const strategyBlock = node.OrchestrationNode.Strategy || {};
        const name = node.OrchestrationNode.Name || nodeId;
        const strategy = Object.keys(strategyBlock)[0] || "Sequential";
        nodes.push({
          id: name || nodeId,
          type: "orchestration",
          name,
          strategy,
          turnCount: strategyBlock.Loop?.TurnCount || null,
          aggregator: strategyBlock.Parallel?.Aggregator || "",
          childNodes: Array.isArray(node.OrchestrationNode.ChildNodes)
            ? node.OrchestrationNode.ChildNodes.slice()
            : [],
        });
      }
    });
  }

  state.builder.nodes = nodes;
  state.builder.nodeCounter = nodes.length;
  const edgesRaw = normalized.Orchestration?.Edges;
  state.builder.edges = Array.isArray(edgesRaw)
    ? edgesRaw.map((edge) => ({ from: edge.FromNode, to: edge.ToNode }))
    : [];
  pruneBuilderState(state);
  renderOrchestrationBuilder(state);
};

const loadFromYamlText = (state, text, options = {}) => {
  const { silent = false } = options;
  if (!state.model) {
    if (!silent) {
      setStatusForState(state, "Charge d'abord un UVL.", true);
    }
    return;
  }
  const trimmed = text.trim();
  if (!trimmed) {
    if (!silent) {
      setStatusForState(state, "Le YAML est vide.", true);
    }
    return;
  }
  try {
    const parsed = window.jsyaml?.load ? window.jsyaml.load(trimmed) : JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("YAML non valide");
    }
    if (state.kind === "orchestration") {
      loadOrchestrationFromYamlObject(state, parsed);
    }
    loadStateFromYamlObject(state, parsed);
    if (!silent) {
      setStatusForState(state, "YAML chargé dans l'UI.");
    }
    renderAgent(state);
  } catch (error) {
    console.error(error);
    if (!silent) {
      setStatusForState(state, "Impossible de parser ce YAML. Vérifie l'indentation et les clés.", true);
    }
  }
};

const copyYamlToClipboard = async (state) => {
  const yamlEl = state.els.yamlEl;
  if (!yamlEl) {
    return;
  }
  const text = yamlEl.value.trim();
  if (!text) {
    setStatusForState(state, "Rien à copier pour le moment.", true);
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    setStatusForState(state, "YAML copié dans le presse-papiers.");
  } catch (error) {
    console.error(error);
    setStatusForState(state, "Impossible de copier automatiquement. Copie-le manuellement.", true);
  }
};

const downloadYaml = (state) => {
  const yamlEl = state.els.yamlEl;
  if (!yamlEl) {
    return;
  }
  const text = yamlEl.value.trim();
  if (!text) {
    setStatusForState(state, "Rien à télécharger pour le moment.", true);
    return;
  }
  const blob = new Blob([text], { type: "text/yaml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  if (state.kind === "agent") {
    link.download = `agent-${agentStates.findIndex((agent) => agent.id === state.id) + 1}.yml`;
  } else {
    link.download = "orchestration.yml";
  }
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatusForState(state, "YAML téléchargé.");
};

const attachYamlSync = (state) => {
  const yamlEl = state.els.yamlEl;
  const loadButton = state.els.loadYamlButton;
  const copyButton = state.els.copyYamlButton;
  const downloadButton = state.els.downloadYamlButton;

  if (!yamlEl) {
    return;
  }

  const syncFromYaml = debounce(() => {
    if (state.isSyncingYaml) {
      return;
    }
    loadFromYamlText(state, yamlEl.value, { silent: true });
  }, 180);

  yamlEl.addEventListener("input", () => {
    renderYamlPreview(state.els.yamlPreviewEl, yamlEl.value);
    syncFromYaml();
  });

  yamlEl.addEventListener("scroll", () => {
    if (!state.els.yamlPreviewEl) {
      return;
    }
    const x = yamlEl.scrollLeft;
    const y = yamlEl.scrollTop;
    state.els.yamlPreviewEl.style.transform = `translate(${-x}px, ${-y}px)`;
  });

  if (loadButton) {
    loadButton.addEventListener("click", () => {
      loadFromYamlText(state, yamlEl.value, { silent: false });
      renderYamlPreview(state.els.yamlPreviewEl, yamlEl.value);
    });
  }

  if (copyButton) {
    copyButton.addEventListener("click", () => {
      copyYamlToClipboard(state);
    });
  }

  if (downloadButton) {
    downloadButton.addEventListener("click", () => {
      downloadYaml(state);
    });
  }
};

const removeAgent = (state) => {
  agentStates = agentStates.filter((agent) => agent.id !== state.id);
  if (state.rootEl) {
    state.rootEl.remove();
  }
  if (!agentStates.length) {
    addAgent();
  } else {
    agentStates.forEach((agent) => renderAgentHeader(agent));
  }
};

const removeOrchestration = (state) => {
  orchestrationStates = orchestrationStates.filter((item) => item.id !== state.id);
  if (state.rootEl) {
    state.rootEl.remove();
  }
  if (!orchestrationStates.length) {
    addOrchestration();
  } else {
    orchestrationStates.forEach((item) => renderAgentHeader(item));
  }
};

const renderAgentTree = (state) => {
  const treeEl = state.els.treeEl;
  if (!treeEl) {
    return;
  }
  const { model } = state;
  treeEl.innerHTML = "";
  const rootList = document.createElement("ul");
  for (const rootId of model.roots) {
    rootList.appendChild(renderFeature(state, rootId, true));
  }
  treeEl.appendChild(rootList);
};

const renderAgent = (state) => {
  if (!state.rootEl) {
    return;
  }
  renderAgentHeader(state);
  renderAgentTree(state);
  if (state.kind === "orchestration" && state.builder) {
    renderOrchestrationBuilder(state);
  }
  renderAgentSummary(state);
  renderAgentYaml(state);
  renderMissingBadge(state);
  scheduleOutputsUpdate();
};

const mountFeatureCard = (state, templateEl, containerEl) => {
  if (!templateEl || !containerEl) {
    return;
  }
  const fragment = templateEl.content.cloneNode(true);
  const rootEl = fragment.querySelector(".agent-card");
  const titleEl = fragment.querySelector(".agent-title");
  const treeEl = fragment.querySelector("[data-agent-tree]");
  const activeEl = fragment.querySelector("[data-agent-active]");
  const altEl = fragment.querySelector("[data-agent-alt-summary]");
  const yamlEl = fragment.querySelector("[data-agent-yaml]");
  const yamlPreviewEl = fragment.querySelector("[data-agent-yaml-preview]");
  const removeButton = fragment.querySelector(".remove-agent");
  const missingBadge = fragment.querySelector("[data-missing-badge]");
  const loadYamlButton = fragment.querySelector("[data-agent-load-yaml]");
  const copyYamlButton = fragment.querySelector("[data-agent-copy-yaml]");
  const downloadYamlButton = fragment.querySelector("[data-agent-download-yaml]");
  const tabInputs = fragment.querySelectorAll(".agent-tabs input[type=\"radio\"]");
  const builderEl = fragment.querySelector("[data-orchestration-builder]");
  const orchAgentsEl = fragment.querySelector("[data-orch-agents]");
  const nodeTypeSelect = fragment.querySelector("[data-node-type]");
  const nodeTypeSelectClone = fragment.querySelector("[data-node-type-clone]");
  const nodeAgentSelect = fragment.querySelector("[data-node-agent]");
  const nodeAgentFields = fragment.querySelector("[data-node-agent-fields]");
  const nodeInlineAgent = fragment.querySelector("[data-node-inline-type-agent]");
  const nodeInlineOrch = fragment.querySelector("[data-node-inline-type-orch]");
  const nodeOrchFields = fragment.querySelector("[data-node-orch-fields]");
  const nodeStrategySelect = fragment.querySelector("[data-node-strategy]");
  const nodeOrchNameInput = fragment.querySelector("[data-node-orch-name]");
  const nodeChildrenWrap = fragment.querySelector("[data-node-children]");
  const nodeChildrenSelect = fragment.querySelector("[data-node-children-select]");
  const nodeTurnCountWrap = fragment.querySelector("[data-node-turncount]");
  const nodeTurnCountInput = fragment.querySelector("[data-node-turncount-input]");
  const nodeAggregatorWrap = fragment.querySelector("[data-node-aggregator]");
  const nodeAggregatorInput = fragment.querySelector("[data-node-aggregator-input]");
  const nodeInlineAdvanced = fragment.querySelector("[data-node-inline-advanced]");
  const addNodeButton = fragment.querySelector("[data-add-node]");
  const nodeListEl = fragment.querySelector("[data-node-list]");
  const edgeFromSelect = fragment.querySelector("[data-edge-from]");
  const edgeToSelect = fragment.querySelector("[data-edge-to]");
  const addEdgeButton = fragment.querySelector("[data-add-edge]");
  const autoChainButton = fragment.querySelector("[data-auto-chain]");
  const edgeListEl = fragment.querySelector("[data-edge-list]");
  const graphEl = fragment.querySelector("[data-orch-graph]");

  state.rootEl = rootEl;
  state.els = {
    titleEl,
    treeEl,
    activeEl,
    altEl,
    yamlEl,
    yamlPreviewEl,
    removeButton,
    missingBadge,
    loadYamlButton,
    copyYamlButton,
    downloadYamlButton,
    tabInputs,
    builderEl,
    orchAgentsEl,
    nodeTypeSelect,
    nodeTypeSelectClone,
    nodeAgentSelect,
    nodeAgentFields,
    nodeInlineAgent,
    nodeInlineOrch,
    nodeOrchFields,
    nodeStrategySelect,
    nodeOrchNameInput,
    nodeChildrenWrap,
    nodeChildrenSelect,
    nodeTurnCountWrap,
    nodeTurnCountInput,
    nodeAggregatorWrap,
    nodeAggregatorInput,
    nodeInlineAdvanced,
    addNodeButton,
    nodeListEl,
    edgeFromSelect,
    edgeToSelect,
    addEdgeButton,
    autoChainButton,
    edgeListEl,
    graphEl,
  };

  if (rootEl) {
    rootEl.dataset.tab = "features";
  }

  if (tabInputs.length) {
    tabInputs.forEach((input) => {
      input.name = `${state.id}-tab`;
      const isDefault = input.dataset.defaultTab === "features";
      input.checked = isDefault;
      input.addEventListener("change", () => {
        if (input.checked && rootEl) {
          rootEl.dataset.tab = input.value;
        }
      });
    });
  }

  if (removeButton) {
    removeButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (state.kind === "agent") {
        removeAgent(state);
      } else {
        removeOrchestration(state);
      }
    });
  }

  attachYamlSync(state);
  if (state.kind === "orchestration") {
    initOrchestrationBuilder(state);
  }
  containerEl.appendChild(fragment);
  renderAgent(state);
};

const addAgent = () => {
  if (!agentModel) {
    setStatus("Charge un UVL avant d'ajouter des agents.", true, "agent");
    return;
  }
  const state = createFeatureState("agent", agentModel);
  agentStates.push(state);
  mountFeatureCard(state, agentTemplate, agentsContainer);
  agentStates.forEach((agent) => renderAgentHeader(agent));
  orchestrationStates.forEach((item) => renderAgent(item));
};

const addOrchestration = () => {
  if (!orchestrationModel) {
    setStatus("Charge un UVL d’orchestration avant d’ajouter une orchestration.", true, "orchestration");
    return;
  }
  const index = orchestrationStates.length + 1;
  const state = createFeatureState("orchestration", orchestrationModel, `Orchestration ${index}`);
  orchestrationStates.push(state);
  mountFeatureCard(state, orchestrationTemplate, orchestrationContainer);
  orchestrationStates.forEach((item) => renderAgentHeader(item));
};

const resetAgentsForModel = () => {
  agentStates = [];
  agentCounter = 0;
  agentsContainer.innerHTML = "";
  addAgent();
};

const resetOrchestrationForModel = () => {
  orchestrationStates = [];
  if (orchestrationContainer) {
    orchestrationContainer.innerHTML = "";
  }
  if (!orchestrationModel) {
    return;
  }
  addOrchestration();
};

const loadAgentFromText = (text, sourceLabel) => {
  const parsed = parseUvl(text);
  if (!parsed.roots.length) {
    throw new Error("Aucune feature racine détectée.");
  }
  parsed.featurePaths = buildPathIndex(parsed);
  agentModel = parsed;
  resetAgentsForModel();
  setStatus(`Modèle agents chargé depuis ${sourceLabel}.`, false, "agent");
};

const loadOrchestrationFromText = (text, sourceLabel) => {
  const parsed = parseUvl(text);
  if (!parsed.roots.length) {
    throw new Error("Aucune feature racine détectée.");
  }
  parsed.featurePaths = buildPathIndex(parsed);
  orchestrationModel = parsed;
  resetOrchestrationForModel();
  setStatus(`Modèle orchestration chargé depuis ${sourceLabel}.`, false, "orchestration");
};

const loadDefaultAgentModel = async () => {
  setStatus(`Chargement de ${DEFAULT_AGENT_UVL_PATH}…`, false, "agent");
  try {
    const text = await (async () => {
      const urls = buildUrlCandidates(DEFAULT_AGENT_UVL_PATH);
      let lastError = null;
      for (const url of urls) {
        try {
          const response = await fetch(url, { cache: "no-store" });
          if (!response.ok) {
            lastError = new Error(`HTTP ${response.status}`);
            continue;
          }
          return await response.text();
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError || new Error("Chargement impossible");
    })();
    loadAgentFromText(text, DEFAULT_AGENT_UVL_PATH);
  } catch (error) {
    console.error(error);
    setStatus(`Impossible de charger le modèle agents. Lance le serveur depuis la racine du projet.`, true, "agent");
  }
};

if (loadDefaultButton) {
  loadDefaultButton.addEventListener("click", () => {
    loadDefaultAgentModel();
  });
}

if (uvlFileInput) {
  uvlFileInput.addEventListener("change", async () => {
    const file = uvlFileInput.files?.[0];
    if (!file) {
      return;
    }
    setStatus(`Chargement de ${file.name}…`, false, "agent");
    try {
      const text = await file.text();
      loadAgentFromText(text, file.name);
    } catch (error) {
      console.error(error);
      setStatus(`Impossible de lire ${file.name}.`, true, "agent");
    }
  });
}

const syncFileLabel = (inputEl) => {
  const label = inputEl.closest(".file-input");
  if (!label) {
    return;
  }
  const nameEl = label.querySelector("[data-file-name]");
  if (!nameEl) {
    return;
  }
  const file = inputEl.files?.[0];
  nameEl.textContent = file ? file.name : "Choisir un fichier";
};

if (uvlFileInput) {
  uvlFileInput.addEventListener("change", () => {
    syncFileLabel(uvlFileInput);
  });
}

if (addAgentButton) {
  addAgentButton.addEventListener("click", () => {
    addAgent();
  });
}

if (addOrchestrationButton) {
  addOrchestrationButton.addEventListener("click", () => {
    addOrchestration();
  });
}

const loadDefaultOrchestrationModel = async () => {
  setStatus(`Chargement de ${DEFAULT_ORCHESTRATION_UVL_PATH}…`, false, "orchestration");
  try {
    const text = await (async () => {
      const urls = buildUrlCandidates(DEFAULT_ORCHESTRATION_UVL_PATH);
      let lastError = null;
      for (const url of urls) {
        try {
          const response = await fetch(url, { cache: "no-store" });
          if (!response.ok) {
            lastError = new Error(`HTTP ${response.status}`);
            continue;
          }
          return await response.text();
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError || new Error("Chargement impossible");
    })();
    loadOrchestrationFromText(text, DEFAULT_ORCHESTRATION_UVL_PATH);
  } catch (error) {
    console.error(error);
    setStatus(`Impossible de charger ${DEFAULT_ORCHESTRATION_UVL_PATH}.`, true, "orchestration");
  }
};

if (loadOrchestrationDefaultButton) {
  loadOrchestrationDefaultButton.addEventListener("click", () => {
    loadDefaultOrchestrationModel();
  });
}

if (orchestrationUvlFileInput) {
  orchestrationUvlFileInput.addEventListener("change", async () => {
    const file = orchestrationUvlFileInput.files?.[0];
    if (!file) {
      return;
    }
    setStatus(`Chargement de ${file.name}…`, false, "orchestration");
    try {
      const text = await file.text();
      loadOrchestrationFromText(text, file.name);
    } catch (error) {
      console.error(error);
      setStatus(`Impossible de lire ${file.name}.`, true, "orchestration");
    }
  });
}

if (orchestrationUvlFileInput) {
  orchestrationUvlFileInput.addEventListener("change", () => {
    syncFileLabel(orchestrationUvlFileInput);
  });
}

if (targetTabLabels.length) {
  targetTabLabels.forEach((label) => {
    const input = label.querySelector("input");
    if (!input) {
      return;
    }
    input.addEventListener("change", () => {
      if (input.checked) {
        setActiveTargetPanel(label.dataset.targetTab);
      }
    });
    if (input.checked) {
      setActiveTargetPanel(label.dataset.targetTab);
    }
  });
}

if (outputTabLabels.length) {
  outputTabLabels.forEach((label) => {
    const input = label.querySelector("input");
    if (!input) {
      return;
    }
    input.addEventListener("change", () => {
      if (input.checked) {
        setActiveOutputPanel(label.dataset.outputTab);
      }
    });
    if (input.checked) {
      setActiveOutputPanel(label.dataset.outputTab);
    }
  });
}

if (outputCopyButtons.length) {
  outputCopyButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      const pre = button.closest(".output-code")?.querySelector("[data-output]");
      const text = pre?.textContent?.trim();
      if (!text) {
        return;
      }
      try {
        await navigator.clipboard.writeText(text);
      } catch (error) {
        console.error(error);
      }
    });
  });
}

loadDefaultAgentModel();
loadDefaultOrchestrationModel();
loadConnectorsRegistry();
loadCrewaiMappings().then(() => {
  scheduleOutputsUpdate();
  initializeOutputPanels();
});
