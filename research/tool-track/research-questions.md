# Research questions

The pre-participant evaluation addresses the following questions. Results must
be reported per scenario and per connector; aggregate values alone are not
sufficient.

## RQ1 — Conversion coverage

**Question.** To what extent can GEAR generate syntactically valid target code
for representative multi-agent workflow patterns across its supported
connectors?

**Measures.** Validation success, generation success, Python parse success, and
the number of source properties reported as `exact`, `equivalent`, `adapted`,
`dropped`, `unmapped`, `unsupported`, or another connector-declared status.

**Falsifiable expectation.** Every advertised connector generates parseable
Python for every in-scope scenario. Any failed pair falsifies full advertised
pattern coverage. A parsed file alone does not establish runtime correctness.

## RQ2 — Transformation transparency

**Question.** How explicitly does GEAR expose semantic differences introduced
by each target transformation?

**Measures.** Fraction of reported properties marked as consumed; distribution
of mapping statuses; number and severity of connector diagnostics; and
availability of a non-empty note for every property that is neither exact nor
equivalent.

**Falsifiable expectation.** Every consumed source property has a declared
mapping status, and every property that is neither exact nor equivalent has an
actionable diagnostic or note. Violations identify gaps in the conversion
report rather than being silently counted as supported.

## RQ3 — Invalid-model detection

**Question.** Does GEAR reject representative structural and referential faults
before code generation?

**Measures.** Seeded-fault detection rate, valid-scenario acceptance rate, and
diagnostic category for each mutation operator.

**Falsifiable expectation.** Every mutation listed in `mutations/catalog.yml`
is rejected by `validate_project`, while every unmodified benchmark scenario is
accepted. This is mutation adequacy for a documented fault model, not a claim
about all possible invalid configurations.

## RQ4 — Tool scalability

**Question.** How do validation latency, code-generation latency, generated
artifact size, and peak resident memory change as a sequential workflow grows
from 1 to 256 agents?

**Measures.** Median, minimum, maximum, and 95th-percentile wall-clock latency
for each operation and size; peak resident memory, generation failures, and
output size are preserved in raw results. The same sizes are converted by all
ten connectors.

**Falsifiable expectation.** The tool completes all configured sizes without
failure or timeout. No asymptotic complexity claim is made from wall-clock
observations alone.

## RQ5 — Deterministic orchestration fidelity

**Question.** Do generated implementations preserve the expected partial order,
fan-out/fan-in structure, bounded loop count, and result propagation across
target frameworks?

**Measures.** Invocation counts, completion-before-start constraints, parallel
overlap, required input-source propagation, bounded loop counts, terminal-output
origin, and total oracle violations.

**Falsifiable expectation.** Generated CrewAI, ADK, LangGraph, OpenAI Agents
SDK, Microsoft Agent Framework, Strands Agents, PydanticAI, Microsoft AutoGen,
Semantic Kernel, and Haystack orchestration and the independent native baseline
satisfy every constraint in `expected-traces/runtime.yml` for all configured
repetitions.

The evidence is collected in two separately labelled layers. Contract doubles
test generated orchestration in a minimal controlled API. The real-runtime
runner imports pinned CrewAI, ADK, LangGraph, OpenAI Agents SDK, Microsoft Agent
Framework, Strands Agents, PydanticAI, Microsoft AutoGen, Semantic Kernel, and
Haystack releases and replaces only the remote model/provider with a
deterministic local adapter. Neither layer tests the quality or stochastic
behavior of a production LLM.
