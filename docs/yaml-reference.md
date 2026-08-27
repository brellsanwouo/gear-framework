# YAML reference

This section documents the stable GEAR project format accepted by the SDK and CLI. YAML keys are case-sensitive.

## Document structure

```yaml
schema_version: "1.0"
project: {}
agents: []
modules: []
workflow: {}
targets: []
```

| Key | Type | Required | Description |
| --- | --- | --- | --- |
| `schema_version` | string | yes | Must be exactly `"1.0"`. Quote it so YAML does not parse it as a number. |
| `project` | object | yes | Project metadata. |
| `agents` | array | yes | One or more agent definitions. |
| `modules` | array | no | Module definitions. Defaults to an empty list. |
| `workflow` | object | yes | Nodes and directed edges describing execution order. |
| `targets` | unique string array | no | Default connectors used by `gear convert` when `--target` is omitted. See the identifiers below. |

Allowed target identifiers:

```yaml
targets:
  - crewai
  - adk
  - langgraph
  - openai-agents
  - microsoft-agent-framework
  - strands
  - pydantic-ai
  - autogen
  - semantic-kernel
  - haystack
```

This list selects default conversions; it does not install the corresponding execution runtimes. Use `gear convert project.gear.yml --all-targets` to override it and build every installed connector.

## Project metadata

```yaml
project:
  id: content-pipeline
  name: Content pipeline
  description: Research, write, and review an article.
```

| Key | Type | Required | Rules |
| --- | --- | --- | --- |
| `project.id` | string | yes | Non-empty stable identifier. Prefer lowercase kebab-case. |
| `project.name` | string | yes | Human-readable project name. |
| `project.description` | string | no | Human-readable description. |

Unknown keys are rejected in `project` and `workflow`. Keep secrets outside the project file.

## Name and reference rules

GEAR links components by name:

- `agents[*].AgentIdentity.Name` must be unique and contain no whitespace;
- `modules[*].ModuleName` must be unique and contain no whitespace;
- `workflow.name` must contain no whitespace when provided;
- every module agent name must match an existing agent name;
- an optional parallel `Aggregator` must match an existing agent name;
- every `workflow.nodes[*].id` must be unique;
- an agent node `ref` must match an agent name;
- a module node `ref` must match a module name;
- edge `from` and `to` values reference workflow node IDs, not component names.

For example:

```yaml
agents:
  - AgentIdentity:
      Name: Writer
      # ...

workflow:
  nodes:
    - id: write
      ref: Writer
      type: agent
  edges: []
```

Here, `Writer` is the component name and `write` is the workflow node ID.

## Scalars and empty values

- Use `true` and `false` for booleans.
- Use numbers without quotes for integers and floating-point values.
- Use `[]` for an empty list and `{}` for an empty object.
- Prefer block scalars (`|`) for multiline prompts.
- Quote values that YAML could interpret as booleans, dates, or numbers.

```yaml
TaskDescription: |
  Read the source material.
  Return a concise, cited summary.
Memory: false
Tools: []
```

## Validation and conversion

Validate a file before converting it:

```bash
gear validate project.gear.yml
gear convert project.gear.yml --all-targets
```

A validation or connector error cancels the requested conversion before new artifacts are written.

## Detailed references

- [Agent YAML](/yaml-agent)
- [Module YAML](/yaml-module)
- [Workflow YAML](/yaml-workflow)
- [Complete YAML examples](/yaml-examples)
- [Framework compatibility](/yaml-compatibility)
