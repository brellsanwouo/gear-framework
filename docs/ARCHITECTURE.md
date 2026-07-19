# Gear Framework architecture

Gear is split into five main areas:

- `gear_sdk/`: the typed Python SDK, CLI, local store, runner, and bundled JavaScript conversion runtime.
- `gear_web/`: the Flask application. Routes are grouped under `blueprints/`, reusable logic under `services/`, and environment/path resolution under `settings.py`. `server.py` remains a compatibility entry point.
- `connectors/`: self-contained, versioned target adapters with manifests, mappings, templates, and assembler plugins.
- `ui/`: the product frontend. Cross-cutting browser services live in `ui/js/`.
- `research/`: participant-study configuration kept outside the product core.

Framework-independent UVL models remain in `gear/`; stable external project contracts live in `schemas/`.

## Web boundaries

```text
gear_web/app.py
    ├── blueprints/system.py
    ├── builds.py
    ├── blueprints/runner.py
    ├── blueprints/models.py
    ├── blueprints/research.py
    └── blueprints/pages.py
             │
             └── services/
```

The application factory wires dependencies once. Product routes do not contain research persistence, and page serving does not contain model-analysis or execution logic.

## Validation boundaries

`schemas/project.gear.schema.json` is the structural source of truth. The SDK applies that schema first, then performs graph and reference checks that JSON Schema cannot express. The standalone agent and module schema files reference the same canonical definitions.

## Conversion flow

```text
project.gear.yml / browser state
            │
            ▼
        Gear IR
            │
       validation + graph compilation
            │
     ┌──────┴──────┐
     ▼             ▼
 CrewAI adapter   ADK adapter
     │             │
     └──── artifacts + fidelity report
```

The browser and Python SDK use the same files under `gear_sdk/runtime/`, avoiding separate conversion implementations.

## Runtime data

Editable source checkouts read assets directly from the repository. Installed wheels read web assets, models, schemas, research tasks, and connectors from `share/gear-framework/`. The SDK resolves these locations explicitly and does not depend on the current working directory.
