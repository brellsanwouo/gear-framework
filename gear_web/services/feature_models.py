from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import Any

from flamapy.interfaces.python import FLAMAFeatureModel


class FeatureModelService:
    def __init__(self, base_dir: Path, ui_dir: Path):
        self.base_dir = base_dir
        self.image_dir = ui_dir / "assets" / "feature-models"
        self.models = {
            "agent": base_dir / "gear" / "gear-agent.uvl",
            "module": base_dir / "gear" / "gear-module.uvl",
            "workflow": base_dir / "gear" / "gear-multiagent.uvl",
            "multiagent": base_dir / "gear" / "gear-multiagent.uvl",
        }
        self.images: dict[str, dict[str, str]] = {
            "agent": {"source": "gear/gear-agent.uvl", "image": "agent.png"},
            "module": {"source": "gear/gear-module.uvl", "image": "module.png"},
            "workflow": {"source": "gear/gear-multiagent.uvl", "image": "workflow.png"},
            "multiagent": {"source": "gear/gear-multiagent.uvl", "image": "workflow.png"},
        }
    def model_path(self, model_type: str) -> Path:
        try:
            return self.models[model_type]
        except KeyError as error:
            raise ValueError("Unknown feature model type.") from error

    def analyze(self, model_type: str, selected_features: list[str], excluded_features: list[str] | None = None) -> dict[str, Any]:
        model_path = self.model_path(model_type)
        model = FLAMAFeatureModel(str(model_path))
        known = {feature.name for feature in model.fm_model.get_features()}
        excluded_features = excluded_features or []
        selected = set(selected_features)
        excluded = set(excluded_features)
        unknown = sorted((selected | excluded) - known)
        if unknown:
            raise ValueError(f"Unknown features: {', '.join(unknown)}")
        overlap = sorted(selected & excluded)
        if overlap:
            raise ValueError(f"Features cannot be both selected and excluded: {', '.join(overlap)}")

        model_text = model_path.read_text(encoding="utf-8").rstrip() + "\n"
        if selected or excluded:
            if "\nconstraints" not in model_text:
                model_text += "\nconstraints\n"
            model_text += "".join(f"\t{name}\n" for name in sorted(selected))
            model_text += "".join(f"\t!{name}\n" for name in sorted(excluded))

        temporary_path = ""
        try:
            with tempfile.NamedTemporaryFile(mode="w", suffix=".uvl", delete=False, encoding="utf-8") as handle:
                handle.write(model_text)
                temporary_path = handle.name
            constrained = FLAMAFeatureModel(temporary_path)
            return {
                "valid": constrained.satisfiable(),
                "config_count": model.configurations_number(),
                "message": "Successful analysis",
            }
        finally:
            if temporary_path and os.path.exists(temporary_path):
                os.remove(temporary_path)

    def image(self, model_type: str) -> dict[str, str]:
        try:
            metadata = self.images[model_type]
        except KeyError as error:
            raise ValueError("Unknown feature model type.") from error
        path = self.image_dir / metadata["image"]
        if not path.exists():
            raise FileNotFoundError(f"Missing feature model image: {path.relative_to(self.base_dir)}")
        return {
            "fm_type": model_type,
            "source": metadata["source"],
            "renderer": "graphviz-pregenerated-png",
            "image": f"/ui/assets/feature-models/{metadata['image']}?v={path.stat().st_mtime_ns}",
        }
