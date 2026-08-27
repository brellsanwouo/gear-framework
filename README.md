<p align="center">
  <img src="ui/assets/GEAR-logo-horizontal.png" alt="GEAR Framework" width="300">
</p>

<p align="center">
  Design portable multi-agent systems and generate runnable Python for multiple frameworks.
</p>

## About

GEAR describes agents, modules, and workflows in a framework-independent `.gear.yml` format. Projects can be converted to CrewAI, Google ADK, LangGraph, OpenAI Agents SDK, Microsoft Agent Framework, Strands Agents, PydanticAI, AutoGen, Semantic Kernel, and Haystack.

Requires Python 3.10–3.13.

## Install

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e .
```

For local execution:

```bash
pip install -e ".[execution]"
```

## Studio

```bash
gear serve
```

Open <http://127.0.0.1:8200/>.

The Studio uses OpenAI and defaults to `gpt-4o-mini`. It also offers `gpt-5.4-mini` and `gpt-4.1-mini`. Set `GEAR_STUDIO_MODEL` in `.env` to lock one model.

## CLI

```bash
gear init my-project
gear validate my-project.gear.yml
gear convert my-project.gear.yml --all-targets
```

Generated files are written to `dist/my-project/`.

## Documentation

- [Installation](docs/installation.md)
- [YAML reference](docs/yaml-reference.md)
- [Conversion](docs/conversion.md)
- [Connector guide](connectors/README.md)
- [Architecture](docs/ARCHITECTURE.md)

Full documentation: <https://brellsanwouo.github.io/gear-framework/>

## Development

```bash
pip install -e ".[dev]"
npm ci
pytest -q
node --test tests/*.test.js
```

## License

GEAR Framework is released under the [MIT License](LICENSE).

## Contact

- brell.sanwouo@inria.fr
- nada.zine@inria.fr
