# Gear Framework

![python](https://img.shields.io/badge/python-3.10%2B-blue)
![backend](https://img.shields.io/badge/backend-flask-black)
![ui](https://img.shields.io/badge/ui-vanilla%20JS-yellow)
![connectors](https://img.shields.io/badge/connectors-yaml%20%2B%20plugin-6b8cff)

**Gear Framework** helps design multi-agent systems (SMA) independently from the execution framework that will run them. Instead of starting directly from CrewAI, Google ADK, or another framework-specific API, Gear lets you first describe the system at the design level: agents, modules, workflows, constraints, and variation points.

From that same Gear design, the tool can generate framework-specific YAML and executable code for several targets. This improves portability: one design can be reused, compared, and translated across frameworks without rewriting the SMA from scratch each time.

---

## Why this project exists

Most agent frameworks mix two concerns: the conceptual design of the SMA and the concrete code needed to execute it. That makes experimentation costly, because changing frameworks often means redesigning the system in another API.

Gear Framework separates those concerns. It provides a framework-independent design layer, then maps that design to concrete frameworks when execution code is needed.

It helps you:

- **Design first, execute later**: model agents, modules, and workflows independently from CrewAI, Google ADK, or any future backend.
- **Improve portability**: reuse the same SMA design across several frameworks and compare their generated implementations.
- **Generate code automatically**: produce framework-specific YAML and runnable Python code from the Gear design.
- **Manage variability explicitly**: use feature-model-based specification and variability management to represent optional features, alternatives, constraints, and valid configurations.
- **Stay extensible**: add new target frameworks through mappings and assembler plugins instead of hardcoding translations.

---

## What this tool does

- **Framework-independent SMA design**: define agents, modules, workflows, memory, tools, execution control, and model configuration in Gear.
- **Feature model specification**: maintain UVL feature models for Gear concepts and use them to analyze variability and configuration space.
- **FeatureIDE diagrams**: display pre-generated FeatureIDE PNG diagrams for the agent, module, and workflow feature models.
- **Translation to target frameworks**: map Gear designs to CrewAI and Google ADK through YAML mappings and plugin-based assemblers.
- **Automatic artifact generation**: generate framework YAML and runnable workflow code from the same source design.
- **Optional execution**: run generated workflows directly from the UI when the target framework dependencies and API keys are installed.
- **Connector-based extensibility**: add frameworks by adding mappings, templates, and assembler plugins under `connectors/`.

---

## Repository layout (what matters and why)

```
gear-framework/
├─ ui/                               # Web UI: edit Gear, view translations, run workflows
├─ gear/                             # Gear models (UVL + YAML defaults)
├─ connectors/                       # Framework connectors (all translations live here)
│  ├─ registry.yml                   # Framework registry
│  ├─ README.md                      # How to add a new connector
│  └─ frameworks/
│     ├─ _template/                  # Connector skeleton
│     ├─ crewai/
│     │  ├─ agent.mapping.yml
│     │  ├─ multiagent.mapping.yml
│     │  ├─ workflow.tmpl
│     │  └─ assembly.plugin.js
│     └─ adk/
│        ├─ agent.mapping.yml
│        ├─ multiagent.mapping.yml
│        ├─ module.mapping.yml
│        ├─ workflow.tmpl
│        └─ assembly.plugin.js
├─ data/AgentGridPlanning/           # Problem specs + templates (P0, P1, ...)
├─ SDK/gear_sdk/                     # Generic assembly engine (plugins + templates)
├─ server.py                         # Flask server + API for execution
└─ README.md
```

---

## How it works (high level)

1) **Design**: define agents, modules, and workflows in Gear through the UI or YAML.
2) **Specify variability**: use Gear feature models (UVL) to represent optional features, alternatives, constraints, and valid configurations.
3) **Analyze and visualize**: inspect the feature models and run configuration analysis with Flamapy.
4) **Translate**: apply mappings and assembler plugins to convert Gear designs into CrewAI or Google ADK artifacts.
5) **Generate code**: produce framework-specific YAML and executable Python workflow code.
6) **Execute when needed**: run the generated code only when the target framework dependencies and API keys are available.

---

## Prerequisites

- Python **>= 3.10** and **< 3.14** (CrewAI requirement)
- Python dependencies declared in `pyproject.toml`:
  Flask, Flamapy, CrewAI, Google ADK, LiteLLM, PyYAML, python-dotenv, MLflow, MySQL connector, Markdown
- API keys (at minimum `OPENAI_API_KEY` for execution)

---

## Installation

It is recommended to follow each framework's official documentation for detailed setup. Below is a working baseline:

### 1) Create a virtual environment
```
python -m venv .venv
source .venv/bin/activate
```

### 2) Install base dependencies
```
pip install --upgrade pip
pip install -e .
```

Verify the app command is available:
```
gear
```

---

## Configuration (.env)

Create a `.env` in `gear-framework/`:
```
OPENAI_API_KEY=sk-...
```

The server auto-loads `.env` and also accepts `OPENAI_KEY` or `OPENAI_TOKEN` if needed.

---

## Run the server

```
python server.py
```

Default UI:
```
http://127.0.0.1:8200/ui/
```

---

## Quickstart (beginner friendly)

1) Open the UI: `http://127.0.0.1:8200/ui/`
2) The Gear models are already loaded by default:
   - `gear/gear-agent.uvl`
   - `gear/gear-module.uvl`
   - `gear/gear-multiagent.uvl`
3) Add or edit agents, modules, and workflow.
4) Switch target framework tabs to see translated YAML and workflow code.
5) Click **Run workflow** to execute.

---

## Connectors (extensibility)

All translations are driven by files in `connectors/`:

- `connectors/registry.yml` lists frameworks and points to mappings/templates/plugins.
- `connectors/frameworks/<id>/` contains YAML mappings and workflow template.
- The **plugin** (`assembly.plugin.js`) is the only place that turns mappings into real output.

See `connectors/README.md` for a step-by-step guide.

---

## Add a new framework (step‑by‑step)

Everything needed to add a framework lives in `connectors/`. The UI and engine automatically pick it up if the registry is updated.

### 1) Create a new connector folder

```
mkdir -p connectors/frameworks/<id>
```

Copy the template:

```
cp -R connectors/frameworks/_template/* connectors/frameworks/<id>/
```

### 2) Define mappings

At minimum:

```
connectors/frameworks/<id>/agent.mapping.yml
connectors/frameworks/<id>/multiagent.mapping.yml
```

If your framework has extra concepts (like modules), add:

```
connectors/frameworks/<id>/module.mapping.yml
```

### 3) Create a workflow template

```
connectors/frameworks/<id>/workflow.tmpl
```

Keep it minimal, just placeholders. Example:

```
{{imports}}
{{agents_code}}
{{tasks_code}}
{{workflow_block}}
```

### 4) Write the assembler plugin

```
connectors/frameworks/<id>/assembly.plugin.js
```

This plugin transforms Gear data + mappings into final outputs. It must register itself:

```
window.GearAssemblyPlugins = window.GearAssemblyPlugins || {};
window.GearAssemblyPlugins["<id>"] = {
  assemble(input) {
    return { outputs: { agents: {}, orchestration: "..." } };
  }
};
```

### 5) Register the framework

Add it to `connectors/registry.yml`:

```
- id: <id>
  label: My Framework
  mappings:
    agent: connectors/frameworks/<id>/agent.mapping.yml
    multiagent: connectors/frameworks/<id>/multiagent.mapping.yml
  plugins:
    assembler: connectors/frameworks/<id>/assembly.plugin.js
  templates:
    workflow: connectors/frameworks/<id>/workflow.tmpl
```

### 6) Reload the UI

The new framework will appear automatically in the translation section.

---

## Default Gear models

- `gear/gear-agent.uvl`
- `gear/gear-module.uvl`
- `gear/gear-multiagent.uvl`

Example YAML templates:
- `gear/gear-agent.yml`
- `gear/gear-module.yml`
- `gear/gear-multiagent.yml`

---



## Practical goal

This project helps you:
- prototype multi-agent systems quickly,
- compare frameworks without rewriting everything,
- keep one Gear model as the single source of truth,
- translate and run across multiple frameworks.

---

## Problems (AgentGridPlanning)

All benchmark problems live in `data/AgentGridPlanning/`.

**Example: P0**
- Goal: **display** the puzzle (grid, symbols, coordinates) **without solving it**.
- Agent: `SystemDescriberAgent` describes the grid and rules.
- Workflow: **sequential**, single agent.
- Spec: `data/AgentGridPlanning/P0.md`.

---

## Evaluation Note (participants)

For evaluation, the UI applies a policy that:
- blocks selection of `ollama`, `OtherProvider`, `OtherModel`, `ModelParameters`, `ExecutionControl`
- forces `Provider=openai` and `Model=gpt-5.1-codex-mini`

This policy is defined in `ui/feature-policy.yml`.

To re-enable:
1. Open `ui/feature-policy.yml` and set `enabled: false` (or delete the file).
2. Optional: remove the `force` / `disable` lists if you want to return to defaults.

---

## Contact

For questions, collaborations, or bug reports, reach out to:

- brell.sanwouo@inria.fr
- nada.zine@inria.fr
