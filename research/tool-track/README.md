# GEAR tool-track evaluation

This directory contains the pre-participant evaluation of GEAR. It is designed
to support the claims of an ICSE Tool Demonstration paper with reproducible,
machine-readable evidence. It does not contain participant data and it does not
call an LLM.

The benchmark currently measures four things:

1. whether representative GEAR projects validate and generate syntactically
   valid Python for every installed connector;
2. which source properties each connector reports as exact, equivalent,
   adapted, dropped, or unavailable;
3. whether the validator detects a documented set of seeded faults, and how
   validation and conversion time evolve with workflow size;
4. how conversion output size and peak resident memory evolve from 1 to 256
   agents across all ten connectors.

The frozen corpus contains 18 named systems: six simple, six intermediate, and
six complex scenarios. It spans 1–20 agents and covers sequential pipelines,
parallel modules, aggregators, bounded loops, and mixed module/agent graphs.
Large systems are stored as compact blueprints and expanded deterministically;
their topology is checked against a separately maintained oracle.

RQ5 adds a separate deterministic orchestration-fidelity benchmark. Its first
layer executes generated CrewAI, ADK, and LangGraph source against
framework-contract doubles. Its second layer imports pinned CrewAI, ADK,
LangGraph, OpenAI Agents SDK, Microsoft Agent Framework, Strands Agents,
PydanticAI, Microsoft AutoGen, Semantic Kernel, and Haystack runtimes. Both
layers check normalized traces against the same independent oracle as a native
GEAR baseline.

These measurements are not presented as proof of universal runtime semantic
equivalence or LLM-output quality. The evidence boundary and frozen execution
procedure are described in `protocol.md` and `expected-traces/README.md`.

## Quick start

From the repository root:

```bash
python research/tool-track/runners/run_benchmark.py --quick
```

The command writes raw JSON, tidy CSV files, a machine-readable summary, and a
Markdown report to `research/tool-track/results/latest/`. No API key or target
framework runtime is needed because generated code is parsed but not executed.

Run the contract-double trace benchmark with:

```bash
python research/tool-track/runners/run_trace_benchmark.py --quick
```

Remove `--quick` for the configured three repetitions. It writes evidence to
`research/tool-track/results/runtime-latest/`.

For the pinned real-runtime layer, create the isolated environment once:

```bash
python research/tool-track/runners/prepare_real_runtime.py
```

Then run:

```bash
.gear/research-real-runtime/bin/python \
  research/tool-track/runners/run_real_runtime_benchmark.py --quick
```

This imports and executes the real CrewAI, ADK, LangGraph, OpenAI Agents SDK,
Microsoft Agent Framework, Strands Agents, PydanticAI, Microsoft AutoGen, and
Semantic Kernel and Haystack orchestration engines. Only the remote
model/provider is replaced by a deterministic local adapter.
The runner rejects missing or mismatched framework versions by default, and
records the full transitive `pip freeze`.

Run the frozen full configuration with:

```bash
python research/tool-track/runners/run_benchmark.py
```

Useful development filters are available:

```bash
python research/tool-track/runners/run_benchmark.py \
  --targets crewai,adk,langgraph \
  --scenarios sequential,parallel,loop,mixed \
  --sizes 1,8,32 \
  --repetitions 3 \
  --output /tmp/gear-benchmark
```

The full scalability profile evaluates `1, 2, 4, 8, 16, 32, 64, 100, 128,
256` agents with 30 repetitions for every connector. The quick profile uses
`1, 2, 8, 32, 128` once and must not be reported as final performance evidence.

To regenerate only the human-readable summaries from an existing raw result:

```bash
python research/tool-track/analysis/summarize.py \
  research/tool-track/results/latest/raw.json
```

## Reproducibility contract

- `benchmark.yml` is the versioned benchmark manifest.
- `research-questions.md` defines the falsifiable research questions.
- `protocol.md` freezes the procedure and exclusions before data collection.
- `submission-checklist.md` tracks the paper, demo video, release, and artifact.
- `paper-outline.md` keeps the four-page story aligned with the evidence.
- `scenarios/` contains study-specific GEAR inputs; stable public examples are
  referenced directly instead of copied. `corpus-blueprints.yml` holds compact
  definitions for the additional named systems.
- `expected-traces/` contains topology oracles and the plan for runtime traces.
- `runners/runtime_fidelity.py` contains normalized tracing, contract doubles,
  the native reference engine, and the oracle comparator.
- `runners/real_runtime_fidelity.py` contains deterministic model adapters for
  the real pinned runtimes.
- `runtime-environments.yml` and `runtime-requirements.txt` freeze the
  real-runtime environment.
- `mutations/` documents every seeded validation fault.
- `native-baselines/` defines the baseline implementation contract for the
  later cross-framework runtime study.
- `result.schema.json` defines the stable envelope of the raw evidence.
- `results/` contains generated evidence and is intentionally ignored except
  for its README.

Record the GEAR commit, environment metadata, benchmark version, command, and
raw output with every published result. Do not edit generated CSV files by
hand.

## Submission alignment

The package is structured for the ICSE 2027 Tool Demonstration and Data
Showcase requirements: a public, easy-to-run tool; a stated software
engineering problem and user population; a concrete workflow; and validation
evidence. The paper, video, archival release, and container remain release
tasks rather than benchmark outputs.

- Tool Demonstration and Data Showcase:
  https://conf.researchr.org/track/icse-2027/icse-2027-demonstrations
- Artifact Evaluation:
  https://conf.researchr.org/track/icse-2027/icse-2027-artifact-evaluation
