from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import textwrap
from pathlib import Path
from typing import Any, Dict

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

BASE_DIR = Path(__file__).resolve().parent


def _load_dotenv() -> None:
    candidates = [BASE_DIR / ".env", BASE_DIR.parent / ".env"]
    for path in candidates:
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value

    if os.environ.get("GEMINI_API_KEY") and not os.environ.get("GOOGLE_API_KEY"):
        os.environ["GOOGLE_API_KEY"] = os.environ["GEMINI_API_KEY"]

    if not os.environ.get("OPENAI_API_KEY"):
        for candidate in ("OPENAI_KEY", "OPENAI_TOKEN"):
            if os.environ.get(candidate):
                os.environ["OPENAI_API_KEY"] = os.environ[candidate]
                break

app = Flask(__name__, static_folder=str(BASE_DIR), static_url_path="")
CORS(app)
_load_dotenv()


@app.get("/")
def index() -> Any:
    return send_from_directory(BASE_DIR, "index.html")


@app.get("/<path:filename>")
def static_files(filename: str) -> Any:
    return send_from_directory(BASE_DIR, filename)


def _ensure_kickoff(code: str, inputs: Dict[str, Any]) -> str:
    if "kickoff(" in code:
        return code
    inputs_literal = json.dumps(inputs, ensure_ascii=False)
    wrapper = textwrap.dedent(
        f"""

        if "crew" in globals():
            result = crew.kickoff(inputs={inputs_literal})
            print(result)
        else:
            raise RuntimeError("Aucune variable 'crew' n'a été définie dans l'orchestration.")
        """
    ).strip("\n")
    return f"{code}\n{wrapper}\n"


@app.post("/api/run")
def run_orchestration() -> Any:
    payload = request.get_json(silent=True) or {}
    code = payload.get("code", "")
    inputs = payload.get("inputs", {})
    target = payload.get("target", "crewai")

    if not isinstance(code, str) or not code.strip():
        return jsonify({"error": "Le code orchestration est vide."}), 400
    if not isinstance(inputs, dict):
        return jsonify({"error": "Le champ inputs doit être un objet JSON."}), 400

    code_to_run = code if target == "adk" else _ensure_kickoff(code, inputs)

    env = os.environ.copy()
    env.setdefault("PYTHONUNBUFFERED", "1")

    with tempfile.TemporaryDirectory() as temp_dir:
        script_path = Path(temp_dir) / "orchestration.py"
        script_path.write_text(code_to_run, encoding="utf-8")

        result = subprocess.run(
            [sys.executable, str(script_path)],
            capture_output=True,
            text=True,
            env=env,
            cwd=str(BASE_DIR),
            timeout=180,
        )

    return jsonify(
        {
            "stdout": result.stdout or "",
            "stderr": result.stderr or "",
            "returncode": result.returncode,
        }
    )


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8000, debug=False)
