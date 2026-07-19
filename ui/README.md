# GEAR UI

Minimal UI based on the GEAR UVL models.

Shared browser services live under `ui/js/`:

- `resource-loader.js` resolves packaged and source-checkout assets;
- `project-storage.js` owns local autosave serialization;
- `history.js` manages build and execution history;
- `workflow-order.js` preserves mixed agent/module ordering.

## Run locally

From the repository root:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000/ui/>.

The server exposes the `gear-framework` root, allowing the UI to load `/gear/gear-agent.uvl`.

## Agent configuration

- The **YAML summary** is generated automatically from the selected and completed fields.
- **Load YAML** applies a YAML configuration to the UI, including selected features and values.
- Pasted YAML is synchronized automatically after a short pause.

## Multi-agent workflow

- A dedicated section loads `gear/gear-multiagent.uvl` and configures orchestration.
- Existing agents and modules can be added to the workflow canvas.

## Framework logos

The build selector uses the official artwork published by each framework project:

- [LangGraph](https://github.com/langchain-ai/langgraph/tree/main/.github/images)
- [OpenAI Agents SDK](https://github.com/openai/openai-agents-python/tree/main/docs/assets)
- [Microsoft Agent Framework](https://github.com/microsoft/agent-framework/tree/main/docs/assets)
- [Strands Agents](https://github.com/strands-agents/sdk-python/tree/main/site/src/assets)
- [PydanticAI](https://github.com/pydantic/pydantic-ai)
- [Microsoft AutoGen](https://github.com/microsoft/autogen/tree/main/python/docs/src/_static/images/logo)
- [Semantic Kernel](https://github.com/microsoft/semantic-kernel/blob/main/docs/images/sk_logo.png)
- [Haystack](https://github.com/deepset-ai/haystack/tree/main/docs-website/static/img)

These names and logos remain trademarks of their respective owners and are used only to identify conversion targets.
