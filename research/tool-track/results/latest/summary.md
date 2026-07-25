# GEAR benchmark summary

- Benchmark: `1.0.0`
- Protocol: `1.0.0`
- Profile: `full`
- GEAR: `0.2.0`
- Commit: `18669ff78dc03034a72cc1458450e0ef906847fc`
- Generated: `2026-07-19T10:36:06.551008+00:00`

> This static benchmark does not establish runtime semantic equivalence.

## Scenario corpus

The selected corpus contains **18 systems** spanning **1–20 agents**.

| Tier | Systems | Agent range |
| --- | ---: | ---: |
| complex | 6 | 10–20 |
| intermediate | 6 | 3–9 |
| simple | 6 | 1–6 |

## Conversion coverage

| Target | Pairs | Generated | Parsed | Property consumption | Undocumented non-direct mappings |
| --- | ---: | ---: | ---: | ---: | ---: |
| crewai | 18 | 100.0% | 100.0% | 99.3% | 41 |
| adk | 18 | 100.0% | 100.0% | 97.7% | 104 |
| langgraph | 18 | 100.0% | 100.0% | 99.3% | 77 |
| openai-agents | 18 | 100.0% | 100.0% | 99.3% | 113 |
| microsoft-agent-framework | 18 | 100.0% | 100.0% | 92.0% | 95 |
| strands | 18 | 100.0% | 100.0% | 92.0% | 95 |
| pydantic-ai | 18 | 100.0% | 100.0% | 93.4% | 95 |
| autogen | 18 | 100.0% | 100.0% | 93.4% | 95 |
| semantic-kernel | 18 | 100.0% | 100.0% | 93.4% | 77 |
| haystack | 18 | 100.0% | 100.0% | 93.4% | 115 |

Overall generation rate: **100.0%** (180/180).

Mapping statuses: `adapted` 1047, `dropped` 102, `equivalent` 1012, `exact` 810, `unmapped` 16, `unsupported` 23.

## Seeded-fault robustness

- Clean acceptance: **100.0%** (18/18).
- Seeded-fault detection: **100.0%** (8/8).
- Expected diagnostic match: **100.0%** (8/8).

## Scalability

| Operation | Target | Agents | Successful runs | Median ms | p95 ms | Median output bytes | Median peak RSS MiB |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| convert | adk | 1 | 30/30 | 49.0 | 54.0 | 1383 | 79.844 |
| convert | adk | 2 | 30/30 | 50.0 | 54.0 | 1673 | 80.188 |
| convert | adk | 4 | 30/30 | 50.0 | 57.0 | 2253 | 81.285 |
| convert | adk | 8 | 30/30 | 52.0 | 58.0 | 3413 | 81.438 |
| convert | adk | 16 | 30/30 | 55.0 | 62.0 | 5751 | 82.383 |
| convert | adk | 32 | 30/30 | 57.0 | 69.0 | 10439 | 85.047 |
| convert | adk | 64 | 30/30 | 62.0 | 73.0 | 19815 | 86.105 |
| convert | adk | 100 | 30/30 | 67.5 | 79.0 | 30363 | 88.145 |
| convert | adk | 128 | 30/30 | 74.0 | 85.0 | 38651 | 95.67 |
| convert | adk | 256 | 30/30 | 90.0 | 99.0 | 76539 | 103.357 |
| convert | autogen | 1 | 30/30 | 47.0 | 55.0 | 1418 | 79.672 |
| convert | autogen | 2 | 30/30 | 48.5 | 55.0 | 2061 | 80.184 |
| convert | autogen | 4 | 30/30 | 48.0 | 53.0 | 3347 | 80.703 |
| convert | autogen | 8 | 30/30 | 49.5 | 56.0 | 5919 | 81.072 |
| convert | autogen | 16 | 30/30 | 50.0 | 55.0 | 11081 | 81.695 |
| convert | autogen | 32 | 30/30 | 50.5 | 57.0 | 21417 | 83.875 |
| convert | autogen | 64 | 30/30 | 54.5 | 61.0 | 42089 | 84.568 |
| convert | autogen | 100 | 30/30 | 55.0 | 64.0 | 65345 | 87.322 |
| convert | autogen | 128 | 30/30 | 56.0 | 65.0 | 83517 | 89.059 |
| convert | autogen | 256 | 30/30 | 67.0 | 74.0 | 166589 | 96.035 |
| convert | crewai | 1 | 30/30 | 47.0 | 59.0 | 1374 | 79.414 |
| convert | crewai | 2 | 30/30 | 47.0 | 55.0 | 2347 | 80.188 |
| convert | crewai | 4 | 30/30 | 49.0 | 54.0 | 4293 | 80.684 |
| convert | crewai | 8 | 30/30 | 49.0 | 57.0 | 8185 | 81.178 |
| convert | crewai | 16 | 30/30 | 51.5 | 56.0 | 15987 | 81.695 |
| convert | crewai | 32 | 30/30 | 54.0 | 62.0 | 31603 | 83.756 |
| convert | crewai | 64 | 30/30 | 59.0 | 66.0 | 62835 | 85.227 |
| convert | crewai | 100 | 30/30 | 61.0 | 70.0 | 97971 | 88.281 |
| convert | crewai | 128 | 30/30 | 61.5 | 69.0 | 125383 | 90.199 |
| convert | crewai | 256 | 30/30 | 76.0 | 83.0 | 250695 | 97.244 |
| convert | haystack | 1 | 30/30 | 46.5 | 54.0 | 1213 | 79.328 |
| convert | haystack | 2 | 30/30 | 47.5 | 55.0 | 1711 | 80.359 |
| convert | haystack | 4 | 30/30 | 49.0 | 56.0 | 2707 | 80.531 |
| convert | haystack | 8 | 30/30 | 47.0 | 54.0 | 4699 | 81.008 |
| convert | haystack | 16 | 30/30 | 51.0 | 57.0 | 8701 | 81.695 |
| convert | haystack | 32 | 30/30 | 52.0 | 60.0 | 16717 | 83.414 |
| convert | haystack | 64 | 30/30 | 55.0 | 64.0 | 32749 | 84.393 |
| convert | haystack | 100 | 30/30 | 55.0 | 61.0 | 50785 | 87.398 |
| convert | haystack | 128 | 30/30 | 57.5 | 68.0 | 64897 | 88.592 |
| convert | haystack | 256 | 30/30 | 67.0 | 79.0 | 129409 | 96.033 |
| convert | langgraph | 1 | 30/30 | 48.0 | 56.0 | 1430 | 79.414 |
| convert | langgraph | 2 | 30/30 | 47.0 | 53.0 | 1979 | 80.016 |
| convert | langgraph | 4 | 30/30 | 48.5 | 55.0 | 3077 | 80.789 |
| convert | langgraph | 8 | 30/30 | 48.5 | 52.0 | 5273 | 81.094 |
| convert | langgraph | 16 | 30/30 | 50.0 | 57.0 | 9683 | 81.695 |
| convert | langgraph | 32 | 30/30 | 51.5 | 58.0 | 18515 | 83.586 |
| convert | langgraph | 64 | 30/30 | 55.5 | 62.0 | 36179 | 83.447 |
| convert | langgraph | 100 | 30/30 | 56.0 | 65.0 | 56051 | 87.303 |
| convert | langgraph | 128 | 30/30 | 55.0 | 68.0 | 71591 | 88.768 |
| convert | langgraph | 256 | 30/30 | 69.0 | 79.0 | 142631 | 96.637 |
| convert | microsoft-agent-framework | 1 | 30/30 | 47.5 | 51.0 | 2964 | 79.758 |
| convert | microsoft-agent-framework | 2 | 30/30 | 46.0 | 52.0 | 3350 | 80.156 |
| convert | microsoft-agent-framework | 4 | 30/30 | 49.0 | 57.0 | 4122 | 80.701 |
| convert | microsoft-agent-framework | 8 | 30/30 | 46.0 | 53.0 | 5666 | 81.008 |
| convert | microsoft-agent-framework | 16 | 30/30 | 50.0 | 57.0 | 8772 | 81.863 |
| convert | microsoft-agent-framework | 32 | 30/30 | 52.5 | 58.0 | 14996 | 83.758 |
| convert | microsoft-agent-framework | 64 | 30/30 | 56.0 | 64.0 | 27444 | 84.068 |
| convert | microsoft-agent-framework | 100 | 30/30 | 58.0 | 63.0 | 41448 | 85.461 |
| convert | microsoft-agent-framework | 128 | 30/30 | 58.0 | 66.0 | 52424 | 89.43 |
| convert | microsoft-agent-framework | 256 | 30/30 | 69.0 | 74.0 | 102600 | 101.328 |
| convert | openai-agents | 1 | 30/30 | 47.0 | 53.0 | 810 | 79.672 |
| convert | openai-agents | 2 | 30/30 | 48.0 | 57.0 | 1211 | 80.102 |
| convert | openai-agents | 4 | 30/30 | 47.0 | 53.0 | 2013 | 80.699 |
| convert | openai-agents | 8 | 30/30 | 48.0 | 52.0 | 3617 | 81.008 |
| convert | openai-agents | 16 | 30/30 | 50.0 | 59.0 | 6843 | 81.695 |
| convert | openai-agents | 32 | 30/30 | 50.0 | 57.0 | 13307 | 82.984 |
| convert | openai-agents | 64 | 30/30 | 51.5 | 60.0 | 26235 | 83.975 |
| convert | openai-agents | 100 | 30/30 | 54.0 | 59.0 | 40779 | 85.164 |
| convert | openai-agents | 128 | 30/30 | 56.0 | 65.0 | 52175 | 87.812 |
| convert | openai-agents | 256 | 30/30 | 64.5 | 74.0 | 104271 | 95.939 |
| convert | pydantic-ai | 1 | 30/30 | 47.5 | 52.0 | 796 | 79.5 |
| convert | pydantic-ai | 2 | 30/30 | 48.0 | 61.0 | 1135 | 79.844 |
| convert | pydantic-ai | 4 | 30/30 | 48.0 | 54.0 | 1813 | 80.512 |
| convert | pydantic-ai | 8 | 30/30 | 47.5 | 52.0 | 3169 | 81.176 |
| convert | pydantic-ai | 16 | 30/30 | 49.0 | 55.0 | 5899 | 81.781 |
| convert | pydantic-ai | 32 | 30/30 | 51.0 | 58.0 | 11371 | 83.242 |
| convert | pydantic-ai | 64 | 30/30 | 54.0 | 60.0 | 22315 | 84.033 |
| convert | pydantic-ai | 100 | 30/30 | 56.0 | 60.0 | 34627 | 86.158 |
| convert | pydantic-ai | 128 | 30/30 | 59.5 | 64.0 | 44287 | 87.652 |
| convert | pydantic-ai | 256 | 30/30 | 66.5 | 74.0 | 88447 | 96.244 |
| convert | semantic-kernel | 1 | 30/30 | 48.0 | 55.0 | 1348 | 79.672 |
| convert | semantic-kernel | 2 | 30/30 | 46.0 | 52.0 | 1939 | 80.016 |
| convert | semantic-kernel | 4 | 30/30 | 47.0 | 54.0 | 3121 | 80.703 |
| convert | semantic-kernel | 8 | 30/30 | 48.0 | 56.0 | 5485 | 81.094 |
| convert | semantic-kernel | 16 | 30/30 | 51.0 | 57.0 | 10237 | 82.125 |
| convert | semantic-kernel | 32 | 30/30 | 51.0 | 58.0 | 19757 | 83.414 |
| convert | semantic-kernel | 64 | 30/30 | 54.0 | 60.0 | 38797 | 85.057 |
| convert | semantic-kernel | 100 | 30/30 | 57.0 | 62.0 | 60217 | 85.775 |
| convert | semantic-kernel | 128 | 30/30 | 58.5 | 67.0 | 76989 | 87.535 |
| convert | semantic-kernel | 256 | 30/30 | 67.0 | 75.0 | 153661 | 97.719 |
| convert | strands | 1 | 30/30 | 48.0 | 53.0 | 2318 | 79.5 |
| convert | strands | 2 | 30/30 | 47.5 | 56.0 | 2795 | 80.016 |
| convert | strands | 4 | 30/30 | 46.0 | 54.0 | 3749 | 80.855 |
| convert | strands | 8 | 30/30 | 46.5 | 53.0 | 5657 | 80.922 |
| convert | strands | 16 | 30/30 | 50.0 | 57.0 | 9491 | 81.781 |
| convert | strands | 32 | 30/30 | 51.0 | 57.0 | 17171 | 83.328 |
| convert | strands | 64 | 30/30 | 54.5 | 60.0 | 32531 | 84.4 |
| convert | strands | 100 | 30/30 | 57.0 | 66.0 | 49811 | 87.297 |
| convert | strands | 128 | 30/30 | 57.5 | 66.0 | 63335 | 89.584 |
| convert | strands | 256 | 30/30 | 67.5 | 78.0 | 125159 | 95.99 |
| validate | — | 1 | 30/30 | 0.681 | 0.924 | — | 36.188 |
| validate | — | 2 | 30/30 | 1.102 | 1.65 | — | 36.703 |
| validate | — | 4 | 30/30 | 1.919 | 2.342 | — | 37.523 |
| validate | — | 8 | 30/30 | 3.342 | 5.592 | — | 37.523 |
| validate | — | 16 | 30/30 | 5.466 | 7.239 | — | 38.039 |
| validate | — | 32 | 30/30 | 11.45 | 16.495 | — | 39.586 |
| validate | — | 64 | 30/30 | 21.377 | 27.594 | — | 39.896 |
| validate | — | 100 | 30/30 | 34.214 | 41.04 | — | 41.727 |
| validate | — | 128 | 30/30 | 41.668 | 54.887 | — | 43.57 |
| validate | — | 256 | 30/30 | 82.6 | 97.283 | — | 48.141 |

See `raw.json` and the CSV files for complete observations and failures.
