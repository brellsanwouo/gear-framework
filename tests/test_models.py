from pathlib import Path

import yaml
from flamapy.interfaces.python import FLAMAFeatureModel


def test_all_uvl_models_parse_and_are_satisfiable():
    paths = sorted(Path("gear").glob("*.uvl")) + sorted(Path("connectors/frameworks").glob("*/*.uvl"))
    assert paths
    for path in paths:
        model = FLAMAFeatureModel(str(path))
        assert model.satisfiable(), f"Unsatisfiable feature model: {path}"


def test_all_project_yaml_files_parse():
    paths = [Path("config.yml"), *Path("gear").glob("*.yml"), *Path("connectors").rglob("*.yml")]
    for path in paths:
        yaml.safe_load(path.read_text(encoding="utf-8"))
