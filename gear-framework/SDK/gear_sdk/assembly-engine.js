(function () {
  // Generic assembly engine: loads templates + plugins and delegates per framework.
  const templateCache = new Map();
  const pluginCache = new Map();
  let registryCache = null;

  const pathToParts = (path) => {
    if (!path || typeof path !== "string") return [];
    return path.split(".").filter(Boolean);
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

  const setNestedValue = (target, pathParts, value) => {
    if (!pathParts.length) return;
    let cursor = target;
    for (let i = 0; i < pathParts.length - 1; i += 1) {
      const key = pathParts[i];
      if (!cursor[key] || typeof cursor[key] !== "object" || Array.isArray(cursor[key])) {
        cursor[key] = {};
      }
      cursor = cursor[key];
    }
    cursor[pathParts[pathParts.length - 1]] = value;
  };

  const applyMapping = (source, mappingEntries) => {
    const output = {};
    if (!source || !Array.isArray(mappingEntries)) return output;
    for (const entry of mappingEntries) {
      if (!entry || !entry.to || entry.kind === "not_mapped") continue;
      if ((entry.from === undefined || entry.from === null || entry.from === "") && "value" in entry) {
        setNestedValue(output, pathToParts(entry.to), entry.value);
        continue;
      }
      const fromList = Array.isArray(entry.from) ? entry.from : [entry.from];
      for (const fromPath of fromList) {
        if (!fromPath) continue;
        const { exists, value } = getValueAtPath(source, pathToParts(fromPath));
        if (exists) {
          setNestedValue(output, pathToParts(entry.to), value);
          break;
        }
      }
    }
    return output;
  };

  const getMappedValue = (mapped, path) => {
    const result = getValueAtPath(mapped, pathToParts(path));
    return result.exists ? result.value : undefined;
  };

  const toCrewaiModel = (provider, model) => {
    const modelText = String(model || "").trim();
    if (!modelText) return "";
    if (modelText.includes("/")) return modelText;
    if (modelText.includes(":")) {
      const [prov, rest] = modelText.split(":", 2);
      if (prov && rest) return `${prov}/${rest}`;
    }
    const provText = String(provider || "").trim();
    return provText ? `${provText}/${modelText}` : modelText;
  };

  const ensureUniqueKey = (base, prefix, index, used) => {
    const seed = (base || "").toString().trim() || `${prefix}${index}`;
    let candidate = seed;
    let i = 2;
    while (used.has(candidate)) candidate = `${seed}_${i++}`;
    used.add(candidate);
    return candidate;
  };

  const toPythonLiteral = (value) => {
    if (value === null || value === undefined) return "None";
    if (typeof value === "boolean") return value ? "True" : "False";
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : "None";
    if (Array.isArray(value)) return `[${value.map((v) => toPythonLiteral(v)).join(", ")}]`;
    if (typeof value === "object") {
      const entries = Object.entries(value).map(([k, v]) => `${toPythonLiteral(k)}: ${toPythonLiteral(v)}`);
      return `{${entries.join(", ")}}`;
    }
    return JSON.stringify(String(value));
  };

  const toPythonName = (value, fallback) => {
    const base = (value || "").toString().trim();
    if (!base) return fallback;
    const sanitized = base
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9_\s]/g, "")
      .trim()
      .replace(/\s+/g, "_")
      .toLowerCase();
    return sanitized || fallback;
  };

  const parseNameList = (value) => {
    if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
    const txt = String(value || "").trim();
    if (!txt) return [];
    return txt.split(",").map((v) => v.trim()).filter(Boolean);
  };

  const parseNumberValue = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  const renderTemplate = (template, vars) => {
    let result = template;
    Object.entries(vars).forEach(([key, value]) => {
      const token = new RegExp(`{{\\s*${key}\\s*}}`, "g");
      result = result.replace(token, value ?? "");
    });
    return result.trim();
  };

  const loadTemplates = async (basePrefix, registry) => {
    const frameworks = Array.isArray(registry?.frameworks) ? registry.frameworks : [];
    const tasks = frameworks
      .filter((fw) => fw?.templates?.workflow)
      .map(async (fw) => {
        const url = `${basePrefix}${fw.templates.workflow}`.replace(/\/{2,}/g, "/");
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) throw new Error(`Template introuvable: ${url}`);
        const text = await response.text();
        templateCache.set(fw.id, text);
      });
    await Promise.all(tasks);
  };

  const loadPlugins = async (basePrefix, registry) => {
    registryCache = registry;
    const frameworks = Array.isArray(registry?.frameworks) ? registry.frameworks : [];
    const tasks = frameworks
      .filter((fw) => fw?.plugins?.assembler)
      .map(async (fw) => {
        const url = `${basePrefix}${fw.plugins.assembler}`.replace(/\/{2,}/g, "/");
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) throw new Error(`Plugin introuvable: ${url}`);
        const code = await response.text();
        const fn = new Function("window", code);
        fn(window);
        if (window.GearAssemblyPlugins?.[fw.id]) {
          pluginCache.set(fw.id, window.GearAssemblyPlugins[fw.id]);
        }
      });
    await Promise.all(tasks);
  };

  const getTemplate = (frameworkId) => templateCache.get(frameworkId);

  const assemble = (input) => {
    const frameworks = Array.isArray(registryCache?.frameworks) ? registryCache.frameworks : [];
    const outputs = {};
    frameworks.forEach((fw) => {
      const plugin = pluginCache.get(fw.id);
      if (!plugin?.assemble) return;
      outputs[fw.id] = plugin.assemble(input);
    });
    return outputs;
  };

  window.GearAssemblyEngine = {
    loadTemplates,
    loadPlugins,
    assemble,
    utils: {
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
    },
  };
})();
