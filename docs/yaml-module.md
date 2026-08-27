# Module YAML

Modules group existing agents under one orchestration strategy. The top-level `modules` key is optional and may be an empty list.

## Common structure

```yaml
modules:
  - ModuleName: DraftingTeam
    Strategy:
      Parallel:
        ParallelAgents:
          - Researcher
          - Writer
```

| Key | Type | Required | Description |
| --- | --- | --- | --- |
| `ModuleName` | string | yes | Unique module name without whitespace, referenced by workflow module nodes. |
| `Strategy` | object | yes | Contains exactly one supported strategy: `Parallel` or `Loop`. |

Every referenced agent must exist in the top-level `agents` list. References use `AgentIdentity.Name` exactly, including case.

## Parallel strategy

```yaml
- ModuleName: Investigation
  Strategy:
    Parallel:
      ParallelAgents:
        - WebResearcher
        - DocumentResearcher
      Aggregator: Reviewer
```

| Key | Type | Required | Description |
| --- | --- | --- | --- |
| `Strategy.Parallel` | object | yes | Selects parallel execution. |
| `ParallelAgents` | unique string array | yes | One or more existing agents executed as one parallel group. |
| `Aggregator` | string | no | Existing agent that receives the joined branch outputs after the parallel group. |

Every included connector preserves the parallel group and optional aggregation order. The target may use a native graph/parallel agent or explicit asynchronous orchestration; see [framework compatibility](/yaml-compatibility).

## Loop strategy

```yaml
- ModuleName: DraftReviewLoop
  Strategy:
    Loop:
      TurnCount: 3
      LoopAgents:
        - Writer
        - Reviewer
```

| Key | Type | Required | Description |
| --- | --- | --- | --- |
| `Strategy.Loop` | object | yes | Selects repeated execution. |
| `TurnCount` | integer | yes | Maximum number of iterations. Use a positive value. |
| `StopCondition` | string | no | Legacy natural-language metadata; it is not exposed by the Studio. |
| `LoopAgents` | unique string array | yes | One or more existing agents executed on each iteration. |

Every included connector uses `TurnCount` as the executable hard limit. The Studio disables `StopCondition`; the schema accepts it only for compatibility with existing projects.

## Modules in a workflow

The workflow references the module by `ModuleName`:

```yaml
workflow:
  nodes:
    - id: drafting
      ref: DraftReviewLoop
      type: module
  edges: []
```

`drafting` is the node ID. `DraftReviewLoop` is the module reference.

## Common errors

- Defining both `Parallel` and `Loop` in one module.
- Defining neither strategy.
- Referencing an unknown or misspelled agent.
- Referencing an unknown `Aggregator` agent.
- Repeating an agent name within `ParallelAgents` or `LoopAgents`.
- Reusing a module name.
- Using a module name in `workflow.ref` with `type: agent`.
- Using `Module 1` in the workflow when no module has that exact name.
