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
from typing import Any, Optional

import mlflow
import mysql.connector
import yaml
from dotenv import load_dotenv
from flamapy.interfaces.python import FLAMAFeatureModel
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from markdown import markdown

BASE_DIR = Path(__file__).resolve().parent
UI_DIR = BASE_DIR / "ui"

load_dotenv()

CONFIG = {}
config_path = BASE_DIR / "config.yml"
try:
    with open(config_path, "r", encoding="utf-8") as f:
        CONFIG = yaml.safe_load(f)
except Exception:
    sys.exit(1)

HOST = CONFIG["server"]["host"]
PORT = int(os.environ.get("PORT", CONFIG["server"]["port"]))

DB_HOST = CONFIG["database"]["host"]
DB_PORT = CONFIG["database"]["port"]
DB_USER = CONFIG["database"]["user"]
DB_NAME = CONFIG["database"]["dbname"]
DB_PASS = os.environ.get("DB_PASSWORD")

TASKS_FILE_PATH = BASE_DIR / CONFIG["paths"]["tasks_file"]

app = Flask(__name__, static_folder=str(UI_DIR), static_url_path="/ui")
CORS(app)


def get_db_connection():
    if not DB_PASS:
        raise ValueError("DB_PASSWORD missing")
    return mysql.connector.connect(
        host=DB_HOST,
        port=DB_PORT,
        user=DB_USER,
        password=DB_PASS,
        database=DB_NAME,
    )


def init_db():
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                user_id VARCHAR(255) PRIMARY KEY,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                group_order TEXT,
                current_task_index INT DEFAULT 0
            )
            """
        )

        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS task_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id VARCHAR(255),
                task_id VARCHAR(255),
                mode VARCHAR(50),
                start_time DOUBLE,
                end_time DOUBLE,
                duration DOUBLE,
                completed BOOLEAN DEFAULT FALSE,
                FOREIGN KEY (user_id) REFERENCES users(user_id)
            )
            """
        )

        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS task_runs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                log_id INT NOT NULL,
                trace_id VARCHAR(64) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                trace_json LONGTEXT NULL,
                FOREIGN KEY (log_id) REFERENCES task_logs(id)
            )
            """
        )

        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        print(f"DB Error: {e}")


init_db()

TASKS_CONFIG = {}
try:
    with open(TASKS_FILE_PATH, "r", encoding="utf-8") as f:
        TASKS_CONFIG = json.load(f)
except Exception:
    pass


def _read_md_as_html(md_path: str) -> str:
    if not md_path:
        return ""
    abs_path = md_path if os.path.isabs(md_path) else os.path.join(BASE_DIR, md_path)
    try:
        with open(abs_path, "r", encoding="utf-8") as f:
            md_text = f.read()
    except Exception:
        return ""
    return markdown(md_text, extensions=["fenced_code", "tables", "toc"])


def get_instrumentation_prefix(framework):
    framework = (framework or "").strip().lower()
    tracking_uri = os.environ.get("MLFLOW_TRACKING_URI", "http://localhost:5000").rstrip("/")

    if framework == "crewai":
        return f"""
import os, sys, json, atexit
import mlflow

mlflow.set_tracking_uri(os.environ.get("MLFLOW_TRACKING_URI", "{tracking_uri}"))
mlflow.set_experiment("CrewAI")

try:
    mlflow.crewai.autolog()
except Exception:
    pass

def _emit_trace_id():
    tid = None
    try:
        tid = mlflow.get_last_active_trace_id(thread_local=False)
    except Exception:
        tid = None
    if tid:
        sys.stderr.write("\\n__GEAR_TRACE_START__\\n" + json.dumps({{"trace_id": tid}}) + "\\n__GEAR_TRACE_END__\\n")

atexit.register(_emit_trace_id)
""".lstrip()

    if framework in ("adk", "googleadk", "google-adk"):
        return f"""
import os, sys, json, atexit
import mlflow
from opentelemetry import trace, context
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

mlflow.set_tracking_uri(os.environ.get("MLFLOW_TRACKING_URI", "{tracking_uri}"))
exp = mlflow.set_experiment("GoogleADK")
exp_id = exp.experiment_id

_otlp_endpoint = os.environ.get("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "{tracking_uri}/v1/traces")

_headers_env = os.environ.get("OTEL_EXPORTER_OTLP_HEADERS", "")
_headers = {{"x-mlflow-experiment-id": str(exp_id)}}
if _headers_env:
    for _item in _headers_env.split(","):
        _item = _item.strip()
        if not _item:
            continue
        if "=" in _item:
            k, v = _item.split("=", 1)
        elif ":" in _item:
            k, v = _item.split(":", 1)
        else:
            continue
        _headers[k.strip()] = v.strip()

provider = TracerProvider()
exporter = OTLPSpanExporter(endpoint=_otlp_endpoint, headers=_headers)
provider.add_span_processor(BatchSpanProcessor(exporter))
trace.set_tracer_provider(provider)

_tracer = trace.get_tracer("gear.google_adk")
_root_span = _tracer.start_span("gear_adk_run")
_token = context.attach(trace.set_span_in_context(_root_span))
_trace_id_hex = format(_root_span.get_span_context().trace_id, "032x")
_trace_id = "tr-" + _trace_id_hex
def _emit_trace_id_and_close():
    try:
        sys.stderr.write("\\n__GEAR_TRACE_START__\\n" + json.dumps({{"trace_id": _trace_id}}) + "\\n__GEAR_TRACE_END__\\n")
    except Exception:
        pass
    try:
        context.detach(_token)
    except Exception:
        pass
    try:
        _root_span.end()
    except Exception:
        pass

atexit.register(_emit_trace_id_and_close)
""".lstrip()

    return ""

def _prepend_google_adk_imports(code: str) -> str:
    required = "from google.adk.models.lite_llm import LiteLlm"
    if required in code:
        return code
    return required + "\n" + code


@app.get("/api/experiment/task_info/<task_id>")
def get_task_info(task_id):
    task = TASKS_CONFIG.get(task_id)
    if not task:
        return jsonify({"error": "Task unknown"}), 404
    task_out = dict(task)
    md_path = task_out.get("description", "")
    task_out["description"] = _read_md_as_html(md_path)
    task_out["description_path"] = md_path
    return jsonify(task_out)


@app.post("/api/experiment/validate_task")
def validate_task():
    return jsonify({"valid": True, "message": "Valid configuration."})


TASK_IDS = [f"T{i}" for i in range(6)]


@app.post("/api/experiment/start")
def start_experiment():
    user_id = str(uuid.uuid4())

    experiment_sequence = []
    for tid in TASK_IDS:
        modes = ["GEAR", "MANUAL"]
        random.shuffle(modes)
        for m in modes:
            experiment_sequence.append({"id": tid, "mode": m})

    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO users (user_id, group_order, current_task_index) VALUES (%s, %s, %s)",
            (user_id, json.dumps(experiment_sequence), 0),
        )
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    return jsonify(
        {
            "user_id": user_id,
            "sequence": experiment_sequence,
            "first_task": experiment_sequence[0],
            "total_tasks": len(experiment_sequence),
        }
    )


@app.post("/api/experiment/log_start")
def log_task_start():
    data = request.json or {}
    user_id = data.get("user_id")
    task_id = data.get("task_id")
    mode = data.get("mode")
    start_time = time.time()

    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO task_logs (user_id, task_id, mode, start_time, completed) VALUES (%s, %s, %s, %s, %s)",
            (user_id, task_id, mode, start_time, False),
        )
        log_id = cur.lastrowid
        conn.commit()
        cur.close()
        conn.close()
        return jsonify({"log_id": log_id, "start_time": start_time})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def _ensure_kickoff(code: str) -> str:
    if "kickoff(" in code:
        return code
    wrapper = textwrap.dedent(
        """
        if "crew" in globals():
            result = crew.kickoff()
            print(result)
        else:
            raise RuntimeError("No 'crew' variable defined.")
        """
    ).strip("\n")
    return f"{code}\n{wrapper}\n"


def _parse_trace_id(stderr: str) -> Optional[str]:
    if "__GEAR_TRACE_START__" not in stderr:
        return None
    try:
        json_part = stderr.split("__GEAR_TRACE_START__")[1]
        json_part = json_part.split("__GEAR_TRACE_END__")[0].strip()
        return (json.loads(json_part) or {}).get("trace_id")
    except Exception:
        return None


@app.post("/api/run")
def run_orchestration():
    payload = request.get_json(silent=True) or {}
    code = payload.get("code", "")
    target = payload.get("target", "crewai")
    log_id = payload.get("log_id")

    if not code.strip():
        return jsonify({"error": "Empty code"}), 400
    if not log_id:
        return jsonify({"error": "log_id missing"}), 400

    if target in ("adk", "googleadk", "google-adk"):
        code = _prepend_google_adk_imports(code)

    code_to_run = code if target == "adk" else _ensure_kickoff(code)
    prefix = get_instrumentation_prefix(target)
    final_code = prefix + "\n" + code_to_run

    env = os.environ.copy()
    env.setdefault("PYTHONUNBUFFERED", "1")

    if not env.get("OPENAI_API_KEY"):
        return jsonify({"error": "OPENAI_API_KEY manquante côté serveur."}), 500

    with tempfile.TemporaryDirectory() as temp_dir:
        script_path = Path(temp_dir) / "orchestration.py"
        script_path.write_text(final_code, encoding="utf-8")

        result = subprocess.run(
            [sys.executable, str(script_path)],
            capture_output=True,
            text=True,
            env=env,
            cwd=str(BASE_DIR),
            timeout=180,
        )

    stdout = result.stdout or ""
    stderr = result.stderr or ""

    trace_id = _parse_trace_id(stderr)
    if not trace_id:
        return jsonify({"error": "trace_id missing", "stdout": stdout, "stderr": stderr}), 500

    tracking_uri = os.environ.get("MLFLOW_TRACKING_URI", "http://localhost:5000")
    mlflow.set_tracking_uri(tracking_uri)

    trace_json = None
    last_err = None
    for _ in range(5):
        try:
            trace = mlflow.get_trace(trace_id)
            trace_json = trace.to_json()
            break
        except Exception as e:
            last_err = e
            time.sleep(0.2)

    if not trace_json:
        return jsonify({"error": f"get_trace failed: {last_err}", "stdout": stdout, "stderr": stderr, "trace_id": trace_id}), 500

    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO task_runs (log_id, trace_id, trace_json)
            VALUES (%s, %s, %s)
            """,
            (log_id, trace_id, trace_json),
        )
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        return jsonify({"error": str(e), "stdout": stdout, "stderr": stderr, "trace_id": trace_id}), 500

    return jsonify({"stdout": stdout, "stderr": stderr, "trace_id": trace_id})


@app.post("/api/experiment/log_end")
def log_task_end():
    try:
        data = request.json or {}
        log_id = data.get("log_id")
        end_time = time.time()

        conn = get_db_connection()
        cur = conn.cursor()

        cur.execute("SELECT start_time FROM task_logs WHERE id=%s", (log_id,))
        row = cur.fetchone()
        if not row:
            cur.close()
            conn.close()
            return jsonify({"error": "Log ID not found"}), 404

        start_time = float(row[0]) if row[0] is not None else end_time
        duration = end_time - start_time

        cur.execute(
            """
            UPDATE task_logs
            SET end_time=%s,
                duration=%s,
                completed=%s
            WHERE id=%s
            """,
            (end_time, duration, True, log_id),
        )

        conn.commit()
        cur.close()
        conn.close()
        return jsonify({"success": True, "duration": duration})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.get("/experiment")
def experiment_ui() -> Any:
    return send_from_directory(UI_DIR, "experiment.html")


@app.get("/manual")
def manual_ui() -> Any:
    return send_from_directory(UI_DIR, "manual.html")


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


@app.route("/api/analyze", methods=["POST"])
def analyze():
    data = request.json or {}
    selected_features = data.get("selected_features", [])
    print(selected_features)
    fm_type = data.get("fm_type")

    tmp_path = ""
    try:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False) as tmp_file:
            csv_content = ",".join(selected_features)
            tmp_file.write(csv_content)
            tmp_path = tmp_file.name

        fm = FLAMAFeatureModel(f"gear/gear-{fm_type}.uvl")
        response = {"valid": fm.satisfiable_configuration(tmp_path,full_configuration=True), "config_count": fm.configurations_number(), "message": "Successful analysis"}
        return jsonify(response)
    except Exception as e:
        return jsonify({"valid": False, "error": str(e)}), 500
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def main() -> None:
    app.run(host=HOST, port=PORT, debug=False)


if __name__ == "__main__":
    main()
