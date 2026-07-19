from __future__ import annotations

import os

from flask import Flask
from flask_cors import CORS

from .blueprints.models import create_models_blueprint
from .blueprints.pages import create_pages_blueprint
from .blueprints.research import create_research_blueprint
from .blueprints.runner import create_runner_blueprint
from .blueprints.system import create_system_blueprint
from .builds import create_builds_blueprint
from .services.feature_models import FeatureModelService
from .settings import (
    BASE_DIR,
    CONFIG,
    DB_CONFIG,
    HOST,
    PORT,
    RUNTIME_PUBLIC_DIR,
    STORE_PATH,
    STUDIO_MODEL_POLICY,
    TASKS_FILE_PATH,
    TRACKING_ENABLED,
    UI_DIR,
)


def create_app() -> Flask:
    application = Flask(__name__, static_folder=str(UI_DIR), static_url_path="/ui")
    cors_origins = [
        origin.strip()
        for origin in os.environ.get("GEAR_CORS_ORIGINS", "").split(",")
        if origin.strip()
    ]
    if cors_origins:
        CORS(application, resources={r"/api/*": {"origins": cors_origins}})

    model_service = FeatureModelService(BASE_DIR, UI_DIR)
    application.register_blueprint(create_system_blueprint(STUDIO_MODEL_POLICY))
    application.register_blueprint(create_builds_blueprint(STORE_PATH, STUDIO_MODEL_POLICY))
    application.register_blueprint(create_runner_blueprint(STORE_PATH))
    application.register_blueprint(create_models_blueprint(model_service))
    application.register_blueprint(
        create_research_blueprint(
            base_dir=BASE_DIR,
            tasks_path=TASKS_FILE_PATH,
            experiment_config=CONFIG.get("experiment", {}),
            database=DB_CONFIG,
            tracking_enabled=TRACKING_ENABLED,
        )
    )
    application.register_blueprint(create_pages_blueprint(BASE_DIR, UI_DIR, RUNTIME_PUBLIC_DIR))
    return application


app = create_app()


def main() -> None:
    app.run(host=HOST, port=PORT, debug=False)


if __name__ == "__main__":
    main()
