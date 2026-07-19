(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GearWorkflowOrder = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const clean = (value) => String(value ?? "").trim();
  const itemKey = (item) => `${item.kind}:${item.name}`;

  const listedItems = (workflow) => {
    const items = workflow?.Items && typeof workflow.Items === "object" ? workflow.Items : {};
    const agents = Array.isArray(items.Agents) ? items.Agents : [];
    const modules = Array.isArray(items.Modules) ? items.Modules : [];
    return [
      ...agents.map((name) => ({ kind: "agent", name: clean(name), type: "A" })),
      ...modules.map((name) => ({ kind: "module", name: clean(name), type: "M" })),
    ].filter((item) => item.name);
  };

  const read = (workflow) => {
    const items = listedItems(workflow);
    const edges = Array.isArray(workflow?.Edges) ? workflow.Edges : [];
    if (items.length < 2 || !edges.length) return items;

    const byName = new Map();
    items.forEach((item) => {
      if (!byName.has(item.name)) byName.set(item.name, []);
      byName.get(item.name).push(item);
    });
    // Name-based Studio edges cannot safely order an agent and a module that
    // share a name. Validation reports this separately; keep the listed order.
    if ([...byName.values()].some((values) => values.length > 1)) return items;

    const byKey = new Map(items.map((item) => [itemKey(item), item]));
    const indegree = new Map(items.map((item) => [itemKey(item), 0]));
    const outgoing = new Map(items.map((item) => [itemKey(item), []]));
    edges.forEach((edge) => {
      const fromName = clean(edge?.From ?? edge?.from);
      const toName = clean(edge?.To ?? edge?.to);
      const from = byName.get(fromName)?.[0];
      const to = byName.get(toName)?.[0];
      if (!from || !to) return;
      const fromKey = itemKey(from);
      const toKey = itemKey(to);
      if (outgoing.get(fromKey).includes(toKey)) return;
      outgoing.get(fromKey).push(toKey);
      indegree.set(toKey, indegree.get(toKey) + 1);
    });

    const originalIndex = new Map(items.map((item, index) => [itemKey(item), index]));
    const ready = items.filter((item) => indegree.get(itemKey(item)) === 0).map(itemKey);
    const ordered = [];
    while (ready.length) {
      ready.sort((left, right) => originalIndex.get(left) - originalIndex.get(right));
      const key = ready.shift();
      ordered.push(byKey.get(key));
      outgoing.get(key).forEach((target) => {
        indegree.set(target, indegree.get(target) - 1);
        if (indegree.get(target) === 0) ready.push(target);
      });
    }
    return ordered.length === items.length ? ordered : items;
  };

  const write = (workflow, sequence) => {
    if (!workflow.Items || typeof workflow.Items !== "object") workflow.Items = {};
    const seen = new Set();
    const items = (Array.isArray(sequence) ? sequence : [])
      .map((item) => ({
        kind: item?.kind === "module" ? "module" : "agent",
        name: clean(item?.name),
        type: item?.kind === "module" ? "M" : "A",
      }))
      .filter((item) => {
        const key = itemKey(item);
        if (!item.name || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    workflow.Items.Agents = items.filter((item) => item.kind === "agent").map((item) => item.name);
    workflow.Items.Modules = items.filter((item) => item.kind === "module").map((item) => item.name);
    workflow.Edges = items.slice(0, -1).map((item, index) => ({
      From: item.name,
      To: items[index + 1].name,
    }));
    return items;
  };

  return { read, write };
});
