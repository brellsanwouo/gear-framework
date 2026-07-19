# GEAR Studio

The Studio guides project construction through five steps while keeping advanced YAML available without requiring it for common fields.

## Start screen

On launch, the Studio offers the same starter library as `gear init`: a minimal agent, a four-agent editorial pipeline, a five-agent research team, and a six-agent software-delivery workflow. You can also start empty or import an existing `.gear.yml`, YAML, or Studio JSON file.

If a local autosave exists, **Continue current project** resumes it. Use **New project** in the header to reopen the starter selector later. Creating or importing another project asks for confirmation before replacing the local autosave.

Each starter asks for a project name, provider, and model. When `GEAR_STUDIO_MODEL` is configured, the provider and model are displayed as locked and the server applies them to the selected starter.

## Agents

The form contains the essential properties: stable name, purpose, context, task, provider, and model. Provider and model are editable for each agent by default. Switch to YAML for advanced options.

An administrator can enforce one model for the entire Studio in `.env`:

```dotenv
GEAR_STUDIO_PROVIDER=openai
GEAR_STUDIO_MODEL=gpt-5.1-codex-mini
```

When `GEAR_STUDIO_MODEL` is set, both fields are read-only, imported agents are normalized to that policy, and Studio builds enforce it again on the server. Leave `GEAR_STUDIO_MODEL` empty to let users choose. Restart `gear serve` after changing the policy. API keys are never included in the public Studio configuration.

## Modules

A module groups agents and selects a strategy such as parallel or loop execution. Available agents can be selected directly from the project.

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
