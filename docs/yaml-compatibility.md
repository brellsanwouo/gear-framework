# Framework compatibility

The `.gear.yml` structure is shared by every connector. Conversion reports remain authoritative because a valid portable property can still require adaptation in a particular runtime.

Legend:

- **Direct**: transferred without a structural change.
- **Adapted**: translated to a related target concept or explicit Python orchestration.
- **Unavailable**: the active connector cannot generate that property safely.
- **Blocking**: the connector cancels conversion instead of silently changing the design.

## Provider scope

`LLMConfiguration.Provider` and `Model` are always valid GEAR fields. The generated adapter determines which provider values are executable.

| Target identifier | Generated model adapter | Current provider scope |
| --- | --- | --- |
| `crewai` | CrewAI `LLM` | Provider and model are forwarded to CrewAI. |
| `adk` | Google ADK `LiteLlm` | LiteLLM provider/model identifiers and compatible endpoints. |
| `langgraph` | LangChain `init_chat_model` | Provider and model are forwarded to LangChain. |
| `openai-agents` | OpenAI Agents SDK model | `openai`; another provider is blocking. |
| `microsoft-agent-framework` | `OpenAIChatClient` | OpenAI-compatible endpoints; another provider needs a custom adapter. |
| `strands` | Strands `OpenAIModel` | `openai`; another provider needs a Strands adapter. |
| `pydantic-ai` | `OpenAIChatModel` | `openai`; another provider needs its extra and adapter. |
| `autogen` | `OpenAIChatCompletionClient` | `openai`; another provider needs an AutoGen client adapter. |
| `semantic-kernel` | `OpenAIChatCompletion` | `openai` and OpenAI-compatible endpoints. |
| `haystack` | `OpenAIChatGenerator` | `openai` and OpenAI-compatible endpoints. |

Provider credentials are read from environment variables by generated code. Do not commit credentials through `LLMConfiguration.APIKey`.

## CrewAI and Google ADK agent details

These two connectors expose the broadest field-level translations in the current Studio.

| GEAR property | CrewAI | Google ADK |
| --- | --- | --- |
| Identity name | Adapted to role | Direct |
| Purpose and context | Adapted to goal/backstory | Combined into description |
| Provider and model | Supported | Supported through LiteLLM |
| API key | Provider environment variable | Provider environment variable |
| Base URL | Supported | Supported through LiteLLM |
| Timeout and retries | Supported | Supported through LiteLLM |
| Temperature, max tokens, top-p | Supported | Supported |
| Top-k | No current mapping | Supported |
| Stop sequences | Supported | Supported |
| Frequency/presence penalty and seed | Supported | Supported |
| Additional model parameters | Supported | Supported through LiteLLM |
| Task description | Direct | Direct instruction |
| Expected output | Direct | Adapted to output schema |
| Delegation and code execution | Adapted | Adapted |
| Agent memory and reasoning | Adapted | Adapted |

`Tools` stores identifiers, not executable Python definitions. A connector can only generate a tool when it has enough target-specific implementation information. Unresolved tool names remain visible in the conversion report.

## Modules and workflow

Every included connector accepts sequential workflows, parallel graph layers, parallel modules, optional aggregators, and bounded loop modules.

| Target | Sequential and graph execution | Parallel module and aggregator | Loop implementation |
| --- | --- | --- | --- |
| CrewAI | Ordered asynchronous crews | Concurrent `kickoff_async`, followed by the aggregator | Explicit bounded async loop |
| Google ADK | Native `SequentialAgent` and layered composition | Native `ParallelAgent`, optionally wrapped with an aggregation stage | Native `LoopAgent` |
| LangGraph | Native `StateGraph`, branches, and joins | Concurrent graph branches with an explicit join | Bounded graph node |
| OpenAI Agents SDK | Deterministic runner calls with SDK tracing | `asyncio.gather`, then aggregator hand-off | Bounded runner loop |
| Microsoft Agent Framework | Native workflow graph with fan-out/fan-in | Synchronized fan-out and fan-in | Bounded workflow executor |
| Strands Agents | Native `GraphBuilder` dependencies | Graph branches with dependency barriers | Bounded custom graph node |
| PydanticAI | Deterministic programmatic hand-offs | `asyncio.gather`, then typed hand-off | Bounded async loop |
| Microsoft AutoGen | Deterministic agent calls | Parallel tasks, then aggregator call | Bounded `RoundRobinGroupChat` |
| Semantic Kernel | Stable agent calls with explicit orchestration | `asyncio.gather`, then aggregator call | Bounded async loop |
| Haystack | Deterministic asynchronous hand-offs | `Agent.run_async` calls with `asyncio.gather` | Bounded async loop |

`TurnCount` is the executable hard limit for every loop connector. `StopCondition` is disabled in the Studio and remains optional legacy metadata for imported YAML projects.

## Inspect the actual conversion

Validate first, then inspect the report emitted for the selected target:

```bash
gear validate project.gear.yml
gear convert project.gear.yml --target langgraph
gear convert project.gear.yml --all-targets
```

The report separates translated, adapted, unavailable, and unmapped active properties. A blocking incompatibility prevents all artifacts requested by the same transactional conversion from being written.
