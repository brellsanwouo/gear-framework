# GEAR Studio

The Studio guides project construction through five steps while keeping advanced YAML available without requiring it for common fields.

## Start screen

On first launch, the Studio offers the same starter library as `gear init`: a minimal agent, a four-agent editorial pipeline, a five-agent research team, and a six-agent software-delivery workflow. You can also start empty or import an existing `.gear.yml`, YAML, or Studio JSON file. The launcher opens again from **New project** or when the server exposes a new Studio revision, but not after an ordinary page refresh.

New users can select **Guided tutorial** to open a ready-to-use writer/reviewer project and follow a five-step guide through agents, modules, workflow, validation, and build. The tutorial can be restarted from the header at any time.

The current non-experiment project, selected step, and tutorial progress are stored locally and restored after a refresh. If the launcher appears following a Studio update, **Continue current project** resumes that autosave. Creating or importing another project asks for confirmation before replacing it. Research experiment projects remain server-managed and are not written to browser storage. They use the same provider and model choices as the standard Studio.

Each starter asks for a project name, provider, and model. The default is `openai` with `gpt-4o-mini`. An Ollama starter also requires a Base URL. When `GEAR_STUDIO_MODEL` is configured, the provider and model are displayed as locked and the server applies them to the selected starter.

## Agents

The form contains the essential properties: stable name, purpose, context, task, provider, and model. The agent feature model defines three provider branches: `openai`, `ollama`, and `OtherProvider`. Choose a provider from the dropdown; Google and Anthropic are listed under the latter branch, and **Other provider** reveals a field for another identifier. OpenAI offers `gpt-4o-mini` by default, plus `gpt-5.4-mini` and `gpt-4.1-mini`. Enter the installed model name and a Base URL reachable from the Studio server for Ollama. For another provider, enter its model name and optionally a Base URL. Switch to YAML for advanced options.

Every mandatory agent feature is checked against `gear/gear-agent.uvl`. Clearing an agent name, for example, produces `GEAR-AGENT-NAME` with the rule `AgentIdentity.Name` and a **UVL violation confirmed** badge after the server check. [Name violation capture](screenshots/studio-uvl-agent-name.png). If the renamed agent is used by the workflow, Studio also reports an unknown reference; that reference error is a separate consistency check.

OpenAI and other hosted providers read credentials from the server environment when the generated workflow runs. The Studio does not ask for or embed API keys. Ollama uses no API key. Build support still depends on the selected connector: CrewAI and Google ADK pass the Ollama model and Base URL through to their generated runtimes, while some connectors only support OpenAI.

For an Ollama agent running on the same host as the Studio server, a typical configuration is:

```yaml
LLMConfiguration:
  Provider: ollama
  Model: llama3.2:latest
  BaseURL: http://localhost:11434
```

Use the Ollama host's reachable address when it runs elsewhere. The selected model must already be available to that Ollama instance.

An administrator can enforce one model for the entire Studio in `.env`:

```dotenv
GEAR_STUDIO_MODEL=gpt-4o-mini
```

When `GEAR_STUDIO_MODEL` is set, the provider and model are read-only, imported agents are normalized to OpenAI and that model, and Studio builds enforce the policy again on the server. Leave it empty to let users choose a provider and model; OpenAI models remain limited to the supported list. Studio builds require Ollama `BaseURL` and reject Ollama `APIKey`, as specified by the feature model. Restart `gear serve` after changing the policy. API keys are never included in the public Studio configuration.

## Modules

A module groups agents and selects a strategy such as parallel or loop execution. Available agents can be selected directly from the project. Loop modules expose only their iteration count and agents; the natural-language stop condition is disabled in the Studio.

The `Strategy` group in `gear/gear-module.uvl` is `alternative`: exactly one of `Parallel` and `Loop` is selected. The form uses two independent checkboxes, so users can select both or neither and see the UVL constraint in Validation. The diagnostic states which case occurred; the server confirms it against the module UVL model before showing **UVL violation confirmed**. Reference captures: [strategy checkboxes](screenshots/studio-uvl-module-strategy.png), [both strategies in Validation](screenshots/studio-uvl-module-strategy-error.png), and [no strategy in Validation](screenshots/studio-uvl-module-no-strategy.png).

`ModuleName` is mandatory in the same UVL model. Clearing the name in the form produces a UVL diagnostic. [Module name violation capture](screenshots/studio-uvl-module-name.png).

For the no-strategy capture, create a module and uncheck **Parallel**. The diagnostic says that neither `Parallel` nor `Loop` is present.

The static feature-model diagrams shown in the legacy configurator are generated from the current UVL files with `python scripts/render_feature_models.py` (Graphviz required).

For the both-strategies capture, add a module to a Minimal project, select `ExampleAgent` as participant, and check **Loop** while **Parallel** remains checked. The form generates:

```yaml
Strategy:
  Parallel:
    ParallelAgents: [ExampleAgent]
  Loop:
    TurnCount: 1
    LoopAgents: [ExampleAgent]
```

## Workflow

The component library lists the agents and modules already created. Click or drag a component into the execution preview to append it to the flow. Component types can be freely mixed, for example `Agent → Module → Agent`. The YAML panel reflects this order through edges and can be hidden to give the canvas more space.

Studio already allowed this mixed sequence. The workflow UVL model now uses an `or` group under `Items`: at least one of `Agents` or `Modules` must be present, and both may be present. An empty workflow produces `GEAR-WORKFLOW-EMPTY` with the rule in its description and **UVL violation confirmed** after server verification. The build also checks this rule. Reference capture: [empty workflow in Validation](screenshots/studio-uvl-workflow-empty.png).

To reproduce the empty-workflow error from the visual editor, open **Workflow**, remove every node with its **×** button, then open **Validation**. The diagnostic says that neither item group is populated, while the `or` group requires at least one.

## Validation

Issues are grouped by severity and target. Errors block the build; warnings identify partial conversions or semantic differences between runtimes. When Validation opens, Studio projects mandatory fields, provider/model branches, optional groups, module strategy and participants, and workflow name and items into selected and excluded UVL features. The server checks each complete configuration against its UVL model; a verified violation is marked **UVL violation confirmed** in the diagnostic. The heading separately reports the number of automatic validation errors and the number of confirmed UVL diagnostic rows. Studio also checks required fields locally so feedback appears immediately. The build repeats the UVL checks on the server. Restart `gear serve` after updating the backend; an older running process cannot perform the new checks.

For this projection, a blank required string or an empty participants/items list counts as an absent feature. A nonempty value counts as selected. The UVL result therefore checks the feature choices represented by the YAML; Studio handles value syntax and references separately.

The UVL diagnostics cover these feature-model rules:

| UVL model | Rules reported in Validation |
| --- | --- |
| Agent | Required `AgentIdentity.Name`, `Purpose`, `ContextDescription`; required `LLMConfiguration.Provider` and `Model`; required `TaskSpecification.TaskName`, `TaskDescription`, `ExpectedOutput`; `OtherProvider => OtherModel`; `ollama => BaseURL`, `ollama => OtherModel`, `ollama => !APIKey`; `APIKey => openai \| OtherProvider`; `BaseURL => ollama \| OtherProvider`; nonempty `ModelParameters` and `ExecutionControl` groups. |
| Module | Required `ModuleName`; exactly one of `Parallel` or `Loop`; required participating agents for the selected strategy; required `Loop.TurnCount` when `Loop` is selected. |
| Workflow | Required `WorkflowName`; `Items` must contain `Agents` or `Modules` (or both). |

The UVL model records feature presence and Boolean relationships. Errors about name whitespace, URL syntax, unknown references, and numeric `TurnCount` values are separate Studio checks and do not receive a UVL badge.

To reproduce a feature-model constraint violation for a screenshot, create a **Minimal** starter project with the default OpenAI agent. Open the agent form, select **Ollama** in the **Provider** dropdown, and leave **Base URL** empty. Open **Validation** (or **View all** in the inspector) and select **Errors**. The blocking error `GEAR-AGENT-OLLAMA-BASE-URL` displays the UVL rule `ollama => BaseURL` from `gear/gear-agent.uvl`. Click **Open** on the diagnostic to return to the missing field. Enter an absolute Ollama URL, such as `http://localhost:11434` when Ollama runs on the Studio server, to clear the error. This example requires `GEAR_STUDIO_MODEL` to be unset so the provider dropdown is editable. Reference captures: [agent configuration](screenshots/studio-uvl-ollama-agent.png) and [validation error](screenshots/studio-uvl-ollama-validation.png).

## Build

Select any installed connector. The active target is visually highlighted and provides actions to:

- generate and inspect Python code;
- copy or download the `.py` file;
- run the build with the local runner;
- inspect the console and associated history.
