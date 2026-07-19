
from crewai import Agent, Crew, Task, Process, LLM
import os
import sys
from dotenv import load_dotenv

load_dotenv()

try:
    import tempfile as _tempfile
    import mlflow as _mlflow

    tracking_uri = os.getenv("MLFLOW_TRACKING_URI", "http://localhost:5000")
    _mlflow.set_tracking_uri(tracking_uri)
    experiment_name = os.getenv("MLFLOW_EXPERIMENT_NAME", "gear-framework-crewai")
    _mlflow.set_experiment(experiment_name)
    run_name = os.getenv("MLFLOW_RUN_NAME", "test-crewai")
    with _mlflow.start_run(run_name=run_name):
        _mlflow.set_tag("framework", "crewai")
        result_text = str(result)
        _mlflow.log_metric("output_chars", len(result_text))
        if hasattr(_mlflow, "log_text"):
            _mlflow.log_text(result_text, "crewai_output.txt")
        else:
            with _tempfile.TemporaryDirectory() as _tmp:
                _path = os.path.join(_tmp, "crewai_output.txt")
                with open(_path, "w", encoding="utf-8") as _f:
                    _f.write(result_text)
                _mlflow.log_artifact(_path)
except Exception:
    pass


systemdescriberagent_llm = LLM(
  provider="openai",
  model="openai/gpt-4o-mini",
)

actionlistsolveragent_llm = LLM(
  provider="openai",
  model="openai/gpt-4o-mini",
)

systemdescriberagent = Agent(
  role="SystemDescriberAgent",
  goal="describe the problem to solve clearly and understandably.",
  backstory="describes the AgentGridPlanning problem by defining the reference grid, the allowed actions, and the execution rules in order to provide an exploitable specification. The problem description includes the JSON description, the grid view, and the action definitions below.\n  Problem description JSON:\n\n```json\n{\n  \"grid\": [\"S..#...\", \"##.#.#.\", \"..K..D.\", \".####.#\", \"......G\"],\n  \"elements\": [[\"S\", 0, 0], [\".\", 0, 1], [\".\", 0, 2], [\"#\", 0, 3], [\".\", 0, 4], [\".\", 0, 5], [\".\", 0, 6], [\"#\", 1, 0], [\"#\", 1, 1], [\".\", 1, 2], [\"#\", 1, 3], [\".\", 1, 4], [\"#\", 1, 5], [\".\", 1, 6], [\".\", 2, 0], [\".\", 2, 1], [\"K\", 2, 2], [\".\", 2, 3], [\".\", 2, 4], [\"D\", 2, 5], [\".\", 2, 6], [\".\", 3, 0], [\"#\", 3, 1], [\"#\", 3, 2], [\"#\", 3, 3], [\"#\", 3, 4], [\".\", 3, 5], [\"#\", 3, 6], [\".\", 4, 0], [\".\", 4, 1], [\".\", 4, 2], [\".\", 4, 3], [\".\", 4, 4], [\".\", 4, 5], [\"G\", 4, 6]],\n  \"actions_allowed\": [\"U\", \"D\", \"L\", \"R\", \"TAKE_K\", \"OPEN_D\"]\n}\n```\n  text_grid_view:\n\n```text\nS . . # . . .\n# # . # . # .\n. . K . . D .\n. # # # # . #\n. . . . . . G\n```\n  action_definitions: `U` moves one cell up; `D` moves one cell down; `L` moves one cell left; `R` moves one cell right; `TAKE_K` is valid only if the avatar is on cell `K`; `OPEN_D` is valid only if the key has been taken and the avatar is adjacent to `D`.\n  movement_constraints: a move is invalid if the target cell is outside the grid; a move is invalid if the target cell is a wall `#`; a move to the door `D` is invalid until the action `OPEN_D` has been executed.\n  victory_condition: reach `G` without entering `D` (the key is optional).\n  grid_symbols: `S` start; `G` goal; `K` key; `D` door; `#` wall; `.` free cell.\n  matrix_size: 5 x 7 (rows x columns).\n  coordinate_system: (row, column) indexed from 0.\n  element_coordinates: defined in the JSON `elements` field (list of tuples [symbol, row, column]).",
  llm=systemdescriberagent_llm,
)

actionlistsolveragent = Agent(
  role="ActionListSolverAgent",
  goal="produce the lists of valid and winning action sequences.",
  backstory="computes all final action sequences.",
  llm=actionlistsolveragent_llm,
)

systemdescribertask = Task(
  description="describe the reference grid and its elements (`S`, `G`, `K`, `D`, `#`, `.`), describe the preconditions of `TAKE_K` and `OPEN_D`, and specify the invalid movement conditions.",
  expected_output="The expected output is a JSON list of valid paths following the template below. Remove escape characters.",
  agent=systemdescriberagent,
  name="SystemDescriberTask",
)

actionlistsolvertask = Task(
  description="build action sequences from the grid, verify the legality of each action and the final victory state (paths from `S` to `G`), then produce the final output. Entering `D` is forbidden. `TAKE_K` is optional. Paths must be distinct and must not revisit any cell during movement.",
  expected_output="The expected output is JSON containing all valid paths from `S` to `G`. To present the output, you may use the template below. Make sure to remove escape characters.  ```json {   \"path 1\": \"[\"R\", \"R\", \"D\", \"D\", \"L\", \"L\", \"D\", \"D\", \"R\", \"R\", \"R\", \"R\", \"R\", \"R\"]\",   \"path 2\": \"[\"R\", \"R\", \"D\", \"D\", \"TAKE_K\", \"L\", \"L\", \"D\", \"D\", \"R\", \"R\", \"R\", \"R\", \"R\", \"R\"]\" }",
  agent=actionlistsolveragent,
  name="ActionListSolverTask",
)

crew = Crew(
  agents=[systemdescriberagent, actionlistsolveragent],
  tasks=[systemdescribertask, actionlistsolvertask],
  process=Process.sequential,
)


result = crew.kickoff()

print("result:", result)
