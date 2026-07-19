# Convert a GEAR project

The `gear convert` command validates a project, preflights the requested connectors, and generates their Python artifacts. It does not run the workflow; execution remains a separate step.

## 1. Create the project

```bash
gear init project_1
```

GEAR creates `project_1.gear.yml`. The starter project already declares the `crewai` and `adk` targets.

## 2. Select a target

### CrewAI

```bash
gear convert project_1.gear.yml --target crewai
```

Generated script:

```text
dist/project_1/crewai/orchestration.py
```

### Google ADK

```bash
gear convert project_1.gear.yml --target adk
```

Generated script:

```text
dist/project_1/adk/orchestration.py
```

### Every installed connector

```bash
gear convert project_1.gear.yml --all-targets
```

To convert only the defaults declared by the project's `targets` list, omit the target option:

```bash
gear convert project_1.gear.yml
```

`--target` and `--all-targets` are mutually exclusive.

## 3. Understand generated files

```text
dist/
└── project_1/
    ├── crewai/
    │   ├── orchestration.py
    │   ├── agents.yml
    │   ├── tasks.yml
    │   ├── report.yml
    │   └── build.json
    ├── adk/
    │   ├── orchestration.py
    │   ├── agents.yml
    │   ├── modules.yml
    │   ├── report.yml
    │   └── build.json
    └── <other-selected-target>/
        ├── orchestration.py
        ├── report.yml
        └── build.json
```

- `orchestration.py` is the target's executable Python script.
- `report.yml` describes conversion fidelity and diagnostics.
- `build.json` lists the build artifacts.
- The remaining files expose generated intermediate configurations.

Change the output root with:

```bash
gear convert project_1.gear.yml --all-targets --output generated
```

## Blocking validation

Before writing anything, GEAR checks:

- project structure and YAML syntax;
- duplicate agent, module, and node names;
- unknown references in modules and workflows;
- edges pointing to missing nodes;
- cycles not represented by an explicit loop module;
- errors reported by each requested connector.

All requested targets are preflighted in memory. If any connector reports a blocking error, the command writes no new files, including when `--all-targets` is used.

```text
Conversion canceled: 2 blocking issue(s).
  1. Duplicate agent name: Writer.
  2. workflow node module-1 references unknown module 'Module 1'.
No new files were generated.
```

The command returns exit code `2`. Artifacts from a previous conversion are not deleted; only the new build is canceled.

## Use in scripts and CI

Place `--json` before the subcommand:

```bash
gear --json convert project_1.gear.yml --all-targets
```

When blocked, the response includes `status: "blocked"`, the failing stage, and a structured error list. On success, it includes the build ID, target, and `python_file` path.

## Next step

See [Build and execution](/builds-execution) to retrieve a build, run the script, and inspect logs.
