from __future__ import annotations

import json
import os
import random
import subprocess
import sys
import tempfile
import textwrap
import time
import uuid
from pathlib import Path
from typing import Any, Dict

import yaml
import mysql.connector
from dotenv import load_dotenv

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from flamapy.interfaces.python import FLAMAFeatureModel

# import mlflow
#
# mlflow.set_tracking_uri("http://localhost:5000")
# mlflow.set_experiment("Gear-Controlled-Experiment")

BASE_DIR = Path(__file__).resolve().parent
UI_DIR = BASE_DIR / "ui"

load_dotenv()

CONFIG = {}
config_path = BASE_DIR / "config.yml"
try:
    with open(config_path, "r", encoding="utf-8") as f:
        CONFIG = yaml.safe_load(f)
except Exception as e:
    sys.exit(1)

HOST = CONFIG['server']['host']
PORT = int(os.environ.get("PORT", CONFIG['server']['port']))

DB_HOST = CONFIG['database']['host']
DB_PORT = CONFIG['database']['port']
DB_USER = CONFIG['database']['user']
DB_NAME = CONFIG['database']['dbname']
DB_PASS = os.environ.get("DB_PASSWORD")

TASKS_FILE_PATH = BASE_DIR / CONFIG['paths']['tasks_file']

app = Flask(__name__, static_folder=str(UI_DIR), static_url_path="/ui")
CORS(app)

TASKS_CONFIG = {}
try:
    with open(TASKS_FILE_PATH, "r", encoding="utf-8") as f:
        TASKS_CONFIG = json.load(f)
except Exception:
    pass


def get_db_connection():
    if not DB_PASS:
        raise ValueError("DB_PASSWORD missing")

    conn = mysql.connector.connect(
        host=DB_HOST,
        port=DB_PORT,
        user=DB_USER,
        password=DB_PASS,
        database=DB_NAME
    )
    print(conn)
    return conn


def init_db():
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        cur.execute("""
                    CREATE TABLE IF NOT EXISTS users
                    (
                        user_id
                        VARCHAR
                    (
                        255
                    ) PRIMARY KEY,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        group_order TEXT,
                        current_task_index INT DEFAULT 0
                        )
                    """)

        cur.execute("""
                    CREATE TABLE IF NOT EXISTS task_logs
                    (
                        id
                        INT
                        AUTO_INCREMENT
                        PRIMARY
                        KEY,
                        user_id
                        VARCHAR
                    (
                        255
                    ),
                        task_id VARCHAR
                    (
                        255
                    ),
                        mode VARCHAR
                    (
                        50
                    ),
                        start_time DOUBLE,
                        end_time DOUBLE,
                        duration DOUBLE,
                        completed BOOLEAN DEFAULT FALSE,
                        FOREIGN KEY
                    (
                        user_id
                    ) REFERENCES users
                    (
                        user_id
                    )
                        )
                    """)

        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        print(f"DB Error: {e}")


init_db()


@app.get("/api/experiment/task_info/<task_id>")
def get_task_info(task_id):
    task = TASKS_CONFIG.get(task_id)
    if not task:
        return jsonify({"error": "Task unknown"}), 404
    return jsonify(task)


@app.post("/api/experiment/validate_task")
def validate_task():
    return jsonify({"valid": True, "message": "Valid configuration."})


@app.post("/api/experiment/start")
def start_experiment():
    user_id = str(uuid.uuid4())

    group_a = CONFIG['experiment']['group_a']
    group_b = CONFIG['experiment']['group_b']

    groups = [group_a, group_b]
    random.shuffle(groups)

    modes = ["GEAR", "MANUAL"]
    random.shuffle(modes)

    experiment_sequence = []

    for task_id in groups[0]:
        experiment_sequence.append({"id": task_id, "mode": modes[0]})
    for task_id in groups[1]:
        experiment_sequence.append({"id": task_id, "mode": modes[1]})

    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO users (user_id, group_order, current_task_index) VALUES (%s, %s, %s)",
            (user_id, json.dumps(experiment_sequence), 0)
        )
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    return jsonify({
        "user_id": user_id,
        "sequence": experiment_sequence,
        "first_task": experiment_sequence[0],
        "total_tasks": len(experiment_sequence)
    })


@app.post("/api/experiment/log_start")
def log_task_start():
    data = request.json
    user_id = data.get("user_id")
    task_id = data.get("task_id")
    mode = data.get("mode")
    start_time = time.time()

    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO task_logs (user_id, task_id, mode, start_time, completed) VALUES (%s, %s, %s, %s, %s)",
            (user_id, task_id, mode, start_time, False)
        )
        log_id = cur.lastrowid
        conn.commit()
        cur.close()
        conn.close()
        #
        # # ---------------- MLflow ----------------
        # mlflow.start_run(run_name=f"{user_id}_{task_id}")
        # mlflow.set_tag("user_id", user_id)
        # mlflow.set_tag("task_id", task_id)
        # mlflow.set_tag("mode", mode)
        # mlflow.log_metric("start_time", start_time)
        #
        # return jsonify({"log_id": log_id, "start_time": start_time})

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.post("/api/experiment/log_end")
def log_task_end():
    data = request.json
    log_id = data.get("log_id")
    end_time = time.time()

    try:
        conn = get_db_connection()
        cur = conn.cursor()

        cur.execute("SELECT start_time FROM task_logs WHERE id = %s", (log_id,))
        result = cur.fetchone()

        if result:
            start_time = result[0]
            duration = end_time - start_time

            cur.execute(
                "UPDATE task_logs SET end_time = %s, duration = %s, completed = %s WHERE id = %s",
                (end_time, duration, True, log_id)
            )
            conn.commit()
            cur.close()
            conn.close()
            #
            # # ---------------- MLflow ----------------
            # mlflow.log_metric("end_time", end_time)
            # mlflow.log_metric("duration", duration)
            # mlflow.end_run()

            return jsonify({"success": True, "duration": duration})
        else:
            cur.close()
            conn.close()
            return jsonify({"error": "Log ID not found"}), 404

    except Exception as e:
        return jsonify({"error": str(e)}), 500



@app.get("/experiment")
def experiment_ui() -> Any:
    return send_from_directory(UI_DIR, "experiment.html")


@app.get("/manual")
def manual_ui() -> Any:
    return send_from_directory(UI_DIR, "manual.html")


def _load_dotenv() -> None:
    # Merge .env files into the process environment.
    if load_dotenv:
        load_dotenv()
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

    print("OPENAI_API_KEY present:", bool(os.environ.get("OPENAI_API_KEY")))


@app.get("/")
def index() -> Any:
    return send_from_directory(UI_DIR, "index.html")


@app.get("/ui/")
def index_ui() -> Any:
    return send_from_directory(UI_DIR, "index.html")


@app.get("/ui/<path:filename>")
def ui_files(filename: str) -> Any:
    return send_from_directory(UI_DIR, filename)


@app.get("/<path:filename>")
def project_files(filename: str) -> Any:
    if (UI_DIR / filename).exists():
        return send_from_directory(UI_DIR, filename)
    return send_from_directory(BASE_DIR, filename)


def _ensure_kickoff(code: str, inputs: Dict[str, Any]) -> str:
    if "kickoff(" in code:
        return code
    wrapper = textwrap.dedent(
        f"""
        if "crew" in globals():
            result = crew.kickoff()
            print(result)
        else:
            raise RuntimeError("No 'crew' variable defined.")
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
        return jsonify({"error": "Empty code."}), 400
    if not isinstance(inputs, dict):
        return jsonify({"error": "Inputs must be JSON object."}), 400

    code_to_run = code if target == "adk" else _ensure_kickoff(code, inputs)

    env = os.environ.copy()
    env.setdefault("PYTHONUNBUFFERED", "1")

    if not env.get("OPENAI_API_KEY"):
        return jsonify({"error": "OPENAI_API_KEY manquante côté serveur."}), 500

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

    return jsonify({
        "stdout": result.stdout or "",
        "stderr": result.stderr or "",
        "returncode": result.returncode,
    })


@app.route('/api/analyze', methods=['POST'])
def analyze():
    data = request.json
    selected_features = data.get('selected_features', [])
    fm_type = data.get('fm_type')

    tmp_path = ""
    try:
        with tempfile.NamedTemporaryFile(mode='w', suffix='.csv', delete=False) as tmp_file:
            csv_content = ",".join(selected_features)
            tmp_file.write(csv_content)
            tmp_path = tmp_file.name

        fm = FLAMAFeatureModel(f"gear/gear-{fm_type}.uvl")
        response = {
            "valid": fm.satisfiable_configuration(tmp_path),
            "config_count": fm.estimated_number_of_configurations(),
            "message": "Successful analysis"
        }
        return jsonify(response)

    except Exception as e:
        print(f"Error Flamapy: {e}")
        return jsonify({"valid": False, "error": str(e)}), 500
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

def main() -> None:
    app.run(host=HOST, port=PORT, debug=False)


if __name__ == "__main__":
    main()