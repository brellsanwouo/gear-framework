const test = require("node:test");
const assert = require("node:assert/strict");

const { read, write } = require("../ui/js/workflow-order.js");

test("preserves an agent placed after a module", () => {
  const workflow = {
    Items: { Agents: ["Research", "Review"], Modules: ["Drafting"] },
    Edges: [
      { From: "Research", To: "Drafting" },
      { From: "Drafting", To: "Review" },
    ],
  };
  assert.deepEqual(read(workflow).map((item) => `${item.kind}:${item.name}`), [
    "agent:Research",
    "module:Drafting",
    "agent:Review",
  ]);
});

test("writes a sequential mixed workflow and can read it back", () => {
  const workflow = { Items: { Agents: [], Modules: [] }, Edges: [] };
  const sequence = [
    { kind: "agent", name: "Research" },
    { kind: "module", name: "Drafting" },
    { kind: "agent", name: "Review" },
  ];
  write(workflow, sequence);
  assert.deepEqual(workflow.Items, { Agents: ["Research", "Review"], Modules: ["Drafting"] });
  assert.deepEqual(workflow.Edges, [
    { From: "Research", To: "Drafting" },
    { From: "Drafting", To: "Review" },
  ]);
  assert.deepEqual(read(workflow).map((item) => item.name), ["Research", "Drafting", "Review"]);
});
