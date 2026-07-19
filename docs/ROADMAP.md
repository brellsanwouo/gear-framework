# Gear Framework roadmap

This roadmap turns the current web prototype into a reproducible engineering tool for portable multi-agent systems.

## Conversion foundations — delivered baseline

- [x] Introduce a framework-independent Gear intermediate representation (Gear IR).
- [x] Validate agent, module, workflow-node, and edge references before generation.
- [x] Detect duplicate identifiers and implicit graph cycles.
- [x] Compile workflow graphs into deterministic topological execution layers.
- [x] Compile parallel ADK layers to `ParallelAgent` stages.
- [x] Preserve CrewAI graph layers through asynchronous orchestration.
- [x] Generate a per-target report from properties actually consumed by each connector.
- [ ] Move all remaining connector-specific direct source reads behind typed lowering functions.
- [ ] Validate target IRs against versioned CrewAI and ADK schemas.
- [ ] Add golden tests covering every supported Gear feature and workflow shape.

## Security — urgent

- [ ] Revoke credentials that have been committed to the repository.
- [ ] Purge previously committed secrets from remote Git history (`.env` is now untracked and ignored).
- [x] Replace the catch-all project-file route with an explicit public-file allowlist.
- [x] Restrict host binding and CORS by default.
- [x] Disable direct workflow execution by default.
- [ ] Run generated code with minimal environment variables, no network by default, and resource limits.
  - Minimal environment and resource limits are implemented; network isolation still requires a container/sandbox backend.

## Stable project model

- [x] Define a versioned `project.gear.yml` format and JSON schema.
- [x] Separate project configuration from `.env` secrets.
- [ ] Add schema migrations and stable identifiers.
- [x] Make Gear IR construction independent from browser UI state.

## SDK and CLI

- [x] Package Gear Core as an installable Python package with typed public models.
- [x] Add `gear init`, `validate`, `inspect`, `convert`, and `build` commands.
- [x] Add connector capability inspection and machine-readable JSON output.
- [x] Keep `gear serve` as a separate web command.

## Projects, builds, logs, and artifacts

- [x] Persist immutable conversion builds in a local SQLite store.
- [x] Record source hash, schema version, connector version, diagnostics, duration, and artifacts.
- [x] Separate conversion reports from execution logs.
- [x] Correlate executions with their source build and optional trace identifier.
- [ ] Add artifact download and build comparison to the UI (recent build/log inspection is available).

## UI and accessibility

- [ ] Replace the long form with a guided Agents → Modules → Workflow → Validation → Build flow.
- [ ] Add autosave, undo for deletion, and full-project import/export.
- [x] Fix the main mobile overflow paths.
- [x] Implement accessible tabs, labels, modal focus management, and textual statuses.
- [ ] Separate the simple conversion view from advanced mapping diagnostics.

## Research application

- [x] Keep the participant experiment on dedicated routes and UI files.
- [x] Implement syntax/configuration validation, configured counterbalanced groups, consent, and progress feedback.
- [ ] Ensure Gear and manual conditions expose comparable information and controls.

## Quality gates

- [x] Add unit tests for Gear IR graph compilation and conversion fidelity reports.
- [x] Add connector tests for advanced LLM settings and parallel ADK stages.
- [x] Add Python, JavaScript, YAML, and UVL checks to CI.
- [x] Add secret scanning to CI.
- [ ] Add end-to-end, responsive, accessibility, and dependency-vulnerability checks.
