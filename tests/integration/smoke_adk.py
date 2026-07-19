import asyncio
from google.adk.agents import Agent, SequentialAgent, ParallelAgent, LoopAgent
from google.adk.models.lite_llm import LiteLlm
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from dotenv import load_dotenv

load_dotenv()


systemdescriberagent = Agent(
  name="SystemDescriberAgent",
  model=LiteLlm(model="openai/responses/gpt-5.1-codex-mini"),
  description="describe the problem to solve clearly and understandably.\ndescribes the AgentGridPlanning problem by defining the reference grid, the allowed actions, and the execution rules in order to provide an exploitable specification. The problem description includes the JSON description, the grid view, and the action definitions below.\n  Problem description JSON:\n\n```json\n{\n  \"grid\": [\"S..#...\", \"##.#.#.\", \"..K..D.\", \".####.#\", \"......G\"],\n  \"elements\": [[\"S\", 0, 0], [\".\", 0, 1], [\".\", 0, 2], [\"#\", 0, 3], [\".\", 0, 4], [\".\", 0, 5], [\".\", 0, 6], [\"#\", 1, 0], [\"#\", 1, 1], [\".\", 1, 2], [\"#\", 1, 3], [\".\", 1, 4], [\"#\", 1, 5], [\".\", 1, 6], [\".\", 2, 0], [\".\", 2, 1], [\"K\", 2, 2], [\".\", 2, 3], [\".\", 2, 4], [\"D\", 2, 5], [\".\", 2, 6], [\".\", 3, 0], [\"#\", 3, 1], [\"#\", 3, 2], [\"#\", 3, 3], [\"#\", 3, 4], [\".\", 3, 5], [\"#\", 3, 6], [\".\", 4, 0], [\".\", 4, 1], [\".\", 4, 2], [\".\", 4, 3], [\".\", 4, 4], [\".\", 4, 5], [\"G\", 4, 6]],\n  \"actions_allowed\": [\"U\", \"D\", \"L\", \"R\", \"TAKE_K\", \"OPEN_D\"]\n}\n```\n  text_grid_view:\n\n```text\nS . . # . . .\n# # . # . # .\n. . K . . D .\n. # # # # . #\n. . . . . . G\n```\n  action_definitions: `U` moves one cell up; `D` moves one cell down; `L` moves one cell left; `R` moves one cell right; `TAKE_K` is valid only if the avatar is on cell `K`; `OPEN_D` is valid only if the key has been taken and the avatar is adjacent to `D`.\n  movement_constraints: a move is invalid if the target cell is outside the grid; a move is invalid if the target cell is a wall `#`; a move to the door `D` is invalid until the action `OPEN_D` has been executed.\n  victory_condition: reach `G` without entering `D` (the key is optional).\n  grid_symbols: `S` start; `G` goal; `K` key; `D` door; `#` wall; `.` free cell.\n  matrix_size: 5 x 7 (rows x columns).\n  coordinate_system: (row, column) indexed from 0.\n  element_coordinates: defined in the JSON `elements` field (list of tuples [symbol, row, column]).",
  instruction="describe the reference grid and its elements (`S`, `G`, `K`, `D`, `#`, `.`), describe the preconditions of `TAKE_K` and `OPEN_D`, and specify the invalid movement conditions.\n\nThe expected output is a JSON list of valid paths following the template below. Remove escape characters.",
  output_key="SystemDescriberTask",
)

actionlistsolveragent = Agent(
  name="ActionListSolverAgent",
  model=LiteLlm(model="openai/responses/gpt-5.1-codex-mini"),
  description="produce the lists of valid and winning action sequences.\ncomputes all final action sequences.",
  instruction="build action sequences from the grid, verify the legality of each action and the final victory state (paths from `S` to `G`), then produce the final output. Entering `D` is forbidden. `TAKE_K` is optional. Paths must be distinct and must not revisit any cell during movement.\n\nThe expected output is JSON containing all valid paths from `S` to `G`. To present the output, you may use the template below. Make sure to remove escape characters.  ```json {   \"path 1\": \"[\"R\", \"R\", \"D\", \"D\", \"L\", \"L\", \"D\", \"D\", \"R\", \"R\", \"R\", \"R\", \"R\", \"R\"]\",   \"path 2\": \"[\"R\", \"R\", \"D\", \"D\", \"TAKE_K\", \"L\", \"L\", \"D\", \"D\", \"R\", \"R\", \"R\", \"R\", \"R\", \"R\"]\" }",
  output_key="ActionListSolverTask",
)



root_agent = SequentialAgent(
  name="RootWorkflow",
  sub_agents=[systemdescriberagent, actionlistsolveragent],
)

runner = Runner(
  agent=root_agent,
  session_service=InMemorySessionService(),
  app_name="gear-framework",
)
async def _run():
    return await runner.run_debug("{}")
result = asyncio.run(_run())

def _extract_action_list_solver(value):
    found = None
    if isinstance(value, list):
        for item in value:
            actions = getattr(item, "actions", None)
            state_delta = getattr(actions, "state_delta", None) if actions else None
            if isinstance(state_delta, dict) and "ActionListSolverTask" in state_delta:
                found = state_delta["ActionListSolverTask"]
    elif isinstance(value, dict):
        state_delta = value.get("state_delta")
        if isinstance(state_delta, dict) and "ActionListSolverTask" in state_delta:
            found = state_delta["ActionListSolverTask"]
    return found


def _stringify_value(value):
    if isinstance(value, str):
        return value
    try:
        import json

        return json.dumps(value, ensure_ascii=False, indent=2)
    except Exception:
        return str(value)


output_path = "result.json"
action_list_solver_value = _extract_action_list_solver(result)
with open(output_path, "w", encoding="utf-8") as f:
    f.write(_stringify_value(action_list_solver_value))

try:
import os as _os
    import mlflow as _mlflow

    tracking_uri = _os.getenv("MLFLOW_TRACKING_URI", "http://localhost:5000")
    _mlflow.set_tracking_uri(tracking_uri)
    experiment_name = _os.getenv("MLFLOW_EXPERIMENT_NAME", "gear-framework-adk")
    _mlflow.set_experiment(experiment_name)
    run_name = _os.getenv("MLFLOW_RUN_NAME", "test-adk")
    with _mlflow.start_run(run_name=run_name):
        _mlflow.set_tag("framework", "adk")
        _mlflow.log_param("app_name", "gear-framework")
        _mlflow.log_param("system_model", "openai/responses/gpt-5.1-codex-mini")
        _mlflow.log_param("action_model", "openai/responses/gpt-5.1-codex-mini")
        output_text = _stringify_value(action_list_solver_value)
        _mlflow.log_metric("output_chars", len(output_text))
        if _os.path.exists(output_path):
            _mlflow.log_artifact(output_path)
except Exception:
    pass
