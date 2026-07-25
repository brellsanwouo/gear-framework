# Four-page tool paper outline

The central claim is deliberately narrow: **GEAR is a framework-independent,
variability-aware environment for designing, validating, and transparently
transforming LLM multi-agent systems.** It does not claim that every target has
identical runtime semantics.

## Page 1 — Problem, users, and contribution

- Explain framework lock-in and implicit semantic differences in multi-agent
  system implementations.
- Identify users: developers, researchers comparing runtimes, educators, and
  evaluators who need repeatable project definitions.
- Introduce one GEAR YAML project, validation before generation, and explicit
  mapping reports.
- List contributions: metamodel and workflow IR; connector architecture;
  Studio/CLI/SDK workflow; reproducible multi-connector evidence.

## Page 2 — Design and demonstration workflow

- One compact architecture figure: Studio/CLI/SDK → GEAR model and validator →
  connector/report → Python artifact, execution, and traces.
- Walk through a mixed agent-to-module-to-agent example.
- Show the difference panel for exact, adapted, dropped, and unsupported
  properties.
- Explain blocking diagnostics and why no artifact is written on validation
  failure.

## Page 3 — Validation

- Present RQ1–RQ4, the stratified 18-system corpus, ten connectors, eight seeded
  faults, and the 1–256-agent scalability configuration.
- Include one coverage/transparency table and one compact latency plot.
- Report counts and failures, not only percentages.
- Distinguish mapping coverage and Python syntax from runtime equivalence.
- Add the RQ5 trace-preservation table for the contract-double layer and the
  ten completed pinned-runtime integrations; label both evidence boundaries
  explicitly.

## Page 4 — Positioning, limitations, and availability

- Compare GEAR with framework-specific visual builders, workflow libraries,
  and general model-driven engineering approaches.
- State threats: benchmark representativeness, self-reported connector mapping,
  subprocess timing, and untested live LLM behavior.
- Give public repository, hosted demo/container, documentation, video, license,
  release DOI, and carbon statement.
- Close on inspectable portability rather than universal equivalence.

## Video storyboard (3–5 minutes)

1. 20 s: problem and one-sentence contribution.
2. 45 s: start from a template and edit the model in Studio.
3. 40 s: assemble a mixed workflow and trigger a blocking validation error.
4. 60 s: fix it, compare two connector mapping reports, and generate code.
5. 45 s: download and run with a deterministic model; inspect trace/console.
6. 30 s: show CLI reproduction and benchmark summary.
7. 20 s: availability, supported connectors, and limitations.

Use one prepared project and a fixed narration. Avoid spending video time on
installation, typing long YAML, or scrolling through generated source.
