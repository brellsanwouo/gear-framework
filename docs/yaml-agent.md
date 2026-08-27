# Agent YAML

Each item in the top-level `agents` array is an agent object. Do not wrap it in a `GearAgent` key inside a `.gear.yml` project.

## Minimal agent

```yaml
- AgentIdentity:
    Name: Writer
    Purpose: Produce a clear final answer.
    ContextDescription: A technical writer working from verified research.
  LLMConfiguration:
    Provider: openai
    Model: gpt-4o-mini
  TaskSpecification:
    TaskName: WriteAnswer
    TaskDescription: Write the answer from the supplied research notes.
    ExpectedOutput: A concise and well-structured answer.
```

## `AgentIdentity`

| Key | Type | Required | Description |
| --- | --- | --- | --- |
| `Name` | string | yes | Unique agent name without whitespace, used by modules and workflow nodes. |
| `Purpose` | string | yes | The agent's goal or role. |
| `ContextDescription` | string | yes | Background, persona, and operating context. |

## `LLMConfiguration`

| Key | Type | Required | Description |
| --- | --- | --- | --- |
| `Provider` | string | yes | Provider identifier, for example `openai`. |
| `Model` | string | yes | Provider model identifier. |
| `APIKey` | string | no | API key value. Environment variables are strongly preferred. |
| `BaseURL` | string | no | Custom provider-compatible endpoint. |
| `Timeout` | integer | no | Request timeout in seconds. Must be at least `1`. |
| `MaxRetries` | integer | no | Maximum retry count. Must be `0` or greater. |
| `ModelParameters` | object | no | Sampling and generation settings. |

GEAR does not maintain a fixed provider or model catalogue. The connector and installed runtime must support the selected values.

In the Studio the provider is fixed to `openai`, and the model is selected from the supported OpenAI mini list unless an administrator locks it with `GEAR_STUDIO_MODEL` in `.env`. Studio builds enforce this policy; standalone YAML and CLI conversions continue to use the values declared in the project.

### `ModelParameters`

| Key | Type | Required | Description |
| --- | --- | --- | --- |
| `Temperature` | number | no | Sampling temperature. |
| `MaxTokens` | integer | no | Maximum generated tokens. Must be at least `1`. |
| `TopP` | number | no | Nucleus-sampling threshold. |
| `TopK` | integer | no | Top-k sampling limit. Must be at least `1`. |
| `StopSequences` | string array | no | Sequences that stop generation. |
| `FrequencyPenalty` | number | no | Frequency penalty when supported. |
| `PresencePenalty` | number | no | Presence penalty when supported. |
| `Seed` | integer | no | Deterministic seed when supported. |
| `AdditionalParams` | object | no | Provider-specific values. Portability is not guaranteed. |

Example:

```yaml
LLMConfiguration:
  Provider: openai
  Model: gpt-4o-mini
  Timeout: 90
  MaxRetries: 2
  ModelParameters:
    Temperature: 0.2
    MaxTokens: 1200
    TopP: 0.9
    StopSequences:
      - "END_OF_ANSWER"
```

## `TaskSpecification`

| Key | Type | Required | Description |
| --- | --- | --- | --- |
| `TaskName` | string | yes | Stable task identifier. |
| `TaskDescription` | string | yes | Instructions given to the agent. |
| `ExpectedOutput` | string | yes | Expected result and output format. |

Use a multiline scalar for substantial instructions:

```yaml
TaskSpecification:
  TaskName: ReviewDraft
  TaskDescription: |
    Review the draft for correctness and clarity.
    List factual problems before returning the corrected version.
  ExpectedOutput: |
    A Markdown document containing a short issue list and the corrected draft.
```

## Tools and behavior

| Key | Type | Required | Description |
| --- | --- | --- | --- |
| `Tools` | unique string array | no | Tool identifiers requested for the target agent. Concrete executable tool definitions are connector-specific. |
| `Memory` | boolean | no | Enables agent memory when the target supports it. |
| `Reasoning` | boolean | no | Enables target reasoning/planning support when available. |
| `ExecutionControl` | object | no | Portable execution preferences. |

### `ExecutionControl`

All fields are optional booleans.

| Key | Meaning |
| --- | --- |
| `DelegationControl` | Allow delegation or sub-agent use. |
| `CodeExecutionControl` | Allow target code-execution support. |
| `AsyncExecutionControl` | Request asynchronous task execution. |
| `HumanInteractionControl` | Request a human interaction or approval mechanism. |
| `VerbosityControl` | Enable verbose target-runtime output. |
| `CachingControl` | Enable target caching support. |

```yaml
Tools:
  - web_search
Memory: true
Reasoning: true
ExecutionControl:
  DelegationControl: false
  CodeExecutionControl: false
  AsyncExecutionControl: false
  HumanInteractionControl: false
  VerbosityControl: true
  CachingControl: true
```

These controls express intent. See [framework compatibility](/yaml-compatibility) because targets may adapt or ignore some values.

Unknown keys are rejected at every agent level. Provider credentials are read from the execution environment by generated runtimes; although `APIKey` remains accepted for schema compatibility, it should not be committed to a project file.

## Common errors

- Omitting `AgentIdentity.Name`.
- Reusing the same agent name twice.
- Omitting `LLMConfiguration.Model`.
- Omitting `TaskSpecification.TaskName`.
- Adding a `GearAgent:` wrapper inside the project-level `agents` list.
- Storing a real API key in a committed YAML file.
