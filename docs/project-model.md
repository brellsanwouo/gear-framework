# Project model

The stable project format is defined by `schemas/project.gear.schema.json`. A complete example is available at `examples/minimal.gear.yml`.

```yaml
schema_version: "1.0"
project:
  id: research-assistant
  name: Research assistant
agents:
  - AgentIdentity:
      Name: Researcher
      Purpose: Find accurate information.
      ContextDescription: A careful research assistant.
    LLMConfiguration:
      Provider: openai
      Model: gpt-5.1-codex-mini
    TaskSpecification:
      TaskName: Research
      TaskDescription: Research the requested topic.
      ExpectedOutput: A concise set of verified notes.
modules: []
workflow:
  name: MainWorkflow
  memory: false
  nodes:
    - id: research
      ref: Researcher
      type: agent
  edges: []
targets:
  - crewai
  - adk
```

## Agents

Each agent has a stable identity, purpose, context, model configuration, and task. The name is referenced by modules and workflows, so it must be unique.

## Modules

A module references existing agents and defines how they are coordinated. A strategy without a full equivalent in a target produces a conversion warning.

## Workflow

Nodes reference agents or modules by name. An unknown reference, such as `Module 1` without a matching module, is a blocking error. Edges define execution order.

## Advanced YAML

The Studio form intentionally exposes a small essential set. Use the YAML editor for advanced properties, then validate the project before building it.

For every supported key, type, reference rule, and value, continue with the [YAML reference](/yaml-reference). Complete copy-ready projects are available under [YAML examples](/yaml-examples).

The `targets` list contains default connector identifiers. It may contain any identifier listed in the YAML reference; the starter project uses CrewAI and Google ADK only to keep its default build small.

The JSON Schema validates structure, required values, and scalar types. The SDK then performs semantic validation for duplicate names, cross-component references, workflow edges, and implicit cycles.
