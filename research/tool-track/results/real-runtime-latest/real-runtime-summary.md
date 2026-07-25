# GEAR real-runtime fidelity summary

- Benchmark: `1.0.0`
- Oracle: `1.0.0`
- Mode: `real-runtime-deterministic-model`
- Python: `3.13.5`
- Commit: `18669ff78dc03034a72cc1458450e0ef906847fc`

> Framework orchestration is real; only provider/model responses are deterministic local substitutes.

| Runtime | Attempts | Passed | Violations |
| --- | ---: | ---: | ---: |
| adk | 12 | 12 (100.0%) | 0 |
| autogen | 12 | 12 (100.0%) | 0 |
| crewai | 12 | 12 (100.0%) | 0 |
| haystack | 12 | 12 (100.0%) | 0 |
| langgraph | 12 | 12 (100.0%) | 0 |
| microsoft-agent-framework | 12 | 12 (100.0%) | 0 |
| native-baseline | 12 | 12 (100.0%) | 0 |
| openai-agents | 12 | 12 (100.0%) | 0 |
| pydantic-ai | 12 | 12 (100.0%) | 0 |
| semantic-kernel | 12 | 12 (100.0%) | 0 |
| strands | 12 | 12 (100.0%) | 0 |

## Pinned runtime versions

- crewai: `crewai==1.15.4`
- adk: `google-adk==2.5.0`, `litellm==1.93.0`
- langgraph: `langgraph==1.2.9`, `langchain==1.3.14`
- openai-agents: `openai-agents==0.18.3`
- microsoft-agent-framework: `agent-framework-core==1.11.0`, `agent-framework-openai==1.10.1`
- strands: `strands-agents==1.48.0`
- pydantic-ai: `pydantic-ai-slim==2.13.0`
- autogen: `autogen-agentchat==0.7.5`, `autogen-ext==0.7.5`
- semantic-kernel: `semantic-kernel==1.44.0`
- haystack: `haystack-ai==2.31.0`

See `real-runtime-raw.json` for complete traces and the transitive environment lock.
