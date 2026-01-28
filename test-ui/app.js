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

const GROUP_KEYWORDS = new Set(["mandatory", "optional", "alternative"]);
const DEFAULT_AGENT_UVL_URL = "/gear/gear-agent.uvl";
const DEFAULT_ORCHESTRATION_UVL_URL = "/gear/gear-multiagent.uvl";

let agentModel = null;
let orchestrationModel = null;
let agentStates = [];
let orchestrationStates = [];
let agentCounter = 0;

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

const isExplicitFalse = (value) => value === false;

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
    let value = true;
    if (Array.isArray(rawValue)) {
      value = rawValue;
    } else if (rawValue !== undefined && String(rawValue).trim() !== "") {
      value = coerceScalar(rawValue);
    }
    setNestedValue(yamlObj, pathParts, value);
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

const renderAgentYaml = (state) => {
  const yamlEl = state.els.yamlEl;
  if (!yamlEl) {
    return;
  }
  const yamlObj = buildYamlObjectForAgent(state);
  state.isSyncingYaml = true;
  yamlEl.value = dumpYaml(yamlObj).trim();
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

  yamlEl.addEventListener("input", syncFromYaml);

  if (loadButton) {
    loadButton.addEventListener("click", () => {
      loadFromYamlText(state, yamlEl.value, { silent: false });
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
  renderAgentSummary(state);
  renderAgentYaml(state);
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
  const removeButton = fragment.querySelector(".remove-agent");
  const loadYamlButton = fragment.querySelector("[data-agent-load-yaml]");
  const copyYamlButton = fragment.querySelector("[data-agent-copy-yaml]");
  const downloadYamlButton = fragment.querySelector("[data-agent-download-yaml]");
  const tabInputs = fragment.querySelectorAll(".agent-tabs input[type=\"radio\"]");

  state.rootEl = rootEl;
  state.els = {
    titleEl,
    treeEl,
    activeEl,
    altEl,
    yamlEl,
    removeButton,
    loadYamlButton,
    copyYamlButton,
    downloadYamlButton,
    tabInputs,
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
  setStatus(`Chargement de ${DEFAULT_AGENT_UVL_URL}…`, false, "agent");
  try {
    const response = await fetch(DEFAULT_AGENT_UVL_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const text = await response.text();
    loadAgentFromText(text, DEFAULT_AGENT_UVL_URL);
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
  setStatus(`Chargement de ${DEFAULT_ORCHESTRATION_UVL_URL}…`, false, "orchestration");
  try {
    const response = await fetch(DEFAULT_ORCHESTRATION_UVL_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const text = await response.text();
    loadOrchestrationFromText(text, DEFAULT_ORCHESTRATION_UVL_URL);
  } catch (error) {
    console.error(error);
    setStatus(`Impossible de charger ${DEFAULT_ORCHESTRATION_UVL_URL}.`, true, "orchestration");
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

loadDefaultAgentModel();
loadDefaultOrchestrationModel();
