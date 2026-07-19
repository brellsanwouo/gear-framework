# Connectors

A connector transforms the GEAR model into target-specific artifacts. It bundles a manifest, YAML mappings, templates, and an assembly plugin.

## Included targets

| Target | Usage | Main output |
| --- | --- | --- |
| CrewAI | CrewAI agents, tasks, and orchestration | Executable Python script |
| Google ADK | Agents with native parallel and loop execution | Executable Python script |
| LangGraph | Stateful graphs with native branches and joins | Executable Python script |
| OpenAI Agents SDK | Deterministic agent orchestration with tracing | Executable Python script |
| Microsoft Agent Framework | Production graphs with synchronized fan-out and fan-in | Executable Python script |
| Strands Agents | Multi-agent graphs with explicit dependency barriers | Executable Python script |
| PydanticAI | Type-safe agents with deterministic async orchestration | Executable Python script |
| Microsoft AutoGen | Conversational agents and bounded round-robin teams | Executable Python script |
| Semantic Kernel | Stable chat agents with deterministic async orchestration | Executable Python script |
| Haystack | Native agents with deterministic asynchronous hand-offs | Executable Python script |

## Inspect connectors

```bash
gear connectors list
gear connectors show crewai
gear connectors show adk
gear connectors show langgraph
gear connectors show openai-agents
gear connectors show microsoft-agent-framework
gear connectors show strands
gear connectors show pydantic-ai
gear connectors show autogen
gear connectors show semantic-kernel
gear connectors show haystack
```

The registry is stored in `connectors/registry.yml`. See `connectors/README.md` to add a target without changing the conversion engine.

## Semantic differences

Not every GEAR construct has an exact equivalent in every framework. The conversion report separates exact, adapted, dropped, unsupported, and unmapped properties. Missing support must remain visible and is never silently ignored.

## CrewAI notes

The CrewAI connector targets CrewAI 1.15. Each GEAR agent becomes a native `Agent` and `Task`; execution uses asynchronous `Crew.kickoff_async` calls so graph layers and parallel modules remain concurrent. Loop modules enforce `TurnCount`, and an optional aggregator receives the combined branch output. Generated modules expose `run_workflow(user_input)` and only execute from the Python entry point. Tool names remain unmapped until GEAR has an executable tool registry.

## Google ADK notes

The Google ADK connector targets ADK 2.5. GEAR layers become native `SequentialAgent`, `ParallelAgent`, and `LoopAgent` compositions. Models use ADK's `LiteLlm` adapter, including custom endpoints, timeouts, retries, and additional model parameters. The runner receives the actual `GEAR_INPUT` value and generated modules are safe to import without starting a run.

## LangGraph notes

The LangGraph connector translates workflow nodes and edges directly into a `StateGraph`. Multiple outgoing edges run as branches and multiple incoming edges become a graph join. Parallel GEAR modules execute their agents concurrently. Loop modules honor `TurnCount` as a hard limit; a natural-language `StopCondition` is retained in the generated code and reported as an adapted property because it is not an executable predicate.

## OpenAI Agents SDK notes

The OpenAI Agents SDK connector uses code-driven orchestration so GEAR workflow order remains deterministic. Parallel layers use `asyncio.gather`, every agent invocation goes through `Runner`, and the workflow runs inside an SDK trace. This connector deliberately blocks non-OpenAI providers.

## Microsoft Agent Framework notes

The Microsoft Agent Framework connector generates `WorkflowBuilder` graphs. GEAR branches use `add_fan_out_edges`, joins use synchronized `add_fan_in_edges`, and modules are emitted as framework executors. OpenAI-compatible endpoints work directly; another provider requires an explicit Microsoft Agent Framework client adapter.

## Strands Agents notes

The Strands connector generates a native `GraphBuilder` graph. Parallel modules become graph branches, and every fan-in receives an explicit condition that waits for all required predecessors. Loop modules run through a bounded custom graph node that implements the Strands agent protocol. `TurnCount` is the hard limit; a natural-language `StopCondition` remains conversion metadata. The current connector generates the Strands OpenAI model adapter and blocks other providers until their adapters are implemented.

## PydanticAI notes

The PydanticAI connector uses programmatic agent hand-offs to keep the GEAR workflow deterministic. Every agent is a native `Agent`, sequential steps pass `result.output` forward, and parallel modules use `asyncio.gather`. The current connector installs the minimal OpenAI extra; an OpenAI-compatible custom endpoint is emitted through `OpenAIChatModel` and `OpenAIProvider`. Other providers are blocked until their dependency extras and adapters are enabled. Loop modules honor `TurnCount` as a hard limit, while a natural-language `StopCondition` is retained as adapted metadata.

## Microsoft AutoGen notes

The AutoGen connector generates native `AssistantAgent` instances backed by `OpenAIChatCompletionClient`. Deterministic GEAR steps call `agent.run`, parallel modules use `asyncio.gather`, and loop modules become bounded `RoundRobinGroupChat` teams. The number of team turns equals `TurnCount` multiplied by the participant count. Natural-language stop conditions remain adapted metadata. AutoGen's experimental `GraphFlow` is intentionally not generated. Install this runtime with `.[execution-autogen]` in a virtual environment separate from Google ADK because their Protobuf requirements conflict.

## Semantic Kernel notes

The Semantic Kernel connector generates native `ChatCompletionAgent` instances backed by `OpenAIChatCompletion`. Agent calls use the stable `get_response` API, while graph layers and parallel modules use explicit `asyncio.gather` barriers. Loop modules honor `TurnCount` as a hard limit and retain a natural-language `StopCondition` as adapted metadata. Semantic Kernel's native agent orchestration remains experimental, so it is intentionally not emitted into generated production code. Install the runtime only when needed with `.[execution-semantic-kernel]`.

## Haystack notes

The Haystack connector generates native `Agent` components backed by `OpenAIChatGenerator`. Each hand-off calls `Agent.run_async` with a Haystack `ChatMessage`; parallel modules and graph layers use `asyncio.gather`, while loop modules enforce `TurnCount`. Model generation settings, OpenAI-compatible endpoints, timeout, and retry settings are preserved. GEAR currently stores tool names rather than executable tool definitions, so `Tools` remains explicitly unmapped until a project-level tool registry is introduced.
