# Complete YAML examples

The repository includes validated files under `examples/`. Copy one and adjust names and prompts without changing the structural keys.

## Minimal project

Use [`examples/minimal.gear.yml`](https://github.com/brellsanwouo/gear-framework/blob/main/examples/minimal.gear.yml) for the smallest complete project: one agent, no modules, one workflow node, and no edges.

```bash
gear validate examples/minimal.gear.yml
gear convert examples/minimal.gear.yml --target crewai
```

## Three sequential agents

Use [`examples/sequential-three-agents.gear.yml`](https://github.com/brellsanwouo/gear-framework/blob/main/examples/sequential-three-agents.gear.yml) for a module-free `Researcher → Writer → Reviewer` workflow.

```bash
gear validate examples/sequential-three-agents.gear.yml
gear convert examples/sequential-three-agents.gear.yml --all-targets
```

## Parallel module followed by an agent

Use [`examples/parallel-module.gear.yml`](https://github.com/brellsanwouo/gear-framework/blob/main/examples/parallel-module.gear.yml) for two agents grouped into a parallel module, followed by a review agent.

The important references are:

```yaml
modules:
  - ModuleName: ResearchTeam
    Strategy:
      Parallel:
        ParallelAgents: [WebResearcher, DocumentResearcher]

workflow:
  nodes:
    - { id: research, ref: ResearchTeam, type: module }
    - { id: review, ref: Reviewer, type: agent }
  edges:
    - { from: research, to: review }
```

## Loop module

Use [`examples/loop-module.gear.yml`](https://github.com/brellsanwouo/gear-framework/blob/main/examples/loop-module.gear.yml) for a writer/reviewer loop followed by a publisher agent.

```yaml
modules:
  - ModuleName: DraftReviewLoop
    Strategy:
      Loop:
        TurnCount: 3
        LoopAgents: [Writer, Reviewer]
```

## Parallel module with an aggregator

Use [`examples/parallel-aggregator.gear.yml`](https://github.com/brellsanwouo/gear-framework/blob/main/examples/parallel-aggregator.gear.yml) when a dedicated agent must combine the results of a parallel group.

```yaml
modules:
  - ModuleName: ResearchTeam
    Strategy:
      Parallel:
        ParallelAgents: [WebResearcher, DocumentResearcher]
        Aggregator: Reviewer

workflow:
  nodes:
    - { id: research, ref: ResearchTeam, type: module }
  edges: []
```

`Reviewer` must be declared in `agents`. It runs after both parallel agents and receives their joined output.

## Create your own project

```bash
gear init my-project
gear validate my-project.gear.yml
gear convert my-project.gear.yml --target crewai
gear convert my-project.gear.yml --target adk
```

Replace the target with any identifier listed in the [YAML reference](/yaml-reference), or use `--all-targets` to convert with every installed connector.

Generated Python files are written below `dist/<project-id>/<target>/orchestration.py` unless another output directory is selected.
