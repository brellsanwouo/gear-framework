# Installation

## Requirements

- Python 3.10 through 3.13
- Node.js 20 or newer for the current conversion engine and documentation development
- An LLM provider API key only when running generated code

## Install GEAR

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -e .
```

Check the installed version and commands:

```bash
gear --version
gear --help
node --version
```

## Add execution runtimes

Design and conversion do not require target runtimes. Install the mutually compatible runtime set only on machines that run generated workflows:

```bash
pip install -e ".[execution]"
```

Install only one runtime when that is all you need:

```bash
pip install -e ".[execution-crewai]"
pip install -e ".[execution-adk]"
pip install -e ".[execution-langgraph]"
pip install -e ".[execution-openai-agents]"
pip install -e ".[execution-microsoft-agent-framework]"
pip install -e ".[execution-strands]"
pip install -e ".[execution-pydantic-ai]"
pip install -e ".[execution-autogen]"
pip install -e ".[execution-semantic-kernel]"
pip install -e ".[execution-haystack]"
```

::: info Google ADK dependencies
GEAR installs Google ADK 2.5 with LiteLLM, which is the adapter used by generated projects. It intentionally does not install ADK's broad `extensions` extra because that bundle currently requires an older LangGraph branch. Install any additional ADK integrations separately in the runtime environment that needs them.
:::

## Start the Studio

```bash
gear serve
```

Open `http://127.0.0.1:8200/`. The Studio is now the default interface; the classic editor remains available at `http://127.0.0.1:8200/classic`.

### Configure the Studio model policy

Provider and model fields are editable per agent by default. To enforce one model for every agent created, imported, or built through the Studio, copy `.env.example` to `.env` and set:

```dotenv
GEAR_STUDIO_PROVIDER=openai
GEAR_STUDIO_MODEL=gpt-5.1-codex-mini
```

Leave `GEAR_STUDIO_MODEL` empty to keep both fields editable. Restart the Studio after changing `.env`. This policy applies to the Studio and its build endpoint; standalone YAML and CLI projects retain their own model configuration.

To allow trusted local projects to run:

```bash
GEAR_ENABLE_LOCAL_RUNNER=true gear serve
```

::: warning Local execution
The runner enforces resource limits but is not a multi-tenant sandbox. Run trusted projects only.
:::

## Create and convert a first project

```bash
gear init project_1
gear convert project_1.gear.yml --target crewai
```

The generated script is written to `dist/project_1/crewai/orchestration.py`. The [Conversion page](/conversion) covers individual and multi-target generation for every installed connector.

For a richer test project with agents and workflow already configured:

```bash
gear templates list
gear init test_project --template research-team --provider openai --model gpt-5.1-codex-mini
gear convert test_project.gear.yml --all-targets
```

Use `gear init test_project --interactive` for guided template, provider, and model selection.
