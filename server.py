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

import mysql.connector
import yaml
from dotenv import load_dotenv
from flamapy.interfaces.python import FLAMAFeatureModel
from flask import Flask, jsonify, redirect, request, send_from_directory
from flask_cors import CORS
from markdown import markdown

BASE_DIR = Path(__file__).resolve().parent
UI_DIR = BASE_DIR / "ui"
FEATURE_MODEL_IMAGE_DIR = UI_DIR / "assets" / "feature-models"
FEATURE_MODEL_IMAGES = {
    "agent": {
        "source": "gear/gear-agent.uvl",
        "image": "agent.png",
    },
    "module": {
        "source": "gear/gear-module.uvl",
        "image": "module.png",
    },
    "workflow": {
        "source": "gear/gear-multiagent.uvl",
        "image": "workflow.png",
    },
    "multiagent": {
        "source": "gear/gear-multiagent.uvl",
        "image": "workflow.png",
    },
}
FEATURE_MODEL_FILES = {
    "agent": BASE_DIR / "gear" / "gear-agent.uvl",
    "module": BASE_DIR / "gear" / "gear-module.uvl",
    "workflow": BASE_DIR / "gear" / "gear-multiagent.uvl",
    "multiagent": BASE_DIR / "gear" / "gear-multiagent.uvl",
}

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
TRACKING_ENABLED = False

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


def _feature_model_path(fm_type: str) -> Path:
    model_path = FEATURE_MODEL_FILES.get(fm_type)
    if model_path is None:
        raise ValueError("Unknown feature model type.")
    return model_path


def _validate_feature_names(fm_type: str, selected_features: list[str]) -> None:
    model_path = _feature_model_path(fm_type)
    base_fm = FLAMAFeatureModel(str(model_path))
    known_features = {feature.name for feature in base_fm.fm_model.get_features()}
    unknown_features = sorted(set(selected_features) - known_features)
    if unknown_features:
        raise ValueError(f"Unknown features: {', '.join(unknown_features)}")


def _constrained_feature_model_path(fm_type: str, selected_features: list[str]) -> str:
    model_path = _feature_model_path(fm_type)
    model_text = model_path.read_text(encoding="utf-8").rstrip() + "\n"
    if selected_features:
        if "\nconstraints" not in model_text:
            model_text += "\nconstraints\n"
        for feature_name in selected_features:
            model_text += f"\t{feature_name}\n"

    tmp_file = tempfile.NamedTemporaryFile(mode="w", suffix=".uvl", delete=False, encoding="utf-8")
    with tmp_file:
        tmp_file.write(model_text)
    return tmp_file.name


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


if TRACKING_ENABLED:
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



TASK_IDS = [f"T{i}" for i in range(1, 5)]


@app.post("/api/experiment/start")
def start_experiment():
    user_id = str(uuid.uuid4())

    chosen_mode = random.choice(["GEAR", "MANUAL"])

    experiment_sequence = [{"id": tid, "mode": chosen_mode} for tid in TASK_IDS]

    if TRACKING_ENABLED:
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
            "mode": chosen_mode,
            "sequence": experiment_sequence,
            "first_task": experiment_sequence[0],
            "total_tasks": len(experiment_sequence),
            "tracking": TRACKING_ENABLED,
        }
    )


@app.post("/api/experiment/log_start")
def log_task_start():
    if not TRACKING_ENABLED:
        return jsonify({"log_id": None, "tracking": False})

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

def _strip_gear_trace_markers(stderr: str) -> str:
    if not stderr:
        return ""
    start = stderr.find("__GEAR_TRACE_START__")
    if start == -1:
        return stderr
    end = stderr.find("__GEAR_TRACE_END__", start)
    if end == -1:
        return (stderr[:start]).rstrip()
    end += len("__GEAR_TRACE_END__")
    cleaned = (stderr[:start] + stderr[end:]).strip()
    return cleaned


@app.post("/api/run")
def run_orchestration():
    payload = request.get_json(silent=True) or {}
    code = payload.get("code", "")
    target = payload.get("target", "crewai")
    log_id = payload.get("log_id")

    if not code.strip():
        return jsonify({"error": "Empty code"}), 400

    if target in ("adk", "googleadk", "google-adk"):
        code = _prepend_google_adk_imports(code)

    code_to_run = code if target == "adk" else _ensure_kickoff(code)
    final_code = code_to_run

    env = os.environ.copy()
    env.setdefault("PYTHONUNBUFFERED", "1")

    if not env.get("OPENAI_API_KEY"):
        return jsonify({"error": "OPENAI_API_KEY is missing on the server."}), 500

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

    return jsonify({"stdout": stdout, "stderr": stderr, "returncode": result.returncode})

@app.post("/api/experiment/log_end")
def log_task_end():
    if not TRACKING_ENABLED:
        return jsonify({"success": True, "tracking": False})

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


@app.get("/ui")
@app.get("/ui/")
def index_ui() -> Any:
    return redirect("/")


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
    fm_type = data.get("fm_type")

    constrained_tmp_path = ""
    try:
        model_path = _feature_model_path(fm_type)
        _validate_feature_names(fm_type, selected_features)
        fm = FLAMAFeatureModel(str(model_path))
        constrained_tmp_path = _constrained_feature_model_path(fm_type, selected_features)
        constrained_fm = FLAMAFeatureModel(constrained_tmp_path)
        response = {
            "valid": constrained_fm.satisfiable(),
            "config_count": fm.configurations_number(),
            "message": "Successful analysis",
        }
        return jsonify(response)
    except Exception as e:
        return jsonify({"valid": False, "error": str(e)}), 500
    finally:
        if os.path.exists(constrained_tmp_path):
            os.remove(constrained_tmp_path)

@app.post("/api/feature-model")
def feature_model() -> Any:
    payload = request.get_json(silent=True) or {}
    fm_type = payload.get("fm_type", "agent")
    model_image = FEATURE_MODEL_IMAGES.get(fm_type)
    if model_image is None:
        return jsonify({"error": "Unknown feature model type."}), 400

    image_path = FEATURE_MODEL_IMAGE_DIR / model_image["image"]
    if not image_path.exists():
        return jsonify({"error": f"Missing FeatureIDE image: {image_path.relative_to(BASE_DIR)}"}), 500

    image_url = f"/ui/assets/feature-models/{model_image['image']}?v={image_path.stat().st_mtime_ns}"
    return jsonify(
        {
            "fm_type": fm_type,
            "source": model_image["source"],
            "renderer": "featureide-pregenerated-png",
            "image": image_url,
        }
    )


def main() -> None:
    app.run(host=HOST, port=PORT, debug=False)


if __name__ == "__main__":
    main()
