# Overview

GEAR is a portable design layer for multi-agent systems. A project describes the system independently of a runtime; an installed connector then translates it to one of the supported agent frameworks.

## The GEAR lifecycle

1. Create **agents** and their tasks.
2. Group them into parallel or iterative **modules** when needed.
3. Compose the **workflow** by dragging components in the Studio or by editing YAML.
4. Run **validation** and resolve blocking errors.
5. Select a framework in **Build**, inspect the Python code, then run or download it.

## What remains portable

Agent identity, role, task, module composition, workflow graph, and targets belong to the GEAR project. Runtime-specific implementation details stay inside each connector.

## Where are the results?

Builds and executions are stored in `.gear/gear.db` by default. Use `gear builds list` and `gear logs list` from the CLI, or open the Build history in the Studio.

Continue with [Installation](/installation), explore the [Project model](/project-model), or use the complete [YAML reference](/yaml-reference) to author a project directly.

## First project from the command line

```bash
gear init project_1
gear validate project_1.gear.yml
gear convert project_1.gear.yml --all-targets
```

Generated scripts are created under `dist/project_1/<target>/`. See the [conversion guide](/conversion) to select one target and understand blocking errors.

To begin with a complete multi-agent scenario instead of the minimal project:

```bash
gear templates list
gear init test_project --template research-team
```

The starter library includes workflows with one, four, five, or six agents. Add `--interactive` to select the template, provider, and model through guided prompts.
