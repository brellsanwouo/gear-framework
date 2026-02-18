# Gear Framework

![python](https://img.shields.io/badge/python-3.10%2B-blue)
![backend](https://img.shields.io/badge/backend-flask-black)
![ui](https://img.shields.io/badge/ui-vanilla%20JS-yellow)
![connectors](https://img.shields.io/badge/connectors-yaml%20%2B%20plugin-6b8cff)

**Gear Framework** is a friendly tool to **model, translate, and run multi-agent systems** across different frameworks (currently **CrewAI** and **Google ADK**) from a single Gear source model.

The goal is to help to start quickly, reduce the cost of experimentation (time, money, tokens), and avoid locking into a single framework too early. You can **compare concepts across frameworks** and **translate from one to another** using the same Gear definitions.

---

## Why this project exists

Gear Framework is designed for who want to explore multi‑agent systems without committing to a single framework too early. It helps you:

- **Save time and tokens** by reusing the same Gear definition across frameworks.
- **Compare concepts** (agents, tasks, workflows, memory) side by side.
- **Translate** one framework to another (CrewAI ↔ ADK for now).
- **Stay extensible**: new frameworks are added via mappings + plugins (no hardcoding).

---

## What this tool does

- **Model and validate** agents, modules, and workflows with **Feature Models (UVL)**.
- **Translate** Gear models to target frameworks via **YAML mappings** and **plugin-based assemblers**.
- **Generate YAML** and **runnable workflow code** per framework.
- **Execute workflows** directly from the UI.
- **Extend** to new frameworks by adding connectors (no hardcoding).

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

1) **User input**: define agents/modules/workflow via UI or YAML.
2) **Validation**: Gear Feature Models (UVL) validate structure and optionality.
3) **Translation**: mappings + plugins convert Gear → target framework.
4) **Output**: framework YAML and executable workflow code.
5) **Execution**: server runs the generated code and returns stdout/stderr.

---

## Prerequisites

- Python **>= 3.10** and **< 3.14** (CrewAI requirement)
- Flask + Flask-CORS
- PyYAML + python-dotenv
- **CrewAI** (recommended installation below)
- **Google ADK**
- **LiteLLM** (for model routing)
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
pip install flask flask-cors pyyaml python-dotenv flamapy
pip install google-adk litellm
```

### 3) Install CrewAI (official uv tool)
```
curl -LsSf https://astral.sh/uv/install.sh | sh
uv tool install crewai
```

If the shell warns about PATH:
```
uv tool update-shell
```

Verify:
```
uv tool list
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
python gear-framework/server.py
```

Default UI:
```
http://127.0.0.1:8200/ui/
```

Custom port:
```
PORT=8300 python gear-framework/server.py
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
