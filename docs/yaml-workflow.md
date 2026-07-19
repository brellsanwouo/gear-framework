# Workflow YAML

The project workflow is a directed graph. Nodes reference agents or modules; edges reference node IDs and define execution order.

## Structure

```yaml
workflow:
  name: MainWorkflow
  memory: false
  nodes:
    - id: research
      ref: Researcher
      type: agent
    - id: write
      ref: Writer
      type: agent
  edges:
    - from: research
      to: write
```

## Workflow fields

| Key | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `name` | string | no | project ID | Human-readable workflow name. |
| `memory` | boolean | no | `false` | Enables workflow-level memory when supported. |
| `nodes` | array | yes | — | One or more workflow nodes. |
| `edges` | array | yes | — | Directed connections between node IDs. May be empty for one node. |

## Node fields

| Key | Type | Required | Allowed values | Description |
| --- | --- | --- | --- | --- |
| `id` | string | yes | any unique non-empty string | Identifier used by edges. |
| `ref` | string | yes | existing agent or module name | Component executed by this node. |
| `type` | string | yes | `agent`, `module` | Selects which component collection resolves `ref`. |

The same agent or module may be referenced by multiple nodes as long as every node has a unique `id`.

## Edge fields

| Key | Type | Required | Description |
| --- | --- | --- | --- |
| `from` | string | yes | Source node ID. |
| `to` | string | yes | Destination node ID. |

Do not use agent or module names in edges unless they are also the corresponding node IDs.

## Sequential workflow

```yaml
nodes:
  - { id: research, ref: Researcher, type: agent }
  - { id: write, ref: Writer, type: agent }
  - { id: review, ref: Reviewer, type: agent }
edges:
  - { from: research, to: write }
  - { from: write, to: review }
```

This produces `Researcher → Writer → Reviewer`.

## Parallel branches and join

```yaml
nodes:
  - { id: web, ref: WebResearcher, type: agent }
  - { id: documents, ref: DocumentResearcher, type: agent }
  - { id: synthesis, ref: Writer, type: agent }
edges:
  - { from: web, to: synthesis }
  - { from: documents, to: synthesis }
```

`web` and `documents` form the first execution layer. `synthesis` runs only after both branches. Every included connector preserves this dependency, using either native graph primitives or explicit asynchronous orchestration as described in [framework compatibility](/yaml-compatibility).

## Mixed agent and module workflow

```yaml
nodes:
  - { id: prepare, ref: ResearchTeam, type: module }
  - { id: review, ref: Reviewer, type: agent }
edges:
  - { from: prepare, to: review }
```

Agents and modules may appear in any valid order, including `Agent → Module → Agent`.

## Cycles

Do not create implicit cycles with workflow edges. Use an explicit `Loop` module when repetition is required.

```yaml
# Invalid implicit cycle
edges:
  - { from: first, to: second }
  - { from: second, to: first }
```

## Common errors

- Duplicate node IDs.
- `ref` does not match an existing component name.
- `type` does not match the referenced component.
- Edge endpoint does not match a node ID.
- Accidental graph cycle.
- Omitting `edges: []` for a single-node workflow.
