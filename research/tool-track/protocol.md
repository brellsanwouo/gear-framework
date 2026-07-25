# Pre-participant evaluation protocol

Protocol version: **1.0.0**  
Benchmark manifest: `benchmark.yml`  
Study type: deterministic tool evaluation without human participants

## Objective

Evaluate whether GEAR provides a portable and inspectable construction layer
for multi-agent systems before conducting a user study. The evaluation focuses
on claims that can be tested without paid model calls: model validation,
connector generation, mapping transparency, robustness to malformed models,
and tool scalability.

## Claims under test

1. One valid GEAR project can be transformed by every advertised connector.
2. GEAR reports transformation differences instead of silently hiding them.
3. Blocking model errors are detected before output files are produced.
4. Validation and generation remain usable as project size grows within the
   configured range.

Runtime behavioral preservation is not inferred from generated-code syntax or
mapping metadata. RQ5 evaluates orchestration under deterministic contract
doubles; compatibility with actual framework releases remains separate.

## Units and factors

- **Conversion unit:** one `(scenario, connector)` pair.
- **Mutation unit:** one `(valid base project, mutation operator)` pair.
- **Scalability unit:** one `(operation, size, repetition, connector)` record;
  validation records have no connector.
- **Scenario factor:** 18 named systems stratified into six simple, six
  intermediate, and six complex cases, spanning sequential agents, parallel
  modules, aggregators, bounded loops, and mixed agent/module workflows.
- **Connector factor:** every connector returned by
  `gear_sdk.conversion.available_targets()` and listed in `benchmark.yml`.
- **Size factor:** `1, 2, 4, 8, 16, 32, 64, 100, 128, 256` agents in a
  generated sequential workflow.

## Procedure

1. Use a clean repository checkout and record the commit hash.
2. Install GEAR development dependencies and Node.js. Target runtime packages
   are not required for this phase.
3. Run the benchmark once with `--quick` as an environment check. Do not report
   quick-run timings as final results.
4. Run the full manifest on an otherwise idle machine. Record CPU, operating
   system, Python version, Node version, GEAR version, and connector versions.
5. Preserve `raw.json` as the source of truth. Generate tables using
   `analysis/summarize.py` without manual changes.
6. Repeat the full experiment in a clean container before artifact release.
7. Report every failure and unavailable mapping. Do not remove outliers unless
   an external interruption is documented and the complete run is repeated.

The runner loads and validates every scenario, checks its topology against the
predeclared oracle, converts it, parses generated Python using `ast.parse`, and
retains the connector report. Conversion does not execute imports or contact an
LLM provider.

## Metrics and analysis

- **Generation rate:** successful conversions / attempted pairs.
- **Parse rate:** syntactically valid generated Python / attempted pairs.
- **Property consumption:** consumed reported properties / all reported
  properties. This is a transparency measure, not semantic equivalence.
- **Mapping distribution:** counts of every connector-declared status. The
  current vocabulary includes `exact`, `equivalent`, `adapted`, `dropped`,
  `unmapped`, and `unsupported`.
- **Fault detection:** invalid mutants rejected / invalid mutants attempted.
- **Clean acceptance:** unmodified scenarios accepted / scenarios attempted.
- **Latency:** median, min, max, and nearest-rank p95 in milliseconds, grouped
  by operation, target, and size.
- **Scale footprint:** generated Python bytes and sampled peak resident memory
  for the benchmark process plus converter children.

The report includes raw counts with proportions. Where comparisons are later
made between connectors, confidence intervals and effect sizes must accompany
inferential tests. Connector ranking is not an objective of this phase.

## Controls

- Scenario and mutation definitions are version controlled.
- The same source project is used for every connector in a comparison.
- No network call, API key, stochastic LLM response, or target runtime import
  occurs.
- Synthetic scalability projects differ only in the number of agents and graph
  edges.
- The first process startup is not discarded; raw repetition order is retained.

## Threats to validity

- **Construct:** parsing generated Python does not imply executable or
  semantically equivalent behavior. RQ5 is required for that claim.
- **Internal:** subprocess startup contributes to conversion latency. This is
  part of end-user latency but must not be interpreted as transformation-only
  CPU time.
- **External:** 18 designed systems improve structural diversity but do not
  represent every real multi-agent system. The corpus should later include
  public projects selected by explicit inclusion criteria.
- **Conclusion:** a small number of repetitions is unsuitable for fine-grained
  performance ranking. Full runs use the manifest repetition count and retain
  distributions.
- **Implementation bias:** expected topology is specified independently, but
  connector mapping reports are emitted by GEAR itself. Native baselines and
  trace adapters are required for independent behavioral evidence.

## Runtime trace evaluation (RQ5)

The contract-double phase executes generated source for CrewAI, ADK, and
LangGraph without importing their installed runtimes or contacting a provider.
Each framework double implements only the API surface used by generated code.
The independent native reference engine interprets the GEAR graph directly and
does not use connector code. Both emit normalized `run_started`,
`agent_started`, `agent_completed`, and `run_completed` events with occurrence
tokens, input/output digests, and detected input-source event IDs.

The evaluator compares event order and data provenance, not timestamps. Parallel
siblings may appear in any order; a join may start only after all required
predecessors complete; loop iterations must not exceed `TurnCount`; and the
final output digest must originate from the expected terminal node. Both the
generated implementation and native baseline are checked against the same
oracle.

The deterministic output sentinel embeds its input digest, allowing provenance
to be detected without retaining prompt or output content in published traces.
Contract-double results must be labelled as orchestration fidelity.

The real-runtime phase uses the same projects, events, and oracle while
importing the versions frozen in `runtime-environments.yml`. Only the framework
model extension point is substituted: CrewAI `BaseLLM`, ADK `BaseLlm`,
LangChain `BaseChatModel`, OpenAI Agents SDK `Model`, Microsoft Agent Framework
`BaseChatClient`, Strands Agents `Model`, PydanticAI `FunctionModel`, Microsoft
AutoGen `ChatCompletionClient`, or Semantic Kernel
`ChatCompletionClientBase`; Haystack receives a deterministic chat-generator
component. No framework agent, crew/runner, graph, parallel module, loop
module, or generated workflow function is replaced; AutoGen retains native
`AssistantAgent` and `RoundRobinGroupChat`,
Semantic Kernel retains native `ChatCompletionAgent`, and Haystack retains
native `Agent.run_async` execution. A
deterministic synchronization gate prevents short calls from creating false
negatives in parallel-overlap checks: declared peers must all enter their model
call before any is released, with a bounded timeout for genuinely sequential
execution.

The runner fails before collection on a version mismatch unless the explicitly
development-only `--allow-version-mismatch` flag is supplied. Published results
must never use that flag. Every result records the top-level pins and complete
transitive `pip freeze`.

## Ethics, privacy, and environmental reporting

This phase has no participants and stores no personal data. Generated results
may contain host metadata, so public releases should review machine identifiers
before publication. Report machine model, run duration, number of subprocesses,
and whether runs used shared or dedicated hardware. Later LLM-based experiments
must additionally report provider/model, token counts, retries, and estimated
cost and energy proxy.

## Change policy

Any modification to scenarios, mutations, metrics, exclusions, or analysis
after the first full data collection increments the protocol and benchmark
version. Retain the previous manifest and results. Bug fixes that can affect a
measurement require rerunning all conditions; do not mix versions in one table.
