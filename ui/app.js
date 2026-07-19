// UI entry points and shared state for the Gear web app.
const agentStatusEl = document.getElementById("agentStatus");
const moduleStatusEl = document.getElementById("moduleStatus");
const orchestrationStatusEl = document.getElementById("orchestrationStatus");
const loadDefaultButton = document.getElementById("loadDefault");
const uvlFileInput = document.getElementById("uvlFileInput");
const addAgentButton = document.getElementById("addAgent");
const agentsContainer = document.getElementById("agentsContainer");
const agentTemplate = document.getElementById("agentTemplate");
const loadModuleDefaultButton = document.getElementById("loadModuleDefault");
const moduleUvlFileInput = document.getElementById("moduleUvlFileInput");
const addModuleButton = document.getElementById("addModule");
const modulesContainer = document.getElementById("modulesContainer");
const moduleTemplate = document.getElementById("moduleTemplate");
const loadOrchestrationDefaultButton = document.getElementById("loadOrchestrationDefault");
const addOrchestrationButton = document.getElementById("addOrchestration");
const orchestrationUvlFileInput = document.getElementById("orchestrationUvlFileInput");
const orchestrationContainer = document.getElementById("orchestrationContainer");
const orchestrationTemplate = document.getElementById("orchestrationTemplate");
const connectorsStatusEl = document.getElementById("connectorsStatus");
const connectorsListEl = document.getElementById("connectorsList");
const targetTabsEl = document.getElementById("targetTabs");
const targetPanelsContainerEl = document.getElementById("targetPanelsContainer");
const featureModelModalEl = document.querySelector("[data-feature-model-modal]");
const featureModelCloseButton = document.querySelector("[data-feature-model-close]");
const featureModelZoomInButton = document.querySelector("[data-feature-model-zoom-in]");
const featureModelZoomOutButton = document.querySelector("[data-feature-model-zoom-out]");
const featureModelZoomResetButton = document.querySelector("[data-feature-model-zoom-reset]");
const featureModelDownloadLink = document.querySelector("[data-feature-model-download]");
const featureModelZoomLabelEl = document.querySelector("[data-feature-model-zoom-label]");
const featureModelSourceEl = document.querySelector("[data-feature-model-source]");
const featureModelRenderEl = document.querySelector("[data-feature-model-render]");
const featureModelErrorEl = document.querySelector("[data-feature-model-error]");
let targetTabLabels = [];
let targetPanels = [];
let outputTabLabels = [];
let outputBlocks = [];
let outputTextBlocks = [];
let outputCopyButtons = [];
let connectorsRegistry = null;
let featureModelZoom = 1;
let featureModelPreviousFocus = null;
let runCrewaiWorkflowButton = null;
let crewaiRunOutput = null;
let stopCrewaiWorkflowButton = null;
let runAdkWorkflowButton = null;
let adkRunOutput = null;
let stopAdkWorkflowButton = null;
const CREWAI_RUN_ENDPOINT = "/api/run";
let crewaiRunAborter = null;
let adkRunAborter = null;
const AUTOSAVE_KEY = "gear-project-autosave-v1";
let modelsLoading = true;
let pendingAutosave = window.GearProjectStorage?.load(AUTOSAVE_KEY) || null;

const saveProjectLocally = () => {
  if (modelsLoading || document.body.classList.contains("experiment-active")) return;
  const snapshot = {
    schema_version: "1.0",
    agents: agentStates.map((state) => state.els.yamlEl?.value || ""),
    modules: moduleStates.map((state) => state.els.yamlEl?.value || ""),
    workflows: orchestrationStates.map((state) => state.els.yamlEl?.value || ""),
  };
  window.GearProjectStorage?.save(AUTOSAVE_KEY, snapshot);
};

const GROUP_KEYWORDS = new Set(["mandatory", "optional", "alternative"]);
const DEFAULT_AGENT_UVL_PATH = "gear/gear-agent.uvl";
const DEFAULT_MODULE_UVL_PATH = "gear/gear-module.uvl";
const DEFAULT_ORCHESTRATION_UVL_PATH = "gear/gear-multiagent.uvl";
const CONNECTORS_REGISTRY_PATH = "connectors/registry.yml";
const ASSEMBLY_ENGINE_PATH = "runtime/assembly-engine.js";
const CREWAI_AGENT_MAPPING_PATH = "connectors/frameworks/crewai/agent.mapping.yml";
const CREWAI_MULTI_MAPPING_PATH = "connectors/frameworks/crewai/multiagent.mapping.yml";
const ADK_AGENT_MAPPING_PATH = "connectors/frameworks/adk/agent.mapping.yml";
const ADK_MULTI_MAPPING_PATH = "connectors/frameworks/adk/multiagent.mapping.yml";
const ADK_MODULE_MAPPING_PATH = "connectors/frameworks/adk/module.mapping.yml";
const FEATURE_POLICY_PATH = "ui/feature-policy.yml";

const SCALAR_ENUM_PARENTS_BY_KIND = {
  agent: new Set(["Provider", "Model"]),
};

const FIXED_FEATURE_VALUES_BY_NAME = {
  APIKey: "OPENAI_API_KEY",
};

const FEATURE_VALUE_ALIASES = {
  gpt_5_1_codex_mini: "gpt-5.1-codex-mini",
};

const TASK_FROM_PREFIXES = ["TaskSpecification"];
const TASK_TO_PREFIXES = ["Task."];

const FRAMEWORK_LIMITATIONS = {
  crewai: {
    orchestration: [
      { from: "GearWorkflow.Process.Parallel", notes: "CrewAI does not support parallel workflows." },
      { from: "GearWorkflow.Process.Loop", notes: "CrewAI does not support loop workflows." },
    ],
  },
};

let agentModel = null;
let moduleModel = null;
let orchestrationModel = null;
let featurePolicy = null;
let featurePolicyIndex = { enabled: false, byKind: {} };
let agentStates = [];
let moduleStates = [];
let orchestrationStates = [];
let agentCounter = 0;
let crewaiAgentMapping = null;
let crewaiMultiMapping = null;
let adkAgentMapping = null;
let adkMultiMapping = null;
let adkModuleMapping = null;

const DEFAULT_MODULE_UVL_FALLBACK = `features
  GearModule {abstract}
    mandatory
      ModuleName {abstract}
      Strategy {abstract}
        alternative
          Parallel {abstract}
            mandatory
              ParallelAgents {abstract}
          Loop {abstract}
            mandatory
              TurnCount {abstract}
              StopCondition {abstract}
              LoopAgents {abstract}
`;

const ensureModuleTemplate = () => {
  const existing = document.getElementById("moduleTemplate");
  if (existing) {
    return existing;
  }
  if (!agentTemplate) {
    return null;
  }
  const template = document.createElement("template");
  template.id = "moduleTemplate";
  template.innerHTML = agentTemplate.innerHTML;
  const summaryTitle = template.content.querySelector("summary > div");
  if (summaryTitle) {
    summaryTitle.innerHTML = 'Module: <span class="agent-title">(new module)</span>';
  }
  const hint = template.content.querySelector(".summary-block .hint");
  if (hint) {
    hint.textContent = "Pasting YAML here instantly updates the module.";
  }
  const tabs = template.content.querySelector(".segmented.tabs");
  if (tabs) {
    tabs.setAttribute("aria-label", "Module view");
  }
  document.body.appendChild(template);
  return template;
};

const ensureModuleModel = () => {
  if (moduleModel) {
    return true;
  }
  try {
    const parsed = parseUvl(DEFAULT_MODULE_UVL_FALLBACK);
    if (!parsed.roots.length) {
      return false;
    }
    parsed.featurePaths = buildPathIndex(parsed);
    moduleModel = parsed;
    resetModulesForModel();
    return true;
  } catch (error) {
    console.error(error);
    return false;
  }
};


const indentOf = (line) => {
  const match = line.match(/^\s*/);
  const raw = match ? match[0] : "";
  return raw.replace(/\t/g, "  ").length;
};

const parseFeatureLine = (line) => {
  const nameMatch = line.match(/^([A-Za-z0-9_.-]+)/);
  if (!nameMatch) {
    return null;
  }
  const name = nameMatch[1];
  const abstract =
    /{[^}]*\babstract\b[^}]*}/i.test(line) || /\babstract\s+true\b/i.test(line);
  return { name, abstract };
};

const stripInlineComment = (line) => {
  const idx = line.indexOf("//");
  if (idx === -1) {
    return line;
  }
  return line.slice(0, idx);
};

const tokenizeConstraint = (text) => {
  const tokens = [];
  let i = 0;
  const push = (type, value) => {
    tokens.push(value !== undefined ? { type, value } : { type });
  };
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (text.startsWith("<=>", i)) {
      push("IFF");
      i += 3;
      continue;
    }
    if (text.startsWith("=>", i)) {
      push("IMPLIES");
      i += 2;
      continue;
    }
    if (ch === "(") {
      push("LPAREN");
      i += 1;
      continue;
    }
    if (ch === ")") {
      push("RPAREN");
      i += 1;
      continue;
    }
    if (ch === "!") {
      push("NOT");
      i += 1;
      continue;
    }
    if (ch === "|") {
      push("OR");
      i += 1;
      continue;
    }
    if (ch === "&") {
      push("AND");
      i += 1;
      continue;
    }
    if (/[A-Za-z0-9_.-]/.test(ch)) {
      let j = i + 1;
      while (j < text.length && /[A-Za-z0-9_.-]/.test(text[j])) {
        j += 1;
      }
      const word = text.slice(i, j);
      const lower = word.toLowerCase();
      if (lower === "or") {
        push("OR");
      } else if (lower === "and") {
        push("AND");
      } else if (lower === "not") {
        push("NOT");
      } else {
        push("IDENT", word);
      }
      i = j;
      continue;
    }
    i += 1;
  }
  return tokens;
};

const parseConstraintAst = (text) => {
  const tokens = tokenizeConstraint(text);
  let idx = 0;
  const peek = () => tokens[idx] || null;
  const match = (type) => {
    if (peek()?.type === type) {
      idx += 1;
      return true;
    }
    return false;
  };
  const parseExpression = () => parseIff();
  const parseIff = () => {
    let node = parseImplies();
    while (match("IFF")) {
      const right = parseImplies();
      node = { type: "iff", left: node, right };
    }
    return node;
  };
  const parseImplies = () => {
    const left = parseOr();
    if (match("IMPLIES")) {
      const right = parseImplies();
      return { type: "implies", left, right };
    }
    return left;
  };
  const parseOr = () => {
    let node = parseAnd();
    while (match("OR")) {
      const right = parseAnd();
      node = { type: "or", left: node, right };
    }
    return node;
  };
  const parseAnd = () => {
    let node = parseUnary();
    while (match("AND")) {
      const right = parseUnary();
      node = { type: "and", left: node, right };
    }
    return node;
  };
  const parseUnary = () => {
    if (match("NOT")) {
      const expr = parseUnary();
      return { type: "not", expr };
    }
    if (match("LPAREN")) {
      const expr = parseExpression();
      match("RPAREN");
      return expr;
    }
    const token = peek();
    if (token?.type === "IDENT") {
      idx += 1;
      return { type: "ident", name: token.value };
    }
    return null;
  };
  const ast = parseExpression();
  return ast;
};

const parseConstraints = (lines) => {
  const constraints = [];
  for (const line of lines) {
    const trimmed = stripInlineComment(line).trim();
    if (!trimmed) {
      continue;
    }
    const ast = parseConstraintAst(trimmed);
    constraints.push({ text: trimmed, ast });
  }
  return constraints;
};

const extractLiteral = (node) => {
  if (!node) return null;
  if (node.type === "ident") {
    return { name: node.name, negated: false };
  }
  if (node.type === "not" && node.expr?.type === "ident") {
    return { name: node.expr.name, negated: true };
  }
  return null;
};

const extractImplicationRules = (ast) => {
  if (!ast) return [];
  if (ast.type === "iff") {
    const leftLit = extractLiteral(ast.left);
    const rightLit = extractLiteral(ast.right);
    if (leftLit && rightLit) {
      return [
        { left: leftLit, right: rightLit },
        { left: rightLit, right: leftLit },
      ];
    }
    return [];
  }
  if (ast.type === "implies") {
    const leftLit = extractLiteral(ast.left);
    const rightLit = extractLiteral(ast.right);
    if (leftLit && rightLit) {
      return [{ left: leftLit, right: rightLit }];
    }
  }
  return [];
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
  const constraintLines = [];
  let featureCounter = 0;
  let groupCounter = 0;
  let inConstraints = false;

  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("//")) {
      continue;
    }
    if (trimmed === "constraints") {
      inConstraints = true;
      continue;
    }
    if (inConstraints) {
      const cleaned = stripInlineComment(rawLine).trim();
      if (cleaned) {
        constraintLines.push(cleaned);
      }
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

  const model = { features, groups, roots };
  model.constraints = parseConstraints(constraintLines);
  model.constraintRules = model.constraints.flatMap((item) => extractImplicationRules(item.ast));
  model.featureNameIndex = Object.values(features).reduce((acc, feature) => {
    if (feature?.name && !acc[feature.name]) {
      acc[feature.name] = feature.id;
    }
    return acc;
  }, {});
  return model;
};

const evaluateConstraintAst = (ast, selection) => {
  if (!ast) {
    return true;
  }
  switch (ast.type) {
    case "ident":
      return selection[ast.name] === true;
    case "not":
      return !evaluateConstraintAst(ast.expr, selection);
    case "and":
      return evaluateConstraintAst(ast.left, selection) && evaluateConstraintAst(ast.right, selection);
    case "or":
      return evaluateConstraintAst(ast.left, selection) || evaluateConstraintAst(ast.right, selection);
    case "implies": {
      const left = evaluateConstraintAst(ast.left, selection);
      const right = evaluateConstraintAst(ast.right, selection);
      return !left || right;
    }
    case "iff": {
      const left = evaluateConstraintAst(ast.left, selection);
      const right = evaluateConstraintAst(ast.right, selection);
      return left === right;
    }
    default:
      return true;
  }
};

const buildSelectionMap = (state) => {
  const selection = {};
  if (!state?.model?.features) {
    return selection;
  }
  Object.values(state.model.features).forEach((feature) => {
    selection[feature.name] = isFeatureActive(state, feature.id);
  });
  return selection;
};

const getFeatureIdByName = (model, name) => {
  if (!model || !name) {
    return null;
  }
  return model.featureNameIndex?.[name] ?? null;
};

const setFeatureActiveById = (state, featureId, enabled) => {
  const { model } = state;
  const feature = model.features[featureId];
  if (!feature) {
    return false;
  }
  const currentlyActive = isFeatureActive(state, featureId);
  if (enabled && currentlyActive) {
    return false;
  }
  if (!enabled && !currentlyActive) {
    return false;
  }
  if (enabled) {
    activateAncestors(state, featureId);
    if (feature.relationType === "optional") {
      state.optionalSelections[featureId] = true;
    } else if (feature.relationType === "alternative" && feature.parentGroupId) {
      state.alternativeSelections[feature.parentGroupId] = featureId;
    }
    return true;
  }
  if (feature.relationType === "optional") {
    state.optionalSelections[featureId] = false;
    state.featureValues[featureId] = "";
  } else if (feature.relationType === "alternative" && feature.parentGroupId) {
    const group = model.groups[feature.parentGroupId];
    const fallback = group?.children?.find((childId) => childId !== featureId) ?? featureId;
    state.alternativeSelections[feature.parentGroupId] = fallback;
  }
  return true;
};

const applyFeaturePolicyToState = (state) => {
  const policy = getPolicyForState(state);
  if (!policy || !state?.model) {
    return;
  }
  const { model } = state;

  policy.forced.forEach((value, parentName) => {
    const parent = findFeatureByNormalizedName(model, parentName);
    if (!parent) {
      return;
    }
    const groupId = (parent.groups || []).find((id) => model.groups[id]?.type === "alternative");
    if (!groupId) {
      return;
    }
    const group = model.groups[groupId];
    const normalizedValue = normalizeFeatureName(value);
    let selectedId = group.children.find(
      (childId) => normalizeFeatureName(model.features[childId]?.name) === normalizedValue,
    );
    if (!selectedId) {
      const abstractChild = group.children.find((childId) => model.features[childId]?.abstract);
      if (abstractChild) {
        selectedId = abstractChild;
        state.featureValues[abstractChild] = String(value);
      }
    }
    if (selectedId) {
      state.alternativeSelections[groupId] = selectedId;
      activateAncestors(state, selectedId);
    }
  });

  if (!policy.disabled.size) {
    return;
  }

  Object.values(model.features).forEach((feature) => {
    if (!policy.disabled.has(normalizeFeatureName(feature.name))) {
      return;
    }
    if (feature.relationType === "optional") {
      state.optionalSelections[feature.id] = false;
      state.featureValues[feature.id] = "";
      return;
    }
    if (feature.relationType === "alternative" && feature.parentGroupId) {
      const group = model.groups[feature.parentGroupId];
      if (!group) {
        return;
      }
      const parent = model.features[group.parentFeatureId];
      const forcedValue = parent ? policy.forced.get(normalizeFeatureName(parent.name)) : null;
      let fallbackId = null;
      if (forcedValue) {
        const normalizedValue = normalizeFeatureName(forcedValue);
        fallbackId = group.children.find(
          (childId) => normalizeFeatureName(model.features[childId]?.name) === normalizedValue,
        );
      }
      if (!fallbackId) {
        fallbackId = group.children.find(
          (childId) => !policy.disabled.has(normalizeFeatureName(model.features[childId]?.name)),
        );
      }
      if (fallbackId) {
        state.alternativeSelections[group.id] = fallbackId;
      }
    }
  });
};

const applyPolicyToAllStates = () => {
  [...agentStates, ...moduleStates, ...orchestrationStates].forEach((state) => {
    if (state?.rootEl) {
      renderAgent(state);
    }
  });
};

const enforceFixedValues = (state) => {
  const { model } = state;
  for (const [name, value] of Object.entries(FIXED_FEATURE_VALUES_BY_NAME)) {
    const featureId = getFeatureIdByName(model, name);
    if (!featureId) {
      continue;
    }
    if (isFeatureActive(state, featureId)) {
      state.featureValues[featureId] = value;
    } else {
      state.featureValues[featureId] = "";
    }
  }
};

const applyConstraintsToState = (state) => {
  const { model } = state;
  applyFeaturePolicyToState(state);
  if (!model?.constraints?.length) {
    state.constraintViolations = [];
    return;
  }
  const rules = model.constraintRules || [];
  let changed = true;
  let safety = 0;
  while (changed && safety < 10) {
    changed = false;
    safety += 1;
    for (const rule of rules) {
      if (rule.left?.negated) {
        continue;
      }
      const leftId = getFeatureIdByName(model, rule.left.name);
      if (!leftId || !isFeatureActive(state, leftId)) {
        continue;
      }
      const rightId = getFeatureIdByName(model, rule.right.name);
      if (!rightId) {
        continue;
      }
      const shouldEnable = !rule.right.negated;
      const updated = setFeatureActiveById(state, rightId, shouldEnable);
      if (updated) {
        changed = true;
      }
    }
  }
  enforceFixedValues(state);
  const selection = buildSelectionMap(state);
  const violations = model.constraints.filter((item) => item.ast && !evaluateConstraintAst(item.ast, selection));
  state.constraintViolations = violations;
};

const isScalarEnumParent = (state, feature) => {
  if (!state?.kind || !feature?.name) {
    return false;
  }
  const set = SCALAR_ENUM_PARENTS_BY_KIND[state.kind];
  if (!set) {
    return false;
  }
  return set.has(feature.name);
};

const isScalarEnumGroup = (state, group) => {
  if (!group || group.type !== "alternative") {
    return false;
  }
  const parentFeature = state.model?.features?.[group.parentFeatureId];
  return isScalarEnumParent(state, parentFeature);
};

const isScalarEnumChild = (state, feature) => {
  if (!feature?.parentGroupId) {
    return false;
  }
  const group = state.model?.groups?.[feature.parentGroupId];
  if (!group || group.type !== "alternative") {
    return false;
  }
  const parentFeature = state.model?.features?.[group.parentFeatureId];
  return isScalarEnumParent(state, parentFeature);
};

const getFixedFeatureValue = (feature) => {
  if (!feature?.name) {
    return null;
  }
  return FIXED_FEATURE_VALUES_BY_NAME[feature.name] ?? null;
};

const normalizeFromList = (from) => {
  if (!from) {
    return [];
  }
  const list = Array.isArray(from) ? from : [from];
  return list
    .map((item) => String(item || "").trim())
    .filter(Boolean);
};

const isTaskMappingEntry = (entry) => {
  const fromList = normalizeFromList(entry?.from);
  if (fromList.some((item) => TASK_FROM_PREFIXES.some((prefix) => item.startsWith(prefix)))) {
    return true;
  }
  const toValue = entry?.to ? String(entry.to).trim() : "";
  return TASK_TO_PREFIXES.some((prefix) => toValue.startsWith(prefix));
};

const formatDisplayPath = (prefix, path) => {
  if (!prefix) {
    return path;
  }
  if (path === prefix || path.startsWith(`${prefix}.`)) {
    return path;
  }
  return `${prefix}.${path}`;
};

const buildActiveTranslationSummary = (entries, sources, prefix) => {
  const translated = new Map();
  const untranslated = new Map();
  const sourceList = Array.isArray(sources) ? sources : [];
  (entries || []).forEach((entry) => {
    const fromList = normalizeFromList(entry?.from);
    if (!fromList.length) {
      return;
    }
    const isTranslated = entry?.kind !== "not_mapped" && entry?.to;
    fromList.forEach((fromPath) => {
      const active = sourceList.some((source) => {
        if (!source || typeof source !== "object") {
          return false;
        }
        return getValueAtPath(source, pathToParts(fromPath)).exists;
      });
      if (!active) {
        return;
      }
      const displayPath = formatDisplayPath(prefix, fromPath);
      if (isTranslated) {
        const targetPath = entry?.to ? String(entry.to).trim() : "";
        const key = `${displayPath}=>${targetPath}`;
        if (!translated.has(key)) {
          translated.set(key, {
            from: displayPath,
            to: targetPath,
            notes: entry?.notes,
          });
        }
      } else {
        if (!untranslated.has(displayPath)) {
          untranslated.set(displayPath, {
            from: displayPath,
            notes: entry?.notes,
          });
        }
      }
    });
  });
  const toSortedArray = (map) =>
    Array.from(map.values()).sort((a, b) => a.from.localeCompare(b.from, "fr"));
  return {
    translated: toSortedArray(translated),
    untranslated: toSortedArray(untranslated),
  };
};

const buildActiveTranslationSummaryFromPaths = (entries, activePaths) => {
  const translated = new Map();
  const untranslated = new Map();
  const paths = Array.isArray(activePaths) ? activePaths : [];
  const byFrom = new Map();

  (entries || []).forEach((entry) => {
    const fromList = normalizeFromList(entry?.from);
    if (!fromList.length) {
      return;
    }
    fromList.forEach((fromPath) => {
      if (!byFrom.has(fromPath)) {
        byFrom.set(fromPath, []);
      }
      byFrom.get(fromPath).push(entry);
    });
  });

  paths.forEach((path) => {
    const matches = byFrom.get(path) || [];
    if (!matches.length) {
      if (!untranslated.has(path)) {
        untranslated.set(path, { from: path, notes: "No mapping." });
      }
      return;
    }
    let hasTranslated = false;
    matches.forEach((entry) => {
      const isTranslated = entry?.kind !== "not_mapped" && entry?.to;
      if (!isTranslated) {
        return;
      }
      const targetPath = entry?.to ? String(entry.to).trim() : "";
      const key = `${path}=>${targetPath}`;
      if (!translated.has(key)) {
        translated.set(key, { from: path, to: targetPath, notes: entry?.notes });
      }
      hasTranslated = true;
    });
    if (!hasTranslated && !untranslated.has(path)) {
      const note = matches.find((entry) => entry?.notes)?.notes;
      untranslated.set(path, { from: path, notes: note });
    }
  });

  const toSortedArray = (map) =>
    Array.from(map.values()).sort((a, b) => a.from.localeCompare(b.from, "fr"));
  return {
    translated: toSortedArray(translated),
    untranslated: toSortedArray(untranslated),
  };
};

const buildUnavailableSummary = (entries, prefix, activePaths) => {
  const unavailable = new Map();
  const activeSet = Array.isArray(activePaths) ? new Set(activePaths) : null;
  (entries || []).forEach((entry) => {
    const fromList = normalizeFromList(entry?.from);
    if (!fromList.length) {
      return;
    }
    const isUnavailable = entry?.kind === "not_mapped" || !entry?.to;
    if (!isUnavailable) {
      return;
    }
    fromList.forEach((fromPath) => {
      const displayPath = formatDisplayPath(prefix, fromPath);
      if (activeSet && !activeSet.has(displayPath)) {
        return;
      }
      if (!unavailable.has(displayPath)) {
        unavailable.set(displayPath, {
          from: displayPath,
          notes: entry?.notes,
        });
      }
    });
  });
  return Array.from(unavailable.values()).sort((a, b) => a.from.localeCompare(b.from, "fr"));
};

const buildFixedSummary = (entries) => {
  const fixed = new Map();
  (entries || []).forEach((entry) => {
    const fromList = normalizeFromList(entry?.from);
    if (fromList.length) {
      return;
    }
    if (!entry?.to || !("value" in entry)) {
      return;
    }
    const target = String(entry.to).trim();
    if (!target) {
      return;
    }
    const value = entry.value;
    const label = `${target} = ${value}`;
    if (!fixed.has(label)) {
      fixed.set(label, { label, notes: entry?.notes });
    }
  });
  return Array.from(fixed.values()).sort((a, b) => a.label.localeCompare(b.label, "fr"));
};

const getFrameworkLimitations = (frameworkId, outputKey) => {
  const framework = FRAMEWORK_LIMITATIONS?.[frameworkId];
  if (!framework) {
    return [];
  }
  if (outputKey === "global") {
    return Object.values(framework)
      .flatMap((items) => (Array.isArray(items) ? items : []))
      .map((item) => {
        const from = item?.from ? String(item.from).trim() : "";
        if (!from) {
          return null;
        }
        return {
          from,
          to: null,
          kind: "not_mapped",
          notes: item?.notes,
        };
      })
      .filter(Boolean);
  }
  const items = framework[outputKey];
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .map((item) => {
      const from = item?.from ? String(item.from).trim() : "";
      if (!from) {
        return null;
      }
      return {
        from,
        to: null,
        kind: "not_mapped",
        notes: item?.notes,
      };
    })
    .filter(Boolean);
};

const prefixMappingEntries = (entries, prefix) => {
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries
    .map((entry) => {
      if (!entry) {
        return null;
      }
      const fromList = normalizeFromList(entry?.from);
      if (!fromList.length) {
        return { ...entry };
      }
      const prefixed = fromList.map((fromPath) => formatDisplayPath(prefix, fromPath));
      return {
        ...entry,
        from: prefixed.length === 1 ? prefixed[0] : prefixed,
      };
    })
    .filter(Boolean);
};

const buildSyntheticModuleEntries = (model, notesText) => {
  if (!model?.featurePaths || !model?.features) {
    return null;
  }
  const entries = Object.values(model.features)
    .filter((feature) => isLeafFeature(model, feature.id))
    .map((feature) => {
      const pathParts = model.featurePaths?.[feature.id] ?? [];
      if (pathParts.length <= 1) {
        return null;
      }
      return {
        from: pathParts.slice(1).join("."),
        to: null,
        kind: "not_mapped",
        notes: notesText,
      };
    })
    .filter(Boolean);
  return entries;
};

const getMappingEntriesForOutput = (frameworkId, outputKey) => {
  if (frameworkId === "crewai") {
    if (outputKey === "agents") {
      return Array.isArray(crewaiAgentMapping)
        ? crewaiAgentMapping.filter((entry) => !isTaskMappingEntry(entry))
        : null;
    }
    if (outputKey === "tasks") {
      return Array.isArray(crewaiAgentMapping)
        ? crewaiAgentMapping.filter((entry) => isTaskMappingEntry(entry))
        : null;
    }
    if (outputKey === "modules") {
      return buildSyntheticModuleEntries(moduleModel, "CrewAI does not support modules.");
    }
    if (outputKey === "orchestration") {
      return Array.isArray(crewaiMultiMapping) ? crewaiMultiMapping : null;
    }
  }
  if (frameworkId === "adk") {
    if (outputKey === "agents") {
      return Array.isArray(adkAgentMapping) ? adkAgentMapping : null;
    }
    if (outputKey === "modules") {
      return Array.isArray(adkModuleMapping) ? adkModuleMapping : null;
    }
    if (outputKey === "orchestration") {
      return Array.isArray(adkMultiMapping) ? adkMultiMapping : null;
    }
  }
  return null;
};

const getGlobalMappingEntriesForFramework = (frameworkId) => {
  const entries = [];
  if (frameworkId === "crewai") {
    entries.push(...prefixMappingEntries(crewaiAgentMapping, "GearAgent"));
    entries.push(...prefixMappingEntries(crewaiMultiMapping, "GearWorkflow"));
    const synthetic = buildSyntheticModuleEntries(moduleModel, "CrewAI does not support modules.");
    entries.push(...prefixMappingEntries(synthetic, "GearModule"));
    return entries.length ? entries : null;
  }
  if (frameworkId === "adk") {
    entries.push(...prefixMappingEntries(adkAgentMapping, "GearAgent"));
    entries.push(...prefixMappingEntries(adkModuleMapping, "GearModule"));
    entries.push(...prefixMappingEntries(adkMultiMapping, "GearWorkflow"));
    return entries.length ? entries : null;
  }
  return null;
};

const getTranslationRootPrefix = (frameworkId, outputKey) => {
  if (outputKey === "agents" || outputKey === "tasks") {
    return "GearAgent";
  }
  if (outputKey === "modules") {
    return "GearModule";
  }
  if (outputKey === "orchestration") {
    return "GearWorkflow";
  }
  return "";
};

const getTranslationSourcesForOutput = (frameworkId, outputKey, context) => {
  const { gearAgents, gearModules, modulePresence, workflowYaml } = context || {};
  if (frameworkId === "crewai") {
    if (outputKey === "agents" || outputKey === "tasks") {
      return gearAgents || [];
    }
    if (outputKey === "modules") {
      const sources = [];
      if (Array.isArray(gearModules)) {
        sources.push(...gearModules);
      }
      if (Array.isArray(modulePresence)) {
        sources.push(...modulePresence);
      }
      return sources;
    }
    if (outputKey === "orchestration") {
      return workflowYaml ? [workflowYaml] : [];
    }
  }
  if (frameworkId === "adk") {
    if (outputKey === "agents") {
      return gearAgents || [];
    }
    if (outputKey === "modules") {
      const sources = [];
      if (Array.isArray(gearModules)) {
        sources.push(...gearModules);
      }
      if (Array.isArray(modulePresence)) {
        sources.push(...modulePresence);
      }
      return sources;
    }
    if (outputKey === "orchestration") {
      return workflowYaml ? [workflowYaml] : [];
    }
  }
  return [];
};

const renderTranslationSummary = (outputId, entries, sources, activePaths) => {
  const top = document.querySelector(`[data-translation-top="${outputId}"]`);
  const bottom = document.querySelector(`[data-translation-bottom="${outputId}"]`);
  const unavailablePanel = document.querySelector(`[data-translation-unavailable="${outputId}"]`);
  if (!top || !bottom || !unavailablePanel) {
    return;
  }
  const translatedList = top.querySelector('[data-translation-list="translated"]');
  const untranslatedList = bottom.querySelector('[data-translation-list="untranslated"]');
  const unavailableList = unavailablePanel.querySelector('[data-translation-list="unavailable"]');
  const fixedList = bottom.querySelector('[data-translation-list="fixed"]');
  if (!translatedList || !untranslatedList || !unavailableList || !fixedList) {
    return;
  }
  translatedList.innerHTML = "";
  untranslatedList.innerHTML = "";
  unavailableList.innerHTML = "";
  fixedList.innerHTML = "";

  const outputKey = outputId.split("-").slice(1).join("-");
  const frameworkId = outputId.split("-")[0];
  const prefix = getTranslationRootPrefix(frameworkId, outputKey);
  const limitations = getFrameworkLimitations(frameworkId, outputKey);
  const combinedEntries = [...(entries || []), ...limitations];

  if (!entries && !limitations.length) {
    const makeItem = () => {
      const item = document.createElement("li");
      item.className = "empty-state";
      item.textContent = "Mappings unavailable.";
      return item;
    };
    translatedList.appendChild(makeItem());
    untranslatedList.appendChild(makeItem());
    unavailableList.appendChild(makeItem());
    fixedList.appendChild(makeItem());
    return;
  }

  const summary = Array.isArray(activePaths)
    ? buildActiveTranslationSummaryFromPaths(combinedEntries, activePaths)
    : buildActiveTranslationSummary(combinedEntries, sources, prefix);
  const unavailable = buildUnavailableSummary(combinedEntries, prefix, activePaths);
  const fixed = buildFixedSummary(combinedEntries);

  const renderItem = (listEl, text, notes, className) => {
    const li = document.createElement("li");
    if (className) {
      li.className = className;
    }
    li.textContent = text;
    if (notes) {
      const note = document.createElement("span");
      note.className = "translation-note";
      note.textContent = ` ${notes}`;
      li.appendChild(note);
    }
    listEl.appendChild(li);
  };

  const fillList = (listEl, items, emptyLabel, mode = "plain") => {
    if (!items.length) {
      const empty = document.createElement("li");
      empty.className = "empty-state";
      empty.textContent = emptyLabel;
      listEl.appendChild(empty);
      return;
    }
    items.forEach((name) => {
      if (mode === "translated") {
        const toPart = name.to ? ` → ${name.to}` : "";
        renderItem(listEl, `${name.from}${toPart}`, name.notes);
        return;
      }
      if (mode === "untranslated") {
        renderItem(listEl, `${name.from} → (unsupported)`, name.notes);
        return;
      }
      if (mode === "unavailable") {
        renderItem(listEl, `${name.from} → (unavailable)`, name.notes);
        return;
      }
      if (mode === "fixed") {
        renderItem(listEl, name.label, name.notes);
        return;
      }
      renderItem(listEl, name, null);
    });
  };

  const topSummary = top.querySelector("summary");
  const bottomSummary = bottom.querySelector("summary");
  const unavailableSummary = unavailablePanel.querySelector("summary");
  if (topSummary) {
    topSummary.textContent = `Translated (active) · ${summary.translated.length}`;
  }
  if (bottomSummary) {
    bottomSummary.textContent = `Untranslated (active) · ${summary.untranslated.length}`;
  }
  if (unavailableSummary) {
    unavailableSummary.textContent = `Unavailable · ${unavailable.length}`;
  }

  fillList(translatedList, summary.translated, "No translated active items.", "translated");
  fillList(untranslatedList, summary.untranslated, "No untranslated active items.", "untranslated");
  fillList(unavailableList, unavailable, "No unavailable items.", "unavailable");
  fillList(fixedList, fixed, "No forced values.", "fixed");
};

const setStatus = (message, isError = false, target = "agent") => {
  const elMap = {
    agent: agentStatusEl,
    module: moduleStatusEl,
    orchestration: orchestrationStatusEl,
  };
  const el = elMap[target] || agentStatusEl;
  if (!el) {
    return;
  }
  el.textContent = message;
  el.classList.toggle("error", isError);
};

const setStatusForState = (state, message, isError = false) => {
  let target = "agent";
  if (state.kind === "orchestration") {
    target = "orchestration";
  } else if (state.kind === "module") {
    target = "module";
  }
  setStatus(message, isError, target);
};

const setConnectorsStatus = (message, isError = false) => {
  if (!connectorsStatusEl) {
    return;
  }
  connectorsStatusEl.textContent = message;
  connectorsStatusEl.classList.toggle("error", isError);
};

const refreshOutputDomRefs = () => {
  targetTabLabels = Array.from(document.querySelectorAll("[data-target-tab]"));
  targetPanels = Array.from(document.querySelectorAll("[data-target-panel]"));
  outputTabLabels = Array.from(document.querySelectorAll("[data-output-tab]"));
  outputBlocks = Array.from(document.querySelectorAll("[data-output-panel]"));
  outputTextBlocks = Array.from(document.querySelectorAll("[data-output]"));
  outputCopyButtons = Array.from(document.querySelectorAll(".output-code .icon-button"));
  runCrewaiWorkflowButton = document.getElementById("runCrewaiWorkflow");
  crewaiRunOutput = document.getElementById("crewaiRunOutput");
  stopCrewaiWorkflowButton = document.getElementById("stopCrewaiWorkflow");
  runAdkWorkflowButton = document.getElementById("runAdkWorkflow");
  adkRunOutput = document.getElementById("adkRunOutput");
  stopAdkWorkflowButton = document.getElementById("stopAdkWorkflow");
};

const buildFrameworkOutputs = (framework) => {
  const outputs = [];
  const mappings = framework?.mappings || {};
  if (mappings.agent) {
    outputs.push({ key: "agents", label: "Agents", title: `Agents ${framework.label || framework.id}` });
  }
  if (framework.id === "crewai" && mappings.agent) {
    outputs.push({ key: "tasks", label: "Tasks", title: `Tasks ${framework.label || framework.id}` });
  }
  if (mappings.module && framework.id !== "crewai" && framework.id !== "adk") {
    outputs.push({ key: "modules", label: "Modules", title: `Modules ${framework.label || framework.id}` });
  }
  if (mappings.multiagent) {
    outputs.push({ key: "orchestration", label: "Workflow", title: `Workflow ${framework.label || framework.id}` });
  }
  outputs.push({ key: "report", label: "Report", title: `Conversion report ${framework.label || framework.id}` });
  return outputs;
};

const renderOutputLayoutFromRegistry = (registry) => {
  if (!targetTabsEl || !targetPanelsContainerEl) {
    return;
  }
  targetTabsEl.innerHTML = "";
  targetPanelsContainerEl.innerHTML = "";
  const frameworks = Array.isArray(registry?.frameworks) ? registry.frameworks : [];
  const renderable = frameworks.filter((f) => f?.mappings && (f.mappings.agent || f.mappings.multiagent));
  renderable.forEach((framework, fIndex) => {
    const targetLabel = document.createElement("label");
    targetLabel.className = "segmented-item";
    targetLabel.setAttribute("role", "tab");
    targetLabel.dataset.targetTab = framework.id;
    targetLabel.setAttribute("aria-selected", fIndex === 0 ? "true" : "false");
    const targetInput = document.createElement("input");
    targetInput.type = "radio";
    targetInput.name = "targetTab";
    targetInput.value = framework.id;
    targetInput.checked = fIndex === 0;
    targetLabel.appendChild(targetInput);
    targetLabel.appendChild(document.createTextNode(framework.label || framework.id));
    targetTabsEl.appendChild(targetLabel);

    const panel = document.createElement("div");
    panel.className = `target-panel${fIndex === 0 ? " is-active" : ""}`;
    panel.dataset.targetPanel = framework.id;
    const outputTabs = document.createElement("div");
    outputTabs.className = "segmented tabs";
    outputTabs.setAttribute("role", "tablist");
    outputTabs.setAttribute("aria-label", `${framework.label || framework.id} output`);
    const outputs = buildFrameworkOutputs(framework);
    outputs.forEach((out, oIndex) => {
      const outputId = `${framework.id}-${out.key}`;
      const tabLabel = document.createElement("label");
      tabLabel.className = "segmented-item";
      tabLabel.setAttribute("role", "tab");
      tabLabel.dataset.outputTab = outputId;
      tabLabel.setAttribute("aria-selected", oIndex === 0 ? "true" : "false");
      const outInput = document.createElement("input");
      outInput.type = "radio";
      outInput.name = `${framework.id}OutputTab`;
      outInput.value = out.key;
      outInput.checked = oIndex === 0;
      tabLabel.appendChild(outInput);
      tabLabel.appendChild(document.createTextNode(out.label));
      outputTabs.appendChild(tabLabel);

      const section = document.createElement("section");
      section.className = `output-block${oIndex === 0 ? " is-active" : ""}`;
      section.dataset.outputPanel = outputId;
      section.innerHTML = `
        <h3>${out.title}</h3>
        <div class="output-code">
          <button type="button" class="icon-button" aria-label="Copy"><span>⧉</span></button>
          <pre class="code-sample" data-output="${outputId}"># ${framework.label || framework.id} output will appear here</pre>
        </div>
      `;
      if (out.key === "orchestration" && (framework.id === "crewai" || framework.id === "adk")) {
        section.insertAdjacentHTML(
          "beforeend",
          `
          <div class="run-panel">
            <div class="run-actions">
              <button type="button" class="secondary" id="run${framework.id === "crewai" ? "Crewai" : "Adk"}Workflow">▶ Run workflow</button>
              <button type="button" class="secondary danger" id="stop${framework.id === "crewai" ? "Crewai" : "Adk"}Workflow" disabled>■ Stop</button>
            </div>
            <div class="output-wrapper">
                <label>Console output:</label>
                <pre class="code-sample run-output" id="${framework.id === "crewai" ? "crewaiRunOutput" : "adkRunOutput"}">Execution result</pre>
            </div>
          </div>
        `,
        );
      }
      panel.appendChild(section);
    });
    panel.prepend(outputTabs);
    if (framework.id === "crewai" || framework.id === "adk") {
      const summaryId = `${framework.id}-global`;
      const summary = document.createElement("div");
      summary.className = "translation-global";
      summary.innerHTML = `
        <h3>Gear → ${framework.label || framework.id} mappings</h3>
        <details class="translation-toggle translation-toggle--translated" data-translation-top="${summaryId}">
          <summary>Translated (active)</summary>
          <ul data-translation-list="translated"></ul>
        </details>
        <details class="translation-toggle translation-toggle--untranslated" data-translation-bottom="${summaryId}">
          <summary>Untranslated (active)</summary>
          <ul data-translation-list="untranslated"></ul>
          <div class="translation-subsection">
            <div class="translation-subtitle">Forced values (mapping)</div>
            <ul data-translation-list="fixed"></ul>
          </div>
        </details>
        <details class="translation-toggle translation-toggle--unavailable" data-translation-unavailable="${summaryId}">
          <summary>Unavailable</summary>
          <ul data-translation-list="unavailable"></ul>
        </details>
      `;
      panel.appendChild(summary);
    }
    targetPanelsContainerEl.appendChild(panel);
  });
  refreshOutputDomRefs();
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

const loadYamlFromUrlCandidates = (relativePath) => window.GearResourceLoader.loadYaml(relativePath);
const loadScriptFromUrlCandidates = (relativePath) => window.GearResourceLoader.loadScript(relativePath);

const loadFeaturePolicy = async () => {
  try {
    featurePolicy = await loadYamlFromUrlCandidates(FEATURE_POLICY_PATH);
  } catch (error) {
    featurePolicy = null;
  }
  featurePolicyIndex = normalizeFeaturePolicy(featurePolicy);
  applyPolicyToAllStates();
};

// Load CrewAI mappings used by the assembly plugins.
const loadCrewaiMappings = async () => {
  try {
    crewaiAgentMapping = await loadYamlFromUrlCandidates(CREWAI_AGENT_MAPPING_PATH);
    crewaiMultiMapping = await loadYamlFromUrlCandidates(CREWAI_MULTI_MAPPING_PATH);
    setConnectorsStatus("Connectors loaded.", false);
  } catch (error) {
    console.error(error);
    crewaiAgentMapping = null;
    crewaiMultiMapping = null;
    setConnectorsStatus("CrewAI mappings not found. Check connectors/frameworks/crewai/.", true);
  }
};

// Load ADK mappings used by the assembly plugins.
const loadAdkMappings = async () => {
  try {
    adkAgentMapping = await loadYamlFromUrlCandidates(ADK_AGENT_MAPPING_PATH);
    adkMultiMapping = await loadYamlFromUrlCandidates(ADK_MULTI_MAPPING_PATH);
    adkModuleMapping = await loadYamlFromUrlCandidates(ADK_MODULE_MAPPING_PATH);
  } catch (error) {
    console.error(error);
    adkAgentMapping = null;
    adkMultiMapping = null;
    adkModuleMapping = null;
    setConnectorsStatus("ADK mappings not found. Check connectors/frameworks/adk/ (agent, multiagent, module).", true);
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
    empty.textContent = "No connectors defined.";
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

// Load registry, templates, and plugins, then build the output tabs/panels.
const loadConnectorsRegistry = async () => {
  if (!connectorsStatusEl || !connectorsListEl) {
    return;
  }
  setConnectorsStatus(`Loading ${CONNECTORS_REGISTRY_PATH}...`);
  try {
    const registry = await loadYamlFromUrlCandidates(CONNECTORS_REGISTRY_PATH);
    connectorsRegistry = registry;
    renderConnectors(registry);
    renderOutputLayoutFromRegistry(registry);
    if (!window.GearAssemblyEngine?.assemble) {
      try {
        await loadScriptFromUrlCandidates(ASSEMBLY_ENGINE_PATH);
      } catch (error) {
        console.error(error);
        setConnectorsStatus("Assembly engine unavailable.", true);
      }
    }
    if (window.GearAssemblyEngine?.loadTemplates) {
      try {
        await window.GearAssemblyEngine.loadTemplates(BASE_PREFIX, registry);
      } catch (error) {
        console.error(error);
        setConnectorsStatus("Unable to load workflow templates.", true);
      }
    }
    if (window.GearAssemblyEngine?.loadPlugins) {
      try {
        await window.GearAssemblyEngine.loadPlugins(BASE_PREFIX, registry);
      } catch (error) {
        console.error(error);
        setConnectorsStatus("Unable to load assembly plugins.", true);
      }
    }
    bindOutputUiInteractions();
    scheduleOutputsUpdate();
    setConnectorsStatus("Connectors loaded.");
  } catch (error) {
    console.error(error);
    setConnectorsStatus("Unable to load connectors.", true);
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
  if (type === "mandatory") return "mandatory";
  if (type === "optional") return "optional";
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

const isModulesFeature = (state, feature) =>
  state.kind === "orchestration" && feature.name.toLowerCase() === "modules";

const buildAgentOptionList = () => {
  return agentStates.map((agent, index) => {
    const name = findStateTitle(agent);
    const fallback = `Agent ${index + 1}`;
    const label = name && name !== "(new agent)" ? name : fallback;
    return { value: label, label };
  });
};

const buildModuleOptionList = () => {
  return moduleStates.map((moduleState, index) => {
    const fallback = `Module ${index + 1}`;
    let name = findStateTitle(moduleState);
    if (!name || name === "(new module)") {
      const nameFeature = Object.values(moduleState.model.features).find(
        (feature) => isLeafFeature(moduleState.model, feature.id) && feature.name.toLowerCase() === "modulename",
      );
      if (nameFeature) moduleState.featureValues[nameFeature.id] = fallback;
      name = fallback;
    }
    const label = name;
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
  if (
    keys.length === 1 &&
    (keys[0] === "GearAgent" ||
      keys[0] === "GearMultiAgent" ||
      keys[0] === "GearModule" ||
      keys[0] === "GearWorkflow")
  ) {
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

const normalizePolicyList = (value) => {
  if (!value) {
    return [];
  }
  const list = Array.isArray(value) ? value : [value];
  return list.map((item) => normalizeFeatureName(item)).filter(Boolean);
};

const normalizePolicyForceMap = (value) => {
  const map = new Map();
  if (!value || typeof value !== "object") {
    return map;
  }
  Object.entries(value).forEach(([key, item]) => {
    const normalizedKey = normalizeFeatureName(key);
    if (!normalizedKey) {
      return;
    }
    if (item === null || item === undefined) {
      return;
    }
    map.set(normalizedKey, item);
  });
  return map;
};

const normalizeFeaturePolicy = (policy) => {
  const enabled = Boolean(policy?.enabled);
  const byKind = {};
  ["agent", "module", "orchestration"].forEach((kind) => {
    const entry = policy?.[kind];
    if (!entry || typeof entry !== "object") {
      return;
    }
    const disabled = new Set(normalizePolicyList(entry.disable || entry.disabled));
    const forced = normalizePolicyForceMap(entry.force || entry.forced);
    byKind[kind] = { disabled, forced };
  });
  return { enabled, byKind };
};

const getPolicyForState = (state) => {
  if (!featurePolicyIndex?.enabled || !state?.kind) {
    return null;
  }
  return featurePolicyIndex.byKind?.[state.kind] || null;
};

const findFeatureByNormalizedName = (model, normalizedName) => {
  if (!model || !normalizedName) {
    return null;
  }
  return (
    Object.values(model.features).find(
      (feature) => normalizeFeatureName(feature.name) === normalizedName,
    ) || null
  );
};

const isFeatureDisabledByPolicy = (state, feature) => {
  const policy = getPolicyForState(state);
  if (!policy || !feature?.name) {
    return false;
  }
  return policy.disabled.has(normalizeFeatureName(feature.name));
};

const isFeatureLockedByPolicy = (state, feature) => {
  const policy = getPolicyForState(state);
  if (!policy || !feature) {
    return false;
  }
  if (isFeatureDisabledByPolicy(state, feature)) {
    return true;
  }
  if (feature.parentGroupId) {
    const group = state.model?.groups?.[feature.parentGroupId];
    if (group?.type === "alternative") {
      const parent = state.model?.features?.[group.parentFeatureId];
      if (parent && policy.forced.has(normalizeFeatureName(parent.name))) {
        return true;
      }
    }
  }
  return false;
};

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

const featureRequiresValue = (state, feature) => {
  if (!feature || !state?.model) {
    return false;
  }
  if (!isLeafFeature(state.model, feature.id)) {
    return false;
  }
  if (!isFeatureActive(state, feature.id)) {
    return false;
  }
  if (!feature.abstract) {
    return false;
  }
  if (isBooleanFeatureName(feature.name)) {
    return false;
  }
  return true;
};

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

const isFeatureDefinedInState = (state, feature) => {
  if (!state?.model || !feature) {
    return false;
  }
  if (!isLeafFeature(state.model, feature.id)) {
    return false;
  }
  if (!isFeatureActive(state, feature.id)) {
    return false;
  }
  if (!feature.abstract) {
    return true;
  }
  if (isBooleanFeatureName(feature.name)) {
    return true;
  }
  const value = state.featureValues[feature.id];
  if (isNumberFeatureName(feature.name)) {
    return parseNumberValue(value) !== null;
  }
  return hasMeaningfulValue(value);
};

const getMissingRequiredCount = (state) => {
  const { model } = state;
  let missing = 0;
  Object.values(model.features).forEach((feature) => {
    if (!featureRequiresValue(state, feature)) {
      return;
    }
    const value = state.featureValues[feature.id];
    if (isNumberFeatureName(feature.name)) {
      if (parseNumberValue(value) === null) {
        missing += 1;
      }
      return;
    }
    if (!hasMeaningfulValue(value)) {
      missing += 1;
    }
  });
  return missing;
};

const normalizeWorkflowLabel = (label) => {
  if (typeof label !== "string") {
    return label;
  }
  return label.replace(/orchestration/gi, "Workflow").replace(/\s+/g, " ").trim();
};

const createFeatureState = (kind, model, label = "") => {
  const normalizedLabel = kind === "orchestration" ? normalizeWorkflowLabel(label || "Workflow") : label;
  const state = {
    id: `a${++agentCounter}`,
    kind,
    model,
    label: normalizedLabel,
    optionalSelections: {},
    alternativeSelections: {},
    featureValues: {},
    openNodes: {},
    isSyncingYaml: false,
    rootEl: null,
    els: {},
    builder: null,
    constraintViolations: [],
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
  const lockedByPolicy = isFeatureLockedByPolicy(state, feature);

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
    radio.setAttribute("aria-label", feature.name);
    radio.name = `${state.id}::${feature.parentGroupId}`;
    radio.checked = active;
    radio.disabled = !parentActive || lockedByPolicy;
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
    checkbox.setAttribute("aria-label", feature.name);
    checkbox.checked = active;
    const disabledByParent = !parentActive;
    const disabledByRelation = groupType === "mandatory";
    checkbox.disabled = disabledByParent || disabledByRelation || lockedByPolicy;
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
  label.textContent = FEATURE_VALUE_ALIASES[feature.name] || feature.name;
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
    abstractBadge.textContent = "Abstract";
    line.appendChild(abstractBadge);
  }

  if (lockedByPolicy) {
    const lockedBadge = document.createElement("span");
    lockedBadge.className = "badge";
    lockedBadge.textContent = "Locked";
    line.appendChild(lockedBadge);
  }

  if (isLeafFeature(model, feature.id)) {
    const rawValue = state.featureValues[feature.id];
    const stringValue = Array.isArray(rawValue) ? "" : String(rawValue ?? "").trim();
    const isBoolean = isBooleanFeatureName(feature.name);
    const isNumber = isNumberFeatureName(feature.name);
    const parsedNumber = isNumber ? parseNumberValue(rawValue) : null;
    const requiresValue = featureRequiresValue(state, feature);
    const isInvalid =
      active &&
      requiresValue &&
      (isNumber ? parsedNumber === null : stringValue === "");
    if (isInvalid) {
      line.classList.add("is-invalid");
    }
    if (isAgentsFeature(state, feature)) {
      const selectEl = document.createElement("select");
      selectEl.className = "feature-value";
      selectEl.setAttribute("aria-label", feature.name);
      selectEl.multiple = true;
      selectEl.size = 4;
      selectEl.disabled = !active || lockedByPolicy;

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
        renderMissingBadge(state);
      });
      selectEl.addEventListener("click", (event) => {
        event.stopPropagation();
      });
      line.appendChild(selectEl);
    } else if (isModulesFeature(state, feature)) {
      const selectEl = document.createElement("select");
      selectEl.className = "feature-value";
      selectEl.setAttribute("aria-label", feature.name);
      selectEl.multiple = true;
      selectEl.size = 4;
      selectEl.disabled = !active || lockedByPolicy;

      const options = buildModuleOptionList();
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
        renderMissingBadge(state);
      });
      selectEl.addEventListener("click", (event) => {
        event.stopPropagation();
      });
      line.appendChild(selectEl);
    } else if (isAgentRefFeature(state, feature)) {
      const selectEl = document.createElement("select");
      selectEl.className = "feature-value";
      selectEl.setAttribute("aria-label", feature.name);
      selectEl.disabled = !active || lockedByPolicy;

      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "(select an agent)";
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
        renderMissingBadge(state);
      });
      selectEl.addEventListener("click", (event) => {
        event.stopPropagation();
      });
      line.appendChild(selectEl);
    } else if (feature.abstract && !isBoolean) {
      const kind = valueInputKind(feature);
      const valueEl = document.createElement(kind === "textarea" ? "textarea" : "input");
      if (kind !== "textarea") {
        valueEl.type = "text";
      }
      valueEl.className = "feature-value";
      valueEl.setAttribute("aria-label", feature.name);
      valueEl.placeholder = "value…";
      const fixedValue = getFixedFeatureValue(feature);
      if (fixedValue && active) {
        state.featureValues[feature.id] = fixedValue;
      }
      valueEl.value = state.featureValues[feature.id] ?? "";
      valueEl.disabled = !active || lockedByPolicy;
      if (fixedValue) {
        valueEl.readOnly = true;
      }
      if (isInvalid) {
        valueEl.classList.add("is-invalid");
      }
    valueEl.addEventListener("input", () => {
      state.featureValues[feature.id] = valueEl.value;
      const currentValue = valueEl.value;
      const currentString = String(currentValue ?? "").trim();
      const currentIsNumber = isNumberFeatureName(feature.name);
      const currentParsed = currentIsNumber ? parseNumberValue(currentValue) : null;
      const requiredNow = featureRequiresValue(state, feature);
      const invalidNow =
        isFeatureActive(state, feature.id) &&
        requiredNow &&
        (currentIsNumber ? currentParsed === null : currentString === "");
      line.classList.toggle("is-invalid", invalidNow);
      valueEl.classList.toggle("is-invalid", invalidNow);
      renderAgentSummary(state);
      renderAgentYaml(state);
      renderAgentHeader(state);
      renderMissingBadge(state);
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
  const scalarEnumValues = new Map();
  const activeLeaves = Object.values(model.features).filter(
    (feature) => isFeatureActive(state, feature.id) && isLeafFeature(model, feature.id),
  );

  for (const feature of activeLeaves) {
    if (isScalarEnumChild(state, feature)) {
      const parentId = feature.parentFeatureId;
      if (parentId) {
        let value = null;
        if (feature.abstract) {
          const rawValue = state.featureValues[feature.id];
          const text = rawValue !== undefined ? String(rawValue).trim() : "";
          value = text !== "" ? text : null;
        } else if (isBooleanFeatureName(feature.name)) {
          value = true;
        } else {
          value = FEATURE_VALUE_ALIASES[feature.name] || feature.name;
        }
        if (value !== null) {
          scalarEnumValues.set(parentId, value);
        }
      }
      continue;
    }
    const pathParts = model.featurePaths?.[feature.id] ?? [];
    if (!pathParts.length) {
      continue;
    }
    let value = null;
    if (!feature.abstract) {
      if (isBooleanFeatureName(feature.name)) {
        value = true;
      } else {
        value = feature.name;
      }
    } else {
      const rawValue = state.featureValues[feature.id];
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
    }
    if (value !== null) {
      setNestedValue(yamlObj, pathParts, value);
    }
  }

  for (const [parentId, value] of scalarEnumValues.entries()) {
    const pathParts = model.featurePaths?.[parentId] ?? [];
    if (!pathParts.length) {
      continue;
    }
    setNestedValue(yamlObj, pathParts, value);
  }

  return yamlObj;
};

const collectActiveFeaturePaths = (state) => {
  const { model } = state;
  const paths = new Set();
  const scalarParents = new Set();
  const activeLeaves = Object.values(model.features).filter((feature) =>
    isFeatureDefinedInState(state, feature),
  );

  for (const feature of activeLeaves) {
    if (isScalarEnumChild(state, feature)) {
      if (feature.parentFeatureId) {
        scalarParents.add(feature.parentFeatureId);
      }
      continue;
    }
    const pathParts = model.featurePaths?.[feature.id] ?? [];
    if (!pathParts.length) {
      continue;
    }
    paths.add(pathParts.join("."));
  }

  scalarParents.forEach((parentId) => {
    const pathParts = model.featurePaths?.[parentId] ?? [];
    if (!pathParts.length) {
      return;
    }
    paths.add(pathParts.join("."));
  });

  return Array.from(paths);
};

const collectActivePathsForStates = (states) => {
  const paths = new Set();
  (states || []).forEach((state) => {
    if (!state?.model) {
      return;
    }
    collectActiveFeaturePaths(state).forEach((path) => {
      paths.add(path);
    });
  });
  return Array.from(paths);
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
  selectedModules: [],
  lastModuleOptions: [],
  sequence: [],
  edges: [],
});

const itemLabel = (item) => {
  if (item.type === "agent") {
    return `Agent: ${item.id}`;
  }
  return `Module: ${item.id}`;
};

const buildOrchestrationYaml = (state) => {
  if (!state.builder) {
    return buildYamlObjectForAgent(state);
  }
  const payload = buildYamlObjectForAgent(state);
  const rootId = state.model?.roots?.[0];
  const rootName = rootId ? state.model.features[rootId]?.name : null;
  let root = payload;
  if (rootName) {
    if (!payload[rootName]) {
      payload[rootName] = {};
    }
    root = payload[rootName];
  }
  root.Items = root.Items && typeof root.Items === "object" ? root.Items : {};
  if (state.builder.selectedAgents.length) {
    root.Items.Agents = state.builder.selectedAgents.slice();
  }
  if (state.builder.selectedModules.length) {
    root.Items.Modules = state.builder.selectedModules.slice();
  }
  if (state.builder.edges.length) {
    root.Edges = state.builder.edges.map((edge) => ({
      From: edge.from,
      To: edge.to,
    }));
  }
  return payload;
};

const buildWorkflowItems = (state) => {
  if (!state.builder) {
    return [];
  }
  const items = [];
  state.builder.sequence.forEach((entry) => {
    items.push(entry);
  });
  return items;
};

const buildEdgesFromSequence = (state) => {
  if (!state.builder) {
    return;
  }
  const seq = state.builder.sequence || [];
  state.builder.edges = [];
  for (let i = 0; i < seq.length - 1; i += 1) {
    const from = seq[i];
    const to = seq[i + 1];
    state.builder.edges.push({
      from: from.id,
      to: to.id,
    });
  }
};

const addSequenceItem = (state, type, label) => {
  if (!state.builder || !label) {
    return;
  }
  const base = String(label);
  const existing = new Set(state.builder.sequence.map((item) => item.id));
  let candidate = base;
  let suffix = 2;
  while (existing.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  state.builder.sequence.push({ id: candidate, label: base, type });
  buildEdgesFromSequence(state);
};

const pruneBuilderState = (state, items) => {
  if (!state.builder) {
    return;
  }
  const nodeIds = new Set(items.map((node) => node.label || node.id));
  state.builder.edges = state.builder.edges.filter(
    (edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to),
  );
};

const syncSelection = (current, options, lastOptions) => {
  const optionValues = options.map((option) => option.value);
  let selection = current.filter((value) => optionValues.includes(value));
  if (!selection.length && optionValues.length) {
    selection = optionValues.slice();
  } else if (lastOptions.length === current.length) {
    const allPreviouslySelected = lastOptions.every((value) => selection.includes(value));
    if (allPreviouslySelected) {
      const newOnes = optionValues.filter((value) => !selection.includes(value));
      if (newOnes.length) {
        selection = selection.concat(newOnes);
      }
    }
  }
  return { selection, optionValues };
};

const renderOrchestrationBuilder = (state) => {
  if (!state.builder || !state.els.builderEl) {
    return;
  }
  if (state.els.memoryToggle) {
    const memoryFeature = findLeafFeatureByName(state, "Memory");
    state.els.memoryToggle.checked = memoryFeature
      ? isFeatureActive(state, memoryFeature.id)
      : false;
  }
  const agentOptions = buildAgentOptionList();
  const moduleOptions = buildModuleOptionList();
  state.builder.selectedAgents = agentOptions.map((option) => option.value);
  state.builder.selectedModules = moduleOptions.map((option) => option.value);
  state.builder.lastAgentOptions = state.builder.selectedAgents.slice();
  state.builder.lastModuleOptions = state.builder.selectedModules.slice();
  const allowedAgents = new Set(state.builder.selectedAgents);
  const allowedModules = new Set(state.builder.selectedModules);
  state.builder.sequence = (state.builder.sequence || []).filter((item) => {
    if (item.type === "agent") {
      return allowedAgents.has(item.label || item.id);
    }
    if (item.type === "module") {
      return allowedModules.has(item.label || item.id);
    }
    return false;
  });
  buildEdgesFromSequence(state);
  const { orchAgentsEl } = state.els;
  if (orchAgentsEl) {
    orchAgentsEl.innerHTML = "";
    agentOptions.forEach((option) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "agent-select-item";
      item.textContent = option.label;
      item.addEventListener("click", () => {
        addSequenceItem(state, "agent", option.value);
        renderOrchestrationBuilder(state);
        renderAgentYaml(state);
      });
      orchAgentsEl.appendChild(item);
    });
  }

  const { orchModulesEl } = state.els;
  if (orchModulesEl) {
    orchModulesEl.innerHTML = "";
    moduleOptions.forEach((option) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "agent-select-item";
      item.textContent = option.label;
      item.addEventListener("click", () => {
        addSequenceItem(state, "module", option.value);
        renderOrchestrationBuilder(state);
        renderAgentYaml(state);
      });
      orchModulesEl.appendChild(item);
    });
  }

  const items = buildWorkflowItems(state);
  pruneBuilderState(state, items);

  if (state.els.sequenceEl) {
    const el = state.els.sequenceEl;
    el.innerHTML = "";
    if (items.length) {
      items.forEach((item, index) => {
        if (index > 0) {
          const arrow = document.createElement("span");
          arrow.className = "sequence-arrow";
          arrow.textContent = "→";
          el.appendChild(arrow);
        }
        const chip = document.createElement("span");
        chip.className = `sequence-chip sequence-chip--${item.type}`;
        chip.textContent = item.label || item.id;
        el.appendChild(chip);
      });
    }
  }

  renderOrchestrationGraph(state);
  scheduleOutputsUpdate();
};

const renderOrchestrationGraph = (state) => {
  const svg = state.els.graphEl;
  if (!svg) {
    return;
  }
  const nodes = buildWorkflowItems(state);
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
      const type = nodes.find((node) => node.id === pos.id)?.type;
      const label = type === "module" ? "M" : "A";
      const display = nodes.find((node) => node.id === pos.id)?.label || pos.id;
      return `<g><circle cx="${pos.x}" cy="${pos.y}" r="18" fill="#1f2937" stroke="#93c5fd" stroke-width="2" /><text x="${pos.x}" y="${pos.y + 5}" text-anchor="middle" fill="#e2e8f0" font-size="12">${label}</text><text x="${pos.x}" y="${pos.y + 30}" text-anchor="middle" fill="#94a3b8" font-size="10">${display}</text></g>`;
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
  if (state.els.clearLastButton) {
    state.els.clearLastButton.addEventListener("click", () => {
      if (state.builder.sequence.length) {
        state.builder.sequence.pop();
        buildEdgesFromSequence(state);
        renderOrchestrationBuilder(state);
        renderAgentYaml(state);
      }
    });
  }
  if (state.els.clearAllButton) {
    state.els.clearAllButton.addEventListener("click", () => {
      state.builder.sequence = [];
      state.builder.edges = [];
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
  document.querySelectorAll("[data-output]").forEach((block) => {
    if (block.dataset.output === key) {
      renderYamlPreview(block, text);
    }
  });
};

// Recompute translated YAML + workflow code from current Gear state.
const updateOutputs = () => {
  const frameworks = Array.isArray(connectorsRegistry?.frameworks) ? connectorsRegistry.frameworks : [];
  const renderable = frameworks.filter((f) => f?.mappings && (f.mappings.agent || f.mappings.multiagent));
  const workflowState = orchestrationStates[0] || null;
  const gearAgents = agentStates.map((state) => normalizeGearRoot(buildYamlObjectForAgent(state)));
  const gearModules = moduleStates.map((state) => normalizeGearRoot(buildYamlObjectForAgent(state)));
  const workflowYaml = workflowState ? normalizeGearRoot(buildOrchestrationYaml(workflowState)) : {};
  const workflowItems = workflowState ? buildWorkflowItems(workflowState) : [];
  const activeAgentPaths = collectActivePathsForStates(agentStates);
  const activeModulePaths = collectActivePathsForStates(moduleStates);
  const activeWorkflowPaths = workflowState ? collectActivePathsForStates([workflowState]) : [];
  const activePaths = [...new Set([...activeAgentPaths, ...activeModulePaths, ...activeWorkflowPaths])];
  renderable.forEach((framework) => {
    if (framework.id !== "crewai" && framework.id !== "adk") {
      return;
    }
    const outputId = `${framework.id}-global`;
    const entries = getGlobalMappingEntriesForFramework(framework.id);
    renderTranslationSummary(outputId, entries, null, activePaths);
  });
  if (!window.GearAssemblyEngine?.assemble) {
    renderable.forEach((framework) => {
      buildFrameworkOutputs(framework).forEach((out) => {
        setOutputText(`${framework.id}-${out.key}`, "# Assembly engine unavailable.");
      });
    });
    return;
  }
  const assembled = window.GearAssemblyEngine.assemble({
    gearAgents,
    gearModules,
    workflowYaml,
    workflowItems,
    mappings: {
      crewaiAgent: crewaiAgentMapping,
      crewaiMulti: crewaiMultiMapping,
      adkAgent: adkAgentMapping,
      adkMulti: adkMultiMapping,
      adkModule: adkModuleMapping,
    },
  });
  renderable.forEach((framework) => {
    const result = assembled?.[framework.id] || {};
    const outputs = buildFrameworkOutputs(framework);
    outputs.forEach((out) => {
      const outputKey = `${framework.id}-${out.key}`;
      if (result.error) {
        setOutputText(outputKey, result.error);
        return;
      }
      const payload = result.outputs || {};
      const value = payload[out.key];
      if (value === undefined || value === null) {
        if (framework.id === "crewai" && out.key === "modules") {
          setOutputText(outputKey, "# CrewAI modules are unsupported.");
          return;
        }
        setOutputText(outputKey, "# Output unavailable.");
        return;
      }
      if (typeof value === "string") {
        setOutputText(outputKey, value);
        return;
      }
      if (framework.id === "crewai" && (out.key === "agents" || out.key === "tasks")) {
        setOutputText(outputKey, dumpCrewaiYaml(value));
        return;
      }
      if (framework.id === "adk" && out.key === "agents") {
        const adkAgentsYaml = addBlankLinesBetweenTopLevel(dumpYaml(value)).trim();
        setOutputText(outputKey, adkAgentsYaml);
        return;
      }
      if (framework.id === "adk" && out.key === "modules") {
        setOutputText(outputKey, dumpYaml(value));
        return;
      }
      setOutputText(outputKey, dumpYaml(value));
    });
  });
  saveProjectLocally();
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
    empty.textContent = "No concrete active feature.";
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
    empty.textContent = "No active alternative.";
    altEl.appendChild(empty);
    return;
  }

  for (const group of shownGroups) {
    const selectedId = state.alternativeSelections[group.id];
    const selectedFeature = selectedId ? model.features[selectedId] : null;
    const item = document.createElement("li");
    const parentPath = featurePath(model, group.parentFeatureId);
    const selectedName = selectedFeature ? selectedFeature.name : "(none)";
    item.textContent = `${parentPath} → ${selectedName}`;
    altEl.appendChild(item);
  }
};

const findStateTitle = (state) => {
  const { model } = state;
  if (state.kind === "orchestration") {
    return state.label || "Workflow";
  }
  const names = state.kind === "module" ? ["modulename", "name"] : ["name"];
  const candidates = Object.values(model.features)
    .filter((feature) => isLeafFeature(model, feature.id) && names.includes(feature.name.toLowerCase()))
    .filter((feature) => isFeatureActive(state, feature.id))
    .map((feature) => (state.featureValues[feature.id] ?? "").trim())
    .filter(Boolean);
  if (candidates.length) {
    return candidates[0];
  }
  return state.kind === "module" ? "(new module)" : "(new agent)";
};

const renderAgentHeader = (state) => {
  const { titleEl } = state.els;
  if (!titleEl) {
    return;
  }
  if (state.kind === "module") {
    titleEl.textContent = findStateTitle(state);
    orchestrationStates.forEach((item) => renderAgent(item));
    return;
  }
  if (state.kind !== "agent") {
    let label = normalizeWorkflowLabel(state.label || "Workflow");
    state.label = label;
    titleEl.textContent = label;
    return;
  }
  titleEl.textContent = findStateTitle(state);
  orchestrationStates.forEach((item) => renderAgent(item));
};

const renderMissingBadge = (state) => {
  const badge = state.els.missingBadge;
  if (!badge) {
    return;
  }
  const missingCount = getMissingRequiredCount(state);
  const constraintCount = state.constraintViolations?.length ?? 0;
  if (missingCount > 0 || constraintCount > 0) {
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
    if (isScalarEnumGroup(state, group)) {
      const parentFeature = model.features[group.parentFeatureId];
      const parentPath = parentFeature ? model.featurePaths?.[parentFeature.id] ?? [] : [];
      const { exists, value } = parentPath.length ? getValueAtPath(data, parentPath) : { exists: false };
      let selectedChild = state.alternativeSelections[group.id] ?? group.children[0] ?? null;
      if (exists && !isExplicitFalse(value)) {
        if (value && typeof value === "object" && !Array.isArray(value)) {
          const objectKeys = Object.keys(value);
          const keyMatch = group.children.find((childId) =>
            objectKeys.includes(model.features[childId]?.name),
          );
          if (keyMatch) {
            selectedChild = keyMatch;
          }
        } else {
          const valueText = typeof value === "string" ? value : String(value);
          const exactMatch = group.children.find(
            (childId) => model.features[childId]?.name === valueText,
          );
          if (exactMatch) {
            selectedChild = exactMatch;
          } else {
            const abstractChild = group.children.find((childId) => model.features[childId]?.abstract);
            if (abstractChild) {
              selectedChild = abstractChild;
              state.featureValues[abstractChild] = scalarToString(value);
            }
          }
        }
      }
      state.alternativeSelections[group.id] = selectedChild;
      if (selectedChild) {
        activateAncestors(state, selectedChild);
      }
      continue;
    }
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
  const itemsBlock = normalized.Items && typeof normalized.Items === "object" ? normalized.Items : {};
  state.builder.selectedAgents = Array.isArray(itemsBlock.Agents)
    ? itemsBlock.Agents.map(String)
    : Array.isArray(normalized.Agents)
      ? normalized.Agents.map(String)
      : [];
  state.builder.selectedModules = Array.isArray(itemsBlock.Modules)
    ? itemsBlock.Modules.map(String)
    : Array.isArray(normalized.Modules)
      ? normalized.Modules.map(String)
      : [];

  const edgesRaw =
    normalized.Edges ||
    normalized.Workflow?.Edges ||
    normalized.Orchestration?.Edges ||
    [];
  state.builder.edges = Array.isArray(edgesRaw)
    ? edgesRaw.map((edge) => ({
        from: edge.From || edge.FromNode,
        to: edge.To || edge.ToNode,
      }))
    : [];
  const items = buildWorkflowItems(state);
  pruneBuilderState(state, items);
  renderOrchestrationBuilder(state);
};

const loadFromYamlText = (state, text, options = {}) => {
  const { silent = false } = options;
  if (!state.model) {
    if (!silent) {
      setStatusForState(state, "Load a UVL first.", true);
    }
    return;
  }
  const trimmed = text.trim();
  if (!trimmed) {
    if (!silent) {
      setStatusForState(state, "YAML is empty.", true);
    }
    return;
  }
  try {
    const parsed = window.jsyaml?.load ? window.jsyaml.load(trimmed) : JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Invalid YAML");
    }
    if (state.kind === "orchestration") {
      loadOrchestrationFromYamlObject(state, parsed);
    }
    loadStateFromYamlObject(state, parsed);
    if (!silent) {
      setStatusForState(state, "YAML loaded into the UI.");
    }
    renderAgent(state);
  } catch (error) {
    console.error(error);
    if (!silent) {
      setStatusForState(state, "Unable to parse this YAML. Check indentation and keys.", true);
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
    setStatusForState(state, "Nothing to copy yet.", true);
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    setStatusForState(state, "YAML copied to clipboard.");
  } catch (error) {
    console.error(error);
    setStatusForState(state, "Unable to copy automatically. Copy it manually.", true);
  }
};

const downloadYaml = (state) => {
  const yamlEl = state.els.yamlEl;
  if (!yamlEl) {
    return;
  }
  const text = yamlEl.value.trim();
  if (!text) {
    setStatusForState(state, "Nothing to download yet.", true);
    return;
  }
  const blob = new Blob([text], { type: "text/yaml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  if (state.kind === "agent") {
    link.download = `agent-${agentStates.findIndex((agent) => agent.id === state.id) + 1}.yml`;
  } else if (state.kind === "module") {
    link.download = `module-${moduleStates.findIndex((item) => item.id === state.id) + 1}.yml`;
  } else {
    link.download = "workflow.yml";
  }
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatusForState(state, "YAML downloaded.");
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

const removeModule = (state) => {
  moduleStates = moduleStates.filter((item) => item.id !== state.id);
  if (state.rootEl) {
    state.rootEl.remove();
  }
  if (!moduleStates.length) {
    addModule();
  } else {
    moduleStates.forEach((item) => renderAgentHeader(item));
  }
  orchestrationStates.forEach((item) => renderAgent(item));
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
  applyConstraintsToState(state);
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
  const duplicateButton = fragment.querySelector("[data-duplicate-agent]");
  const duplicateModuleButton = fragment.querySelector("[data-duplicate-module]");
  const tabInputs = fragment.querySelectorAll(".agent-tabs input[type=\"radio\"]");
  const builderEl = fragment.querySelector("[data-orchestration-builder]");
  const orchAgentsEl = fragment.querySelector("[data-orch-agents]");
  const orchModulesEl = fragment.querySelector("[data-orch-modules]");
  const sequenceEl = fragment.querySelector("[data-sequence]");
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
  const autoChainButton = fragment.querySelector("[data-auto-chain]");
  const clearLastButton = fragment.querySelector("[data-clear-last]");
  const clearAllButton = fragment.querySelector("[data-clear-all]");
  const graphEl = fragment.querySelector("[data-orch-graph]");
  const memoryToggle = fragment.querySelector("[data-orch-memory]");
  const analyzeAgentButton = fragment.querySelector("[data-analyze-agent-btn]");
  const analyzeModuleButton = fragment.querySelector("[data-analyze-module-btn]");
  const analyzeMultiAgentButton = fragment.querySelector("[data-analyze-multi-agent-btn]");
  const showAgentFeatureModelButton = fragment.querySelector("[data-show-feature-model-agent-btn]");
  const showModuleFeatureModelButton = fragment.querySelector("[data-show-feature-model-module-btn]");
  const showWorkflowFeatureModelButton = fragment.querySelector("[data-show-feature-model-workflow-btn]");

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
    duplicateButton,
    duplicateModuleButton,
    tabInputs,
    builderEl,
    orchAgentsEl,
    orchModulesEl,
    sequenceEl,
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
    autoChainButton,
    clearLastButton,
    clearAllButton,
    graphEl,
    memoryToggle,
    analyzeAgentButton,
    analyzeModuleButton,
    analyzeMultiAgentButton,
    showAgentFeatureModelButton,
    showModuleFeatureModelButton,
    showWorkflowFeatureModelButton
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
      const kindLabel = state.kind === "orchestration" ? "workflow" : state.kind;
      if (!window.confirm(`Remove this ${kindLabel}?`)) {
        return;
      }
      if (state.kind === "agent") {
        removeAgent(state);
      } else if (state.kind === "module") {
        removeModule(state);
      } else {
        removeOrchestration(state);
      }
    });
  }

  if (memoryToggle && state.kind === "orchestration") {
    memoryToggle.addEventListener("change", () => {
      setBooleanFeatureByName(state, "Memory", memoryToggle.checked);
      renderAgentSummary(state);
      renderAgentYaml(state);
      renderMissingBadge(state);
      scheduleOutputsUpdate();
    });
  }

  if (duplicateButton) {
    duplicateButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (state.kind !== "agent") {
        return;
      }
      const yamlText = state.els.yamlEl?.value || "";
      const newState = createFeatureState("agent", agentModel);
      agentStates.push(newState);
      mountFeatureCard(newState, agentTemplate, agentsContainer);
      if (yamlText.trim()) {
        loadFromYamlText(newState, yamlText, { silent: true });
      }
      agentStates.forEach((agent) => renderAgentHeader(agent));
    });
  }

  if (duplicateModuleButton) {
    duplicateModuleButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (state.kind !== "module") {
        return;
      }
      const yamlText = state.els.yamlEl?.value || "";
      const newState = createFeatureState("module", moduleModel);
      moduleStates.push(newState);
      mountFeatureCard(newState, moduleTemplate, modulesContainer);
      if (yamlText.trim()) {
        loadFromYamlText(newState, yamlText, { silent: true });
      }
      moduleStates.forEach((item) => renderAgentHeader(item));
    });
  }

  attachYamlSync(state);
  if (state.kind === "orchestration") {
    initOrchestrationBuilder(state);
  }


  if (analyzeAgentButton) {
    analyzeAgentButton.addEventListener("click", async () => {
      try {
        await runFlamapyAnalysis(state, "agent");
      } catch (err) {
        console.error(err);
      }
    });
  }

  if (showAgentFeatureModelButton) {
    showAgentFeatureModelButton.addEventListener("click", async () => {
      try {
        await showFeatureModel("agent");
      } catch (err) {
        console.error(err);
      }
    });
  }

  if (showModuleFeatureModelButton) {
    showModuleFeatureModelButton.addEventListener("click", async () => {
      try {
        await showFeatureModel("module");
      } catch (err) {
        console.error(err);
      }
    });
  }

  if (showWorkflowFeatureModelButton) {
    showWorkflowFeatureModelButton.addEventListener("click", async () => {
      try {
        await showFeatureModel("workflow");
      } catch (err) {
        console.error(err);
      }
    });
  }

  if (analyzeModuleButton) {
    analyzeModuleButton.addEventListener("click", async () => {
      try {
        await runFlamapyAnalysis(state, "module");
      } catch (err) {
        console.error(err);
      }
    });
  }

  if (analyzeMultiAgentButton) {
    analyzeMultiAgentButton.addEventListener("click", async () => {
      try {
        await runFlamapyAnalysis(state, "multiagent");
      } catch (err) {
        console.error(err);
      }
    });
  }

  containerEl.appendChild(fragment);
  renderAgent(state);
};

const addAgent = () => {
  if (!agentModel) {
    setStatus("Load a UVL before adding agents.", true, "agent");
    return;
  }
  const state = createFeatureState("agent", agentModel);
  agentStates.push(state);
  mountFeatureCard(state, agentTemplate, agentsContainer);
  agentStates.forEach((agent) => renderAgentHeader(agent));
  orchestrationStates.forEach((item) => renderAgent(item));
};

const createModuleInstance = () => {
  if (!moduleModel) {
    return;
  }
  const state = createFeatureState("module", moduleModel);
  moduleStates.push(state);
  const template = moduleTemplate || ensureModuleTemplate();
  mountFeatureCard(state, template, modulesContainer);
  moduleStates.forEach((item) => renderAgentHeader(item));
  orchestrationStates.forEach((item) => renderAgent(item));
};

const addModule = async () => {
  if (!moduleModel && !ensureModuleModel()) {
    await loadDefaultModuleModel();
  }
  if (!moduleModel && !ensureModuleModel()) {
    setStatus("Load a UVL before adding modules.", true, "module");
    return;
  }
  createModuleInstance();
};

const updateFlamapyAnalysisUI = (state, result,fm_type) => {

  const resultsEl = document.querySelector(`[data-analysis-results-${fm_type}]`);
  const errorEl   = document.querySelector(`[data-analysis-error-${fm_type}]`);
  const validEl   = document.querySelector(`[data-stat-valid-${fm_type}]`);
  const countEl   = document.querySelector(`[data-stat-count-${fm_type}]`);

  if (!resultsEl || !errorEl) return;

  // Reset
  resultsEl.hidden = true;
  errorEl.hidden = true;

  if (result?.error) {
    errorEl.textContent = result.error;
    errorEl.hidden = false;
    return;
  }

  // Success
  if (validEl) {
    validEl.textContent = result.valid ? "Valid" : "Invalid";
  }

  if (countEl) {
    countEl.textContent = result.config_count
  }

  resultsEl.hidden = false;
};

const clearFeatureModelModal = () => {
  if (featureModelSourceEl) {
    featureModelSourceEl.textContent = "";
  }
  if (featureModelRenderEl) {
    featureModelRenderEl.replaceChildren();
  }
  if (featureModelErrorEl) {
    featureModelErrorEl.textContent = "";
    featureModelErrorEl.hidden = true;
  }
  if (featureModelDownloadLink) {
    featureModelDownloadLink.removeAttribute("href");
    featureModelDownloadLink.removeAttribute("download");
    featureModelDownloadLink.hidden = true;
  }
};

const showFeatureModelLoading = () => {
  clearFeatureModelModal();
  if (featureModelSourceEl) {
    featureModelSourceEl.textContent = "Loading FeatureIDE diagram...";
  }
};

const applyFeatureModelZoom = () => {
  const clampedZoom = Math.min(3, Math.max(0.35, featureModelZoom));
  featureModelZoom = clampedZoom;
  if (featureModelRenderEl) {
    featureModelRenderEl.style.width = `${Math.round(clampedZoom * 100)}%`;
  }
  if (featureModelZoomLabelEl) {
    featureModelZoomLabelEl.textContent = `${Math.round(clampedZoom * 100)}%`;
  }
};

const setFeatureModelZoom = (nextZoom) => {
  featureModelZoom = nextZoom;
  applyFeatureModelZoom();
};

const openFeatureModelModal = () => {
  if (featureModelModalEl) {
    featureModelPreviousFocus = document.activeElement;
    featureModelModalEl.hidden = false;
    featureModelCloseButton?.focus();
  }
};

const closeFeatureModelModal = () => {
  if (featureModelModalEl) {
    featureModelModalEl.hidden = true;
    featureModelPreviousFocus?.focus?.();
    featureModelPreviousFocus = null;
  }
};

const renderFeatureModelModal = (data) => {
  clearFeatureModelModal();
  if (featureModelSourceEl) {
    featureModelSourceEl.textContent = data.source
      ? `FeatureIDE diagram ${data.source}`
      : "FeatureIDE diagram";
  }
  if (featureModelRenderEl && data.image) {
    const image = document.createElement("img");
    image.src = data.image;
    image.alt = "Feature model rendered by FeatureIDE";
    featureModelRenderEl.append(image);
    if (featureModelDownloadLink) {
      featureModelDownloadLink.href = data.image;
      featureModelDownloadLink.download = `feature-model-${data.fm_type || "model"}.png`;
      featureModelDownloadLink.hidden = false;
    }
    setFeatureModelZoom(1);
  } else if (featureModelRenderEl && data.svg) {
    featureModelRenderEl.innerHTML = data.svg;
    setFeatureModelZoom(1);
  }
};

const showFeatureModelError = (message) => {
  if (featureModelErrorEl) {
    featureModelErrorEl.textContent = message || "Error loading the feature model.";
    featureModelErrorEl.hidden = false;
  }
};

const showFeatureModel = async (fmType) => {
  showFeatureModelLoading();
  openFeatureModelModal();
  try {
    const response = await fetch("/api/feature-model", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fm_type: fmType }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Error loading the feature model.");
    }
    renderFeatureModelModal(data);
  } catch (error) {
    showFeatureModelError(error.message);
  }
};

if (featureModelCloseButton) {
  featureModelCloseButton.addEventListener("click", closeFeatureModelModal);
}

if (featureModelZoomInButton) {
  featureModelZoomInButton.addEventListener("click", () => setFeatureModelZoom(featureModelZoom + 0.2));
}

if (featureModelZoomOutButton) {
  featureModelZoomOutButton.addEventListener("click", () => setFeatureModelZoom(featureModelZoom - 0.2));
}

if (featureModelZoomResetButton) {
  featureModelZoomResetButton.addEventListener("click", () => setFeatureModelZoom(1));
}

if (featureModelModalEl) {
  featureModelModalEl.addEventListener("click", (event) => {
    if (event.target === featureModelModalEl) {
      closeFeatureModelModal();
    }
  });
  featureModelModalEl.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeFeatureModelModal();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(featureModelModalEl.querySelectorAll(
      'button:not([disabled]), a[href]:not([hidden]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && featureModelModalEl && !featureModelModalEl.hidden) {
    closeFeatureModelModal();
  }
});


const runFlamapyAnalysis = async (state,fm_type) => {
    try {
      if (!state.model) {
        throw new Error("UVL missing.");
      }

      const selectedFeatures = [];
      Object.keys(state.model.features).forEach(id => {
          if (isFeatureActive(state, id)) {
              selectedFeatures.push(state.model.features[id].name);
          }
      });

      const response = await fetch("/api/analyze", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selected_features: selectedFeatures,
          fm_type: fm_type
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Error");
      updateFlamapyAnalysisUI(state, data, fm_type);
    } catch (error) {
      console.error(error);
      updateFlamapyAnalysisUI(state, {
        error: error.message || "Error during analysis",fm_type
      });
    } finally {
    }
  };


const addOrchestration = () => {
  if (!orchestrationModel) {
    setStatus("Load a workflow UVL before adding a workflow.", true, "orchestration");
    return;
  }
  if (orchestrationStates.length) {
    return;
  }
  const index = orchestrationStates.length + 1;
  const state = createFeatureState("orchestration", orchestrationModel, `Workflow ${index}`);
  orchestrationStates.push(state);
  mountFeatureCard(state, orchestrationTemplate, orchestrationContainer);
  orchestrationStates.forEach((item) => renderAgentHeader(item));
};

const resetAgentsForModel = () => {
  agentStates = [];
  agentsContainer.innerHTML = "";
  addAgent();
};

const resetModulesForModel = () => {
  moduleStates = [];
  if (modulesContainer) {
    modulesContainer.innerHTML = "";
  }
  if (!moduleModel) {
    return;
  }
  createModuleInstance();
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
    throw new Error("No root feature detected.");
  }
  parsed.featurePaths = buildPathIndex(parsed);
  agentModel = parsed;
  resetAgentsForModel();
  setStatus(`Agent model loaded from ${sourceLabel}.`, false, "agent");
};

const loadModuleFromText = (text, sourceLabel) => {
  const parsed = parseUvl(text);
  if (!parsed.roots.length) {
    throw new Error("No root feature detected.");
  }
  parsed.featurePaths = buildPathIndex(parsed);
  moduleModel = parsed;
  resetModulesForModel();
  setStatus(`Module model loaded from ${sourceLabel}.`, false, "module");
};

const loadOrchestrationFromText = (text, sourceLabel) => {
  const parsed = parseUvl(text);
  if (!parsed.roots.length) {
    throw new Error("No root feature detected.");
  }
  parsed.featurePaths = buildPathIndex(parsed);
  orchestrationModel = parsed;
  resetOrchestrationForModel();
  setStatus(`Workflow model loaded from ${sourceLabel}.`, false, "orchestration");
};

const loadDefaultAgentModel = async () => {
  setStatus(`Loading ${DEFAULT_AGENT_UVL_PATH}...`, false, "agent");
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
      throw lastError || new Error("Unable to load");
    })();
    loadAgentFromText(text, DEFAULT_AGENT_UVL_PATH);
  } catch (error) {
    console.error(error);
    setStatus(`Unable to load the agent model. Start the server from the project root.`, true, "agent");
  }
};

if (loadDefaultButton) {
  loadDefaultButton.addEventListener("click", () => {
    loadDefaultAgentModel();
  });
}

const loadDefaultModuleModel = async () => {
  ensureModuleModel();
  setStatus(`Loading ${DEFAULT_MODULE_UVL_PATH}...`, false, "module");
  try {
    const text = await (async () => {
      const urls = buildUrlCandidates(DEFAULT_MODULE_UVL_PATH);
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
      throw lastError || new Error("Unable to load");
    })();
    loadModuleFromText(text, DEFAULT_MODULE_UVL_PATH);
    return true;
  } catch (error) {
    console.error(error);
  }
  try {
    loadModuleFromText(DEFAULT_MODULE_UVL_FALLBACK, "built-in module");
    return true;
  } catch (error) {
    console.error(error);
    setStatus(`Unable to load the module model. Start the server from the project root.`, true, "module");
    return false;
  }
};

if (loadModuleDefaultButton) {
  loadModuleDefaultButton.addEventListener("click", () => {
    loadDefaultModuleModel();
  });
}

if (moduleUvlFileInput) {
  moduleUvlFileInput.addEventListener("change", async () => {
    const file = moduleUvlFileInput.files?.[0];
    if (!file) {
      return;
    }
    setStatus(`Loading ${file.name}...`, false, "module");
    try {
      const text = await file.text();
      loadModuleFromText(text, file.name);
    } catch (error) {
      console.error(error);
      setStatus(`Unable to read ${file.name}.`, true, "module");
    }
  });
}

if (uvlFileInput) {
  uvlFileInput.addEventListener("change", async () => {
    const file = uvlFileInput.files?.[0];
    if (!file) {
      return;
    }
    setStatus(`Loading ${file.name}...`, false, "agent");
    try {
      const text = await file.text();
      loadAgentFromText(text, file.name);
    } catch (error) {
      console.error(error);
      setStatus(`Unable to read ${file.name}.`, true, "agent");
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
  nameEl.textContent = file ? file.name : "Choose a file";
};

if (uvlFileInput) {
  uvlFileInput.addEventListener("change", () => {
    syncFileLabel(uvlFileInput);
  });
}

if (moduleUvlFileInput) {
  moduleUvlFileInput.addEventListener("change", () => {
    syncFileLabel(moduleUvlFileInput);
  });
}

if (addAgentButton) {
  addAgentButton.addEventListener("click", () => {
    addAgent();
  });
}

if (addModuleButton) {
  addModuleButton.addEventListener("click", () => {
    addModule().catch((error) => console.error(error));
  });
}

if (addOrchestrationButton) {
  addOrchestrationButton.addEventListener("click", () => {
    addOrchestration();
  });
}

const loadDefaultOrchestrationModel = async () => {
  setStatus(`Loading ${DEFAULT_ORCHESTRATION_UVL_PATH}...`, false, "orchestration");
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
      throw lastError || new Error("Unable to load");
    })();
    loadOrchestrationFromText(text, DEFAULT_ORCHESTRATION_UVL_PATH);
  } catch (error) {
    console.error(error);
    setStatus(`Unable to load ${DEFAULT_ORCHESTRATION_UVL_PATH}.`, true, "orchestration");
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
    setStatus(`Loading ${file.name}...`, false, "orchestration");
    try {
      const text = await file.text();
      loadOrchestrationFromText(text, file.name);
    } catch (error) {
      console.error(error);
      setStatus(`Unable to read ${file.name}.`, true, "orchestration");
    }
  });
}

if (orchestrationUvlFileInput) {
  orchestrationUvlFileInput.addEventListener("change", () => {
    syncFileLabel(orchestrationUvlFileInput);
  });
}

const bindOutputUiInteractions = () => {
  targetTabLabels.forEach((label) => {
    const input = label.querySelector("input");
    if (!input || input.dataset.bound === "true") return;
    input.dataset.bound = "true";
    input.addEventListener("change", () => {
      if (input.checked) setActiveTargetPanel(label.dataset.targetTab);
    });
    if (input.checked) setActiveTargetPanel(label.dataset.targetTab);
  });

  outputTabLabels.forEach((label) => {
    const input = label.querySelector("input");
    if (!input || input.dataset.bound === "true") return;
    input.dataset.bound = "true";
    input.addEventListener("change", () => {
      if (input.checked) setActiveOutputPanel(label.dataset.outputTab);
    });
    if (input.checked) setActiveOutputPanel(label.dataset.outputTab);
  });

  outputCopyButtons.forEach((button) => {
    if (button.dataset.bound === "true") return;
    button.dataset.bound = "true";
    button.addEventListener("click", async () => {
      const pre = button.closest(".output-code")?.querySelector("[data-output]");
      const text = pre?.textContent?.trim();
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
      } catch (error) {
        console.error(error);
      }
    });
  });

  if (runCrewaiWorkflowButton && runCrewaiWorkflowButton.dataset.bound !== "true") {
    runCrewaiWorkflowButton.dataset.bound = "true";
    runCrewaiWorkflowButton.addEventListener("click", async () => {
    if (crewaiRunAborter) {
      crewaiRunAborter.abort();
    }
    const workflowCode = Array.from(document.querySelectorAll("[data-output]")).find(
      (block) => block.dataset.output === "crewai-orchestration",
    )?.textContent;
    if (!workflowCode || !workflowCode.trim()) {
      if (crewaiRunOutput) {
        crewaiRunOutput.textContent = "# No CrewAI code to execute.";
      }
      return;
    }
    crewaiRunAborter = new AbortController();
    runCrewaiWorkflowButton.disabled = true;
    if (stopCrewaiWorkflowButton) stopCrewaiWorkflowButton.disabled = false;
      if (crewaiRunOutput) {
        crewaiRunOutput.textContent = "# Execution in progress...";
      }
    try {
        const logId = window.currentLogId;
        const response = await fetch(CREWAI_RUN_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: workflowCode, inputs: {}, target: "crewai", log_id: logId,
            build_id: window.GearHistory?.getBuildId("crewai") || null }),
          signal: crewaiRunAborter.signal,
        });
        const payload = await response.json();

      // if (!window.currentTaskMetrics) {
      //     window.currentTaskMetrics = {
      //         total_tokens: 0,
      //         total_errors: 0,
      //         llm_calls: 0,
      //     };
      // }
      //
      // const m = payload.metrics || {};
      //
      // window.currentTaskMetrics.total_tokens += m.total_tokens || 0;
      // window.currentTaskMetrics.total_errors += m.total_errors || 0;
      // window.currentTaskMetrics.llm_calls += m.llm_calls || 0;


      if (!response.ok) {
        throw new Error(payload?.error || "Execution error");
      }
      const stdout = payload?.stdout || "";
      const stderr = payload?.stderr || "";
      const combined = [stdout, stderr].filter(Boolean).join("\n");
      if (crewaiRunOutput) {
        crewaiRunOutput.textContent = combined || "# No result.";
      }
    } catch (error) {
      console.error(error);
      if (crewaiRunOutput) {
        const message =
          error?.name === "AbortError"
            ? "# Execution stopped."
            : `# Error: ${error.message || error}`;
        crewaiRunOutput.textContent = message;
      }
    } finally {
      crewaiRunAborter = null;
      runCrewaiWorkflowButton.disabled = false;
      if (stopCrewaiWorkflowButton) stopCrewaiWorkflowButton.disabled = true;
    }
  });
  }

  if (stopCrewaiWorkflowButton && stopCrewaiWorkflowButton.dataset.bound !== "true") {
    stopCrewaiWorkflowButton.dataset.bound = "true";
    stopCrewaiWorkflowButton.addEventListener("click", () => {
    if (crewaiRunAborter) {
      crewaiRunAborter.abort();
    }
  });
  }

  if (runAdkWorkflowButton && runAdkWorkflowButton.dataset.bound !== "true") {
    runAdkWorkflowButton.dataset.bound = "true";
    runAdkWorkflowButton.addEventListener("click", async () => {
    if (adkRunAborter) {
      adkRunAborter.abort();
    }
    const workflowCode = Array.from(document.querySelectorAll("[data-output]")).find(
      (block) => block.dataset.output === "adk-orchestration",
    )?.textContent;
    if (!workflowCode || !workflowCode.trim()) {
      if (adkRunOutput) {
        adkRunOutput.textContent = "# No ADK code to execute.";
      }
      return;
    }
    adkRunAborter = new AbortController();
    runAdkWorkflowButton.disabled = true;
    if (stopAdkWorkflowButton) stopAdkWorkflowButton.disabled = false;
    if (adkRunOutput) {
      adkRunOutput.textContent = "# Execution in progress...";
    }
    try {

      const logId = window.currentLogId;
      const response = await fetch(CREWAI_RUN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: workflowCode, inputs: {}, target: "adk", log_id: logId,
          build_id: window.GearHistory?.getBuildId("adk") || null }),
        signal: adkRunAborter.signal,
      });

      const payload = await response.json();

      // if (!window.currentTaskMetrics) {
      //     window.currentTaskMetrics = {
      //         total_tokens: 0,
      //         total_errors: 0,
      //         llm_calls: 0,
      //     };
      // }
      //
      // const m = payload.metrics || {};
      //
      // window.currentTaskMetrics.total_tokens += m.total_tokens || 0;
      // window.currentTaskMetrics.total_errors += m.total_errors || 0;
      // window.currentTaskMetrics.llm_calls += m.llm_calls || 0;

      if (!response.ok) {
        throw new Error(payload?.error || "Execution error");
      }
      const stdout = payload?.stdout || "";
      const stderr = payload?.stderr || "";
      const combined = [stdout, stderr].filter(Boolean).join("\n");
      if (adkRunOutput) {
        adkRunOutput.textContent = combined || "# No result.";
      }
    } catch (error) {
      console.error(error);
      if (adkRunOutput) {
        const message =
          error?.name === "AbortError"
            ? "# Execution stopped."
            : `# Error: ${error.message || error}`;
        adkRunOutput.textContent = message;
      }
    } finally {
      adkRunAborter = null;
      runAdkWorkflowButton.disabled = false;
      if (stopAdkWorkflowButton) stopAdkWorkflowButton.disabled = true;
    }
  });
  }

  if (stopAdkWorkflowButton && stopAdkWorkflowButton.dataset.bound !== "true") {
    stopAdkWorkflowButton.dataset.bound = "true";
    stopAdkWorkflowButton.addEventListener("click", () => {
    if (adkRunAborter) {
      adkRunAborter.abort();
    }
  });
  }
};

const restoreAutosave = () => {
  if (!pendingAutosave || document.body.classList.contains("experiment-active")) return;
  const restoreCollection = (values, states, createState, template, container) => {
    if (!Array.isArray(values) || !values.length || !states.length) return;
    values.forEach((yamlText, index) => {
      let state = states[index];
      if (!state && index > 0) {
        state = createState();
        states.push(state);
        mountFeatureCard(state, template, container);
      }
      if (state && String(yamlText).trim()) loadFromYamlText(state, yamlText, { silent: true });
    });
  };
  restoreCollection(
    pendingAutosave.agents,
    agentStates,
    () => createFeatureState("agent", agentModel),
    agentTemplate,
    agentsContainer,
  );
  restoreCollection(
    pendingAutosave.modules,
    moduleStates,
    () => createFeatureState("module", moduleModel),
    moduleTemplate || ensureModuleTemplate(),
    modulesContainer,
  );
  if (Array.isArray(pendingAutosave.workflows) && orchestrationStates[0] && pendingAutosave.workflows[0]) {
    loadFromYamlText(orchestrationStates[0], pendingAutosave.workflows[0], { silent: true });
  }
};

loadFeaturePolicy().finally(async () => {
  await Promise.all([loadDefaultAgentModel(), loadDefaultModuleModel(), loadDefaultOrchestrationModel()]);
  modelsLoading = false;
  restoreAutosave();
  scheduleOutputsUpdate();
});
loadConnectorsRegistry();
window.GearHistory?.init({
  getSource: () => ({
    agents: agentStates.map((state) => state.els.yamlEl?.value || ""),
    modules: moduleStates.map((state) => state.els.yamlEl?.value || ""),
    workflows: orchestrationStates.map((state) => state.els.yamlEl?.value || ""),
  }),
});
Promise.all([loadCrewaiMappings(), loadAdkMappings()]).then(() => {
  refreshOutputDomRefs();
  bindOutputUiInteractions();
  scheduleOutputsUpdate();
  initializeOutputPanels();
});
window.scrollTo({ top: 0, left: 0, behavior: "auto" });
