# ICSE 2027 Tool Demonstration checklist

Last checked against the official call: **2026-07-19**.

## Submission constraints

- [ ] Submit by **Friday, 23 October 2026, AoE**.
- [ ] Use the IEEE `IEEEtran` conference format at 10 pt.
- [ ] Keep the paper to four pages including references, figures, and tables.
- [ ] Use single-anonymous author information.
- [ ] Provide a public tool and usage instructions at submission time.
- [ ] Provide an easy-to-run distribution; reviewers must not need to build the
      tool from source. Prefer a hosted Studio and a versioned container.
- [ ] Publish a three-to-five-minute YouTube demonstration video.
- [ ] State target users, the software engineering challenge, the complete tool
      workflow, and validation results or a concrete study plan.
- [ ] Include a carbon-footprint statement or explain why it is negligible.

Official call:
https://conf.researchr.org/track/icse-2027/icse-2027-demonstrations

## Scientific package

- [x] State falsifiable research questions.
- [x] Freeze the non-participant protocol and change policy.
- [x] Version the scenario corpus and source-topology oracles.
- [x] Version the seeded fault model.
- [x] Provide a network-free benchmark runner.
- [x] Preserve raw records and derive tables automatically.
- [x] Record software and host environment metadata.
- [ ] Review and document every non-direct connector mapping lacking notes.
- [x] Add deterministic contract doubles for CrewAI, ADK, and LangGraph.
- [x] Add a native GEAR reference engine and independent trace comparator.
- [x] Add real-runtime deterministic adapters for pinned CrewAI, ADK,
      LangGraph, OpenAI Agents SDK, Microsoft Agent Framework, Strands Agents,
      PydanticAI, Microsoft AutoGen, Semantic Kernel, and Haystack releases.
- [x] Reject mismatched runtime environments and record the transitive lock.
- [x] Extend real-runtime adapters to all ten connectors.
- [x] Run the full 18-system and 1–256-agent benchmark in the development
      environment as a protocol check.
- [ ] Add framework-specific hand-written baselines for the real-runtime phase.
- [ ] Add public-project corpus selection criteria and projects where licenses
      permit redistribution.
- [ ] Run the frozen full benchmark on dedicated hardware and in the release
      container.
- [ ] Archive the selected raw result and checksum in a DOI-backed release.

## Demonstration artifact

- [ ] Create a minimal read-only hosted demo or disposable hosted workspace.
- [ ] Provide a pinned OCI container and one-command launcher.
- [ ] Create a clean sample gallery covering sequential, parallel, loop, and
      mixed workflows.
- [ ] Add an in-product link from each connector diagnostic to its explanation.
- [ ] Verify the fresh-user path: choose template, edit, validate, convert,
      inspect differences, download, run, inspect trace.
- [ ] Prepare a fallback recording and local container for the live demo.

## Artifact Evaluation follow-up

- [ ] Register the artifact by **22 January 2027, AoE**.
- [ ] Submit the artifact by **29 January 2027, AoE**.
- [ ] Target Available, Functional, and Reusable badges.
- [ ] Add `INSTALL`, `STATUS`, `REQUIREMENTS`, and archival identifiers.
- [ ] Test every documented command from a clean machine or container.

Official Artifact Evaluation call:
https://conf.researchr.org/track/icse-2027/icse-2027-artifact-evaluation
