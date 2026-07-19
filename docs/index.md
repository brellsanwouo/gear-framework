---
layout: home

hero:
  name: "GEAR Framework"
  text: "Design multi-agent systems without framework lock-in."
  tagline: Validate, convert, and run the same GEAR project across multiple agent frameworks from the Studio, SDK, or CLI.
  image:
    src: /assets/GEAR-logo.png
    alt: GEAR logo
  actions:
    - theme: brand
      text: Get started
      link: /installation
    - theme: alt
      text: Explore the Studio
      link: /studio

features:
  - title: Portable model
    details: Describe agents, modules, and workflows once in a format independent of execution runtimes.
  - title: Controlled conversion
    details: Review the Python code generated for any installed connector before downloading or running it.
  - title: Explicit validation
    details: Find unknown references, duplicates, and incompatibilities before starting a build.
  - title: SDK and CLI
    details: Automate conversions, inspect builds, and retrieve execution logs outside the Studio.
---

<GearVersion />

## One design layer, multiple runtimes

GEAR separates your multi-agent system design from its implementation in a specific framework.

<div class="gear-diagram">
  <div><strong>1. Design</strong><span>Agents, modules, constraints, and execution order.</span></div>
  <div><strong>2. Convert</strong><span>Apply the mappings of the selected connector.</span></div>
  <div><strong>3. Run</strong><span>The selected framework's Python code, in the Studio or locally.</span></div>
</div>

This keeps one stable GEAR source while allowing you to compare artifacts and behavior across target frameworks.

## Two ways to work

- **GEAR Studio** to visually build a project, validate it, and inspect its outputs.
- **SDK and CLI** to version projects, automate builds, and integrate GEAR with your tools.

[Read the guide →](/guide)
