# SDK and CLI

## Python

```python
from gear_sdk import convert, load_project

project = load_project("examples/minimal.gear.yml")
result = convert(project, target="crewai", output_dir="dist/crewai")
print(result.id)
print(result.output_dir / "orchestration.py")
```

## Commands

| Command | Purpose |
| --- | --- |
| `gear --version` | Display the installed version |
| `gear init <name>` | Create a starter project |
| `gear templates list` | List ready-to-use starter projects |
| `gear templates show <id>` | Preview a starter project |
| `gear validate <project>` | Validate project consistency |
| `gear inspect <project>` | Display the normalized model |
| `gear convert <project>` | Generate target artifacts |
| `gear builds list` | List persisted builds |
| `gear logs list` | List executions |
| `gear run <build-id>` | Run a local build |
| `gear serve` | Start the web interface |

Place `--json` before the subcommand for machine-readable output:

```bash
gear --json builds list
```

## Start from a test project

GEAR includes a small starter library so you can test a realistic workflow without manually creating every agent:

| Template | Agents | Modules | Structure |
| --- | ---: | ---: | --- |
| `minimal` | 1 | 0 | One general-purpose agent |
| `editorial-pipeline` | 4 | 0 | Research, plan, write, and edit sequentially |
| `research-team` | 5 | 1 | Parallel research, aggregation, writing, and fact-checking |
| `software-delivery` | 6 | 1 | Requirements, architecture, parallel implementation/testing, review, and release |

List or inspect them:

```bash
gear templates list
gear templates show research-team
```

Create a ready-to-convert project non-interactively:

```bash
gear init test_project --template research-team \
  --provider openai --model gpt-4o-mini
gear validate test_project.gear.yml
gear convert test_project.gear.yml --all-targets
```

After installing the selected runtime and setting its API key, run one generated target with an explicit test prompt:

```bash
GEAR_INPUT="Compare the benefits and limits of agent frameworks." \
  python dist/test_project/crewai/orchestration.py
```

Or let the CLI ask for the template, provider, and model:

```bash
gear init test_project --interactive
```

Provider presets only suggest an initial model name. Connector and runtime compatibility still depends on the selected framework. Use `--provider` and `--model` with any supported custom values in scripts and CI.

## Convert a project

```bash
# CrewAI only
gear convert project_1.gear.yml --target crewai

# Google ADK only
gear convert project_1.gear.yml --target adk

# Both frameworks
gear convert project_1.gear.yml --all-targets
```

The scripts are written to these locations by default:

```text
dist/project_1/crewai/orchestration.py
dist/project_1/adk/orchestration.py
```

GEAR validates the project and preflights every requested target before writing. A blocking error exits with status code `2`, prints the issues to the console, and creates no new files.

See the [conversion guide](/conversion) for output details, preflight behavior, and CI integration.
