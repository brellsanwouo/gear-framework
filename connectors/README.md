# Connectors Guide

This folder defines how Gear translates to other frameworks. Each framework is a **connector** made of:

- **YAML mappings** (from Gear paths -> target paths)
- **Workflow template** (`.tmpl`)
- **Assembler plugin** (`assembly.plugin.js`) that produces the final output
- **Versioned manifest** (`connector.yml`) that declares capabilities and limitations

Everything is loaded dynamically by the UI from `registry.yml`.

---

## Folder structure

```
connectors/
├─ registry.yml
└─ frameworks/
   ├─ _template/
   ├─ crewai/
   └─ adk/
```

---

## registry.yml

`registry.yml` is the single entry point. It tells the UI and the engine where to find mappings, templates, and plugins.

Example:
```
frameworks:
  - id: crewai
    label: CrewAI
    mappings:
      agent: connectors/frameworks/crewai/agent.mapping.yml
      multiagent: connectors/frameworks/crewai/multiagent.mapping.yml
    plugins:
      assembler: connectors/frameworks/crewai/assembly.plugin.js
    templates:
      workflow: connectors/frameworks/crewai/workflow.tmpl
```

---

## Mappings

A mapping is a list of entries:

```
- from: AgentIdentity.Name
  to: Identity.Role
  kind: direct
```

Supported `kind` values are defined by the engine (direct, partial, equivalent, not_mapped). Mappings are **data-only**. They do not generate code by themselves.

---

## Templates (.tmpl)

Templates are small text files used by plugins to render workflow code. They are kept minimal and framework-specific.

Example placeholders:

```
{{imports}}
{{agents_code}}
{{tasks_code}}
{{crew_block}}
{{post_run}}
```

---

## Plugins (assembly.plugin.js)

A plugin converts Gear data + mappings into final outputs. It must register itself like this:

```
window.GearAssemblyPlugins = window.GearAssemblyPlugins || {};
window.GearAssemblyPlugins["my_framework"] = {
  assemble(input) {
    return {
      outputs: {
        agents: {...},
        tasks: {...},
        orchestration: "..."
      }
    };
  }
};
```

The engine then exposes these outputs to the UI.

---

## Add a new framework

1) Create a folder: `connectors/frameworks/<id>/`
2) Copy the template connector: `connectors/frameworks/_template/`
3) Create at least:
   - `connector.yml`
   - `agent.mapping.yml`
   - `multiagent.mapping.yml` (and/or `module.mapping.yml` if needed)
   - `workflow.tmpl`
   - `assembly.plugin.js`
4) Register it in `connectors/registry.yml`
5) Reload the UI: the framework appears automatically

---

## Tips

- Keep mappings **explicit** and **flat**. Avoid implicit logic inside YAML.
- Put all logic inside the plugin; keep templates simple.
- If outputs are missing, check the browser console to see which file failed to load.
