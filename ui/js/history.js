(function (root) {
  "use strict";

  const buildIds = {};
  let sourceProvider = () => ({});

  const elements = () => ({
    refresh: document.getElementById("refreshHistory"),
    record: document.getElementById("recordBuild"),
    builds: document.getElementById("buildHistory"),
    runs: document.getElementById("runHistory"),
    detail: document.getElementById("historyDetail"),
  });

  const renderList = (element, values, kind) => {
    if (!element) return;
    element.replaceChildren();
    if (!values.length) {
      const empty = document.createElement("li");
      empty.textContent = kind === "build" ? "No recorded builds." : "No recorded executions.";
      element.appendChild(empty);
      return;
    }
    values.forEach((value) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "history-item";
      button.textContent = kind === "build"
        ? `${value.project_id} → ${value.target} · ${value.duration_ms} ms`
        : `${value.status} · ${value.build_id.slice(0, 8)} · ${value.created_at}`;
      button.addEventListener("click", async () => {
        const response = await fetch(`/api/${kind === "build" ? "builds" : "logs"}/${value.id}`);
        const detail = await response.json();
        const current = elements();
        if (current.detail) {
          current.detail.hidden = false;
          current.detail.textContent = JSON.stringify(detail, null, 2);
        }
      });
      item.appendChild(button);
      element.appendChild(item);
    });
  };

  const load = async () => {
    const current = elements();
    if (!current.builds || !current.runs) return;
    try {
      const [buildResponse, runResponse] = await Promise.all([fetch("/api/builds"), fetch("/api/logs")]);
      if (!buildResponse.ok || !runResponse.ok) throw new Error("History API unavailable");
      renderList(current.builds, await buildResponse.json(), "build");
      renderList(current.runs, await runResponse.json(), "run");
    } catch (error) {
      current.builds.textContent = error.message;
      current.runs.textContent = "";
    }
  };

  const record = async () => {
    const current = elements();
    const target = document.querySelector('input[name="targetTab"]:checked')?.value;
    if (!target || !current.record) return;
    const outputs = {};
    document.querySelectorAll(`[data-output^="${target}-"]`).forEach((element) => {
      outputs[element.dataset.output.slice(target.length + 1)] = element.textContent;
    });
    current.record.disabled = true;
    try {
      const response = await fetch("/api/builds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: "ui-project", target, source: sourceProvider(), outputs }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to record build");
      buildIds[target] = result.build_id;
      if (current.detail) {
        current.detail.hidden = false;
        current.detail.textContent = `Build recorded: ${result.build_id}`;
      }
      await load();
    } catch (error) {
      if (current.detail) {
        current.detail.hidden = false;
        current.detail.textContent = error.message;
      }
    } finally {
      current.record.disabled = false;
    }
  };

  const init = (options = {}) => {
    sourceProvider = typeof options.getSource === "function" ? options.getSource : sourceProvider;
    const current = elements();
    current.refresh?.addEventListener("click", load);
    current.record?.addEventListener("click", record);
    load();
  };

  root.GearHistory = { init, load, getBuildId: (target) => buildIds[target] || null };
})(window);
