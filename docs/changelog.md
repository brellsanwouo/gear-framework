# Release notes

## 0.2.0

- Updated generated CrewAI projects for CrewAI 1.15 with import-safe async execution, concurrent workflow layers, parallel aggregation, bounded loops, and complete model options.
- Updated generated Google ADK projects for ADK 2.5 with native workflow agents, real runtime input, LiteLLM options, and import-safe execution.
- Aligned the combined execution dependencies so CrewAI, Google ADK, LiteLLM, and LangGraph can be installed together.
- Added the Python SDK and `gear` CLI.
- Added a stable project format and JSON schema.
- Added persistent build and execution history.
- Added the guided GEAR Studio for agents, modules, workflows, validation, and builds.
- Added local code generation and execution for CrewAI and Google ADK.
- Added conversion reports and traces correlated with builds.
- Added VitePress documentation and GitHub Pages deployment.

The version is now defined once in `gear_sdk/version.py` and consumed by the package, CLI, API, Studio, and documentation site.
