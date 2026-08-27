# GEAR Studio

The Studio guides project construction through five steps while keeping advanced YAML available without requiring it for common fields.

## Start screen

On first launch, the Studio offers the same starter library as `gear init`: a minimal agent, a four-agent editorial pipeline, a five-agent research team, and a six-agent software-delivery workflow. You can also start empty or import an existing `.gear.yml`, YAML, or Studio JSON file. The launcher opens again from **New project** or when the server exposes a new Studio revision, but not after an ordinary page refresh.

New users can select **Guided tutorial** to open a ready-to-use writer/reviewer project and follow a five-step guide through agents, modules, workflow, validation, and build. The tutorial can be restarted from the header at any time.

The current non-experiment project, selected step, and tutorial progress are stored locally and restored after a refresh. If the launcher appears following a Studio update, **Continue current project** resumes that autosave. Creating or importing another project asks for confirmation before replacing it. Research experiment projects remain server-managed and are not written to browser storage. They use the same OpenAI model list and default as the standard Studio.

Each starter asks for a project name and an OpenAI model. The provider is fixed to `openai`. When `GEAR_STUDIO_MODEL` is configured, the model is displayed as locked and the server applies it to the selected starter.

## Agents

The form contains the essential properties: stable name, purpose, context, task, provider, and model. The provider is read-only and fixed to OpenAI. `gpt-4o-mini` is selected by default; users can also choose `gpt-5.4-mini` or `gpt-4.1-mini`. Switch to YAML for advanced options.

An administrator can enforce one model for the entire Studio in `.env`:

```dotenv
GEAR_STUDIO_MODEL=gpt-4o-mini
```

When `GEAR_STUDIO_MODEL` is set, the model is read-only, imported agents are normalized to that policy, and Studio builds enforce it again on the server. Leave it empty to let users choose one of the supported mini models. The server always normalizes the provider to `openai`. Restart `gear serve` after changing the policy. API keys are never included in the public Studio configuration.

## Modules

A module groups agents and selects a strategy such as parallel or loop execution. Available agents can be selected directly from the project. Loop modules expose only their iteration count and agents; the natural-language stop condition is disabled in the Studio.

## Workflow

The component library lists the agents and modules already created. Click or drag a component into the execution preview to append it to the flow. Component types can be freely mixed, for example `Agent → Module → Agent`. The YAML panel reflects this order through edges and can be hidden to give the canvas more space.

## Validation

Issues are grouped by severity and target. Errors block the build; warnings identify partial conversions or semantic differences between runtimes.

## Build

Select any installed connector. The active target is visually highlighted and provides actions to:

- generate and inspect Python code;
- copy or download the `.py` file;
- run the build with the local runner;
- inspect the console and associated history.
