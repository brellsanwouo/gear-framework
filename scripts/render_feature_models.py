"""Render the checked-in feature-model diagrams from the current UVL sources.

Requires flamapy and Graphviz (the Python package and the ``dot`` executable).
"""

from pathlib import Path

from flamapy.interfaces.python import FLAMAFeatureModel
from graphviz import Digraph


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "ui" / "assets" / "feature-models"
MODELS = {
    "agent": ROOT / "gear" / "gear-agent.uvl",
    "module": ROOT / "gear" / "gear-module.uvl",
    "workflow": ROOT / "gear" / "gear-multiagent.uvl",
}


def render_model(name: str, source: Path) -> None:
    model = FLAMAFeatureModel(str(source)).fm_model
    graph = Digraph(name, format="png")
    graph.attr(rankdir="TB", bgcolor="white", pad="0.2", nodesep="0.24", ranksep="0.38")
    graph.attr("node", shape="box", style="rounded,filled", color="#aebbd0", fillcolor="#f6f8fc", fontname="DejaVu Sans", fontsize="10", margin="0.08,0.05")
    graph.attr("edge", color="#9aaac0", arrowsize="0.45", fontname="DejaVu Sans", fontsize="8")

    def add_feature(feature) -> None:
        graph.node(feature.name, feature.name, fillcolor="#f6f8fc" if feature.is_abstract else "#e7eaff")
        for index, relation in enumerate(feature.get_relations()):
            children = relation.children
            if len(children) == 1:
                graph.edge(feature.name, children[0].name, style="solid" if relation.card_min else "dashed")
                add_feature(children[0])
                continue
            group = f"group_{feature.name}_{index}"
            kind = "XOR" if relation.card_min == relation.card_max == 1 else "OR" if relation.card_min == 1 else "GROUP"
            graph.node(group, kind, shape="ellipse", style="filled", fillcolor="#e8f4f0", color="#9abeb1", fontsize="8", margin="0.02,0.02")
            graph.edge(feature.name, group)
            for child in children:
                graph.edge(group, child.name)
                add_feature(child)

    add_feature(model.root)
    text = source.read_text(encoding="utf-8")
    if "\nconstraints" in text:
        constraints = [line.strip() for line in text.split("\nconstraints", 1)[1].splitlines() if line.strip()]
        if constraints:
            graph.attr(label="Constraints\n" + "\n".join(constraints), labelloc="b", fontname="DejaVu Sans", fontsize="10", fontcolor="#334e68")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    graph.render(filename=name, directory=OUTPUT, cleanup=True)


if __name__ == "__main__":
    for model_name, model_source in MODELS.items():
        render_model(model_name, model_source)
