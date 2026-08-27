(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GearProjectReferences = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const replace = (value, oldName, newName) => value === oldName ? newName : value;

  const renameWorkflowReferences = (workflow, kind, oldName, newName) => {
    if (!workflow || !oldName || !newName || oldName === newName) return;
    const items = workflow.Items && typeof workflow.Items === "object" ? workflow.Items : {};
    const itemKey = kind === "module" ? "Modules" : "Agents";
    if (Array.isArray(items[itemKey])) {
      items[itemKey] = items[itemKey].map((name) => replace(name, oldName, newName));
    }
    if (Array.isArray(workflow.Edges)) {
      workflow.Edges.forEach((edge) => {
        if (!edge || typeof edge !== "object") return;
        if (Object.hasOwn(edge, "From")) edge.From = replace(edge.From, oldName, newName);
        if (Object.hasOwn(edge, "To")) edge.To = replace(edge.To, oldName, newName);
        if (Object.hasOwn(edge, "from")) edge.from = replace(edge.from, oldName, newName);
        if (Object.hasOwn(edge, "to")) edge.to = replace(edge.to, oldName, newName);
      });
    }
  };

  const renameAgentReferences = (modules, workflow, oldName, newName) => {
    if (!oldName || !newName || oldName === newName) return;
    (Array.isArray(modules) ? modules : []).forEach((moduleData) => {
      const strategy = moduleData?.Strategy;
      if (Array.isArray(strategy?.Parallel?.ParallelAgents)) {
        strategy.Parallel.ParallelAgents = strategy.Parallel.ParallelAgents.map(
          (name) => replace(name, oldName, newName),
        );
      }
      if (strategy?.Parallel?.Aggregator === oldName) strategy.Parallel.Aggregator = newName;
      if (Array.isArray(strategy?.Loop?.LoopAgents)) {
        strategy.Loop.LoopAgents = strategy.Loop.LoopAgents.map(
          (name) => replace(name, oldName, newName),
        );
      }
    });
    renameWorkflowReferences(workflow, "agent", oldName, newName);
  };

  const renameBuilderReferences = (builder, kind, oldName, newName) => {
    if (!builder || !oldName || !newName || oldName === newName) return;
    const selectionKey = kind === "module" ? "selectedModules" : "selectedAgents";
    const optionsKey = kind === "module" ? "lastModuleOptions" : "lastAgentOptions";
    [selectionKey, optionsKey].forEach((key) => {
      if (Array.isArray(builder[key])) {
        builder[key] = builder[key].map((name) => replace(name, oldName, newName));
      }
    });

    const sequence = Array.isArray(builder.sequence) ? builder.sequence : [];
    const renamed = sequence.filter(
      (item) => item?.type === kind && (item.label === oldName || (!item.label && item.id === oldName)),
    );
    const occupied = new Set(sequence.filter((item) => !renamed.includes(item)).map((item) => item.id));
    const idChanges = new Map();
    renamed.forEach((item) => {
      const oldId = item.id;
      let candidate = newName;
      let suffix = 2;
      while (occupied.has(candidate)) {
        candidate = `${newName}_${suffix}`;
        suffix += 1;
      }
      occupied.add(candidate);
      item.id = candidate;
      item.label = newName;
      idChanges.set(oldId, candidate);
    });
    if (Array.isArray(builder.edges)) {
      builder.edges.forEach((edge) => {
        if (!edge || typeof edge !== "object") return;
        if (idChanges.has(edge.from)) edge.from = idChanges.get(edge.from);
        if (idChanges.has(edge.to)) edge.to = idChanges.get(edge.to);
      });
    }
  };

  return { renameAgentReferences, renameBuilderReferences, renameWorkflowReferences };
});
