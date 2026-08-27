from __future__ import annotations

import hashlib
import os
import sys
from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv

SOURCE_ROOT = Path(__file__).resolve().parent.parent
INSTALLED_ROOT = Path(sys.prefix) / "share" / "gear-framework"
BASE_DIR = SOURCE_ROOT if (SOURCE_ROOT / "ui").exists() else INSTALLED_ROOT
UI_DIR = BASE_DIR / "ui"
RUNTIME_PUBLIC_DIR = (
    SOURCE_ROOT / "gear_sdk" / "runtime"
    if (SOURCE_ROOT / "gear_sdk" / "runtime").exists()
    else INSTALLED_ROOT / "runtime"
)


def _studio_revision(ui_dir: Path = UI_DIR) -> str:
    digest = hashlib.sha256()
    for path in sorted(item for item in ui_dir.rglob("*") if item.is_file()):
        digest.update(path.relative_to(ui_dir).as_posix().encode("utf-8"))
        digest.update(path.read_bytes())
    return digest.hexdigest()[:12]

load_dotenv()


def _load_config() -> dict[str, Any]:
    path = BASE_DIR / "config.yml"
    try:
        value = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except (OSError, yaml.YAMLError) as error:
        raise RuntimeError(f"Unable to load GEAR configuration from {path}: {error}") from error
    if not isinstance(value, dict):
        raise RuntimeError(f"GEAR configuration must be a mapping: {path}")
    return value


STUDIO_OPENAI_MODELS = ("gpt-4o-mini", "gpt-5.4-mini", "gpt-4.1-mini")


def _studio_model_policy() -> dict[str, Any]:
    model = os.environ.get("GEAR_STUDIO_MODEL", "").strip()
    models = list(STUDIO_OPENAI_MODELS)
    if model and model not in models:
        models.insert(0, model)
    return {
        "locked": bool(model),
        "provider": "openai",
        "model": model or STUDIO_OPENAI_MODELS[0],
        "models": models,
    }


CONFIG = _load_config()
HOST = os.environ.get("GEAR_HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", CONFIG["server"]["port"]))
STORE_PATH = os.environ.get("GEAR_STORE_PATH", str(BASE_DIR / ".gear" / "gear.db"))
TRACKING_ENABLED = os.environ.get(
    "GEAR_TRACKING_ENABLED",
    os.environ.get("TRACKING_ENABLED", ""),
).lower() in {"1", "true", "yes"}
OPERATOR_PIN = os.environ.get("GEAR_OPERATOR_PIN", "").strip()
STUDIO_MODEL_POLICY = _studio_model_policy()
STUDIO_REVISION = _studio_revision()
TASKS_FILE_PATH = BASE_DIR / CONFIG["paths"]["tasks_file"]

DB_CONFIG = {
    "url": os.environ.get("DATABASE_URL"),
    "host": os.environ.get("DB_HOST", CONFIG["database"]["host"]),
    "port": int(os.environ.get("DB_PORT", CONFIG["database"]["port"])),
    "user": os.environ.get("DB_USER", CONFIG["database"]["user"]),
    "database": os.environ.get("DB_NAME", CONFIG["database"]["dbname"]),
    "password": os.environ.get("DB_PASSWORD"),
}
