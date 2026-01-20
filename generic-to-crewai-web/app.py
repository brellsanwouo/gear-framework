"""
Minimal web app to convert Generic agent YAML to CrewAI YAML.
"""

from flask import Flask, render_template, request, jsonify
import yaml
from converter import generic_to_crewai


def _safe_str(value):
    if value is None:
        return ""
    return str(value)


def build_agent_graph(generic_config):
    """Build a simple node/edge graph for React Flow."""
    agent = generic_config.get("agent", {})
    nodes = [
        {
            "id": "agent",
            "data": {"label": "Agent"},
            "position": {"x": 0, "y": 0},
            "type": "default",
        }
    ]
    edges = []

    sections = []

    identity = agent.get("identity", {})
    if identity:
        name = _safe_str(identity.get("name", ""))
        sections.append(("identity", f"Identity\\nname: {name}".strip()))

    llm_config = agent.get("llm_configuration", {})
    if llm_config:
        model = _safe_str(llm_config.get("model", ""))
        sections.append(("llm", f"LLM\\nmodel: {model}".strip()))

    instruction = agent.get("instruction_definition", {}).get("task_specification", {})
    if instruction:
        task_name = _safe_str(instruction.get("task_name", ""))
        sections.append(("instruction", f"Instruction\\ntask: {task_name}".strip()))

    tools_block = agent.get("tools")
    tools_list = []
    if isinstance(tools_block, list):
        tools_list = tools_block
    elif isinstance(tools_block, dict):
        if isinstance(tools_block.get("list"), list):
            tools_list = tools_block.get("list")
        else:
            tool_types = tools_block.get("tool_types", {})
            tools_list = tool_types.get("third_party_integrations", []) or tool_types.get("function_based_tools", [])
    if tools_list:
        sections.append(("tools", f"Tools\\ncount: {len(tools_list)}"))

    exec_control = agent.get("execution_control", {})
    if exec_control:
        delegation = exec_control.get("delegation_control", "Unknown")
        verbose = exec_control.get("verbosity_control", "Unknown")
        sections.append(("execution", f"Execution\\n{delegation}\\n{verbose}"))

    memory = agent.get("memory_system", {})
    if memory:
        enabled = memory.get("enabled") if isinstance(memory, dict) else bool(memory)
        sections.append(("memory", f"Memory\\nenabled: {enabled}"))

    planning = agent.get("planning_capability", {})
    if planning:
        enabled = planning.get("enabled", False)
        sections.append(("planning", f"Planning\\nenabled: {enabled}"))

    cols = 3
    spacing_x = 260
    spacing_y = 150
    base_y = 140
    for index, (key, label) in enumerate(sections):
        row = index // cols
        col = index % cols
        x_offset = (col - (cols - 1) / 2) * spacing_x
        y_offset = base_y + row * spacing_y
        node_id = f"section-{key}"
        nodes.append(
            {
                "id": node_id,
                "data": {"label": label},
                "position": {"x": x_offset, "y": y_offset},
                "type": "default",
            }
        )
        edges.append({"id": f"edge-agent-{node_id}", "source": "agent", "target": node_id})

    return {"nodes": nodes, "edges": edges}

app = Flask(__name__)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/convert", methods=["POST"])
def convert():
    data = request.json or {}
    yaml_text = data.get("yaml")

    if not yaml_text:
        return jsonify({"success": False, "error": "Missing yaml"}), 400

    try:
        generic_config = yaml.safe_load(yaml_text)
    except yaml.YAMLError as exc:
        return jsonify({"success": False, "error": f"Invalid YAML: {exc}"}), 400

    if not isinstance(generic_config, dict):
        return jsonify({"success": False, "error": "YAML must parse to a mapping/object"}), 400

    crewai_config = generic_to_crewai(generic_config)
    graph = build_agent_graph(generic_config)
    crewai_yaml = yaml.safe_dump(
        crewai_config,
        sort_keys=False,
        default_flow_style=False,
    )

    return jsonify({
        "success": True,
        "crewai": crewai_config,
        "crewai_yaml": crewai_yaml,
        "graph": graph,
    })


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5001)
