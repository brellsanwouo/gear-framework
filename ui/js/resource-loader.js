(function (global) {
  "use strict";

  const resolveBasePrefix = () => {
    let path = global.location.pathname || "/";
    if (!path.endsWith("/")) path = path.slice(0, path.lastIndexOf("/") + 1);
    if (path.endsWith("ui/")) path = path.slice(0, -3);
    if (!path.startsWith("/")) path = `/${path}`;
    return path;
  };

  const basePrefix = resolveBasePrefix();
  const candidates = (relativePath) => {
    const clean = String(relativePath || "").replace(/^\/+/, "");
    return [...new Set([`${basePrefix}${clean}`, `/${clean}`, `../${clean}`])];
  };

  const loadYaml = async (relativePath) => {
    let lastError = null;
    for (const url of candidates(relativePath)) {
      try {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (!global.jsyaml?.load) throw new Error("js-yaml is unavailable");
        return global.jsyaml.load(await response.text());
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("Unable to load YAML resource");
  };

  const loadScript = async (relativePath) => {
    let lastError = null;
    for (const url of candidates(relativePath)) {
      try {
        await new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = url;
          script.defer = true;
          script.onload = resolve;
          script.onerror = () => reject(new Error(`Script not found: ${url}`));
          document.head.appendChild(script);
        });
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("Unable to load script resource");
  };

  global.GearResourceLoader = Object.freeze({ basePrefix, candidates, loadYaml, loadScript });
})(window);
