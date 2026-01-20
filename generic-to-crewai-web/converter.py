"""
Generic YAML to CrewAI YAML conversion helpers.
"""

from typing import Any, Dict


def generic_to_crewai(generic_config: Dict[str, Any]) -> Dict[str, Any]:
    """Convert a Generic agent configuration to CrewAI format."""
    agent = generic_config.get("agent", {})

    crewai: Dict[str, Any] = {
        "role": agent.get("identity", {}).get("name", "Agent"),
        "goal": agent.get("identity", {}).get("purpose", ""),
        "backstory": agent.get("identity", {}).get("context_description", ""),
        "llm": agent.get("llm_configuration", {}).get("model", "gpt-4"),
        "verbose": False,
        "allow_delegation": False,
        "allow_code_execution": False,
        "max_retry_limit": 2,
        "tools": [],
        "memory": False,
        "reasoning": False,
    }

    api_config = agent.get("llm_configuration", {}).get("api_configuration", {})
    if api_config.get("max_retries") is not None:
        crewai["max_retry_limit"] = api_config.get("max_retries")
    if api_config.get("timeout") is not None:
        crewai["max_execution_time"] = api_config.get("timeout")

    safety_config = agent.get("llm_configuration", {}).get("safety_configuration", {})
    if safety_config.get("mode"):
        crewai["code_execution_mode"] = safety_config.get("mode")

    tools_block = agent.get("tools")
    if isinstance(tools_block, list):
        crewai["tools"] = tools_block
    elif isinstance(tools_block, dict):
        if isinstance(tools_block.get("list"), list):
            crewai["tools"] = tools_block.get("list")
        else:
            tool_types = tools_block.get("tool_types", {})
            if tool_types.get("third_party_integrations"):
                crewai["tools"] = tool_types.get("third_party_integrations")
            elif tool_types.get("function_based_tools"):
                crewai["tools"] = tool_types.get("function_based_tools")

    exec_control = agent.get("execution_control", {})
    crewai["allow_delegation"] = exec_control.get("delegation_control") == "EnableDelegation"
    crewai["allow_code_execution"] = exec_control.get("code_execution_control") == "EnableCodeExecution"
    crewai["verbose"] = exec_control.get("verbosity_control") == "EnableVerbose"
    crewai["cache"] = exec_control.get("caching_control", "EnableCache") == "EnableCache"

    memory_system = agent.get("memory_system", {})
    if isinstance(memory_system, dict):
        if memory_system.get("enabled"):
            crewai["memory"] = True
    elif isinstance(memory_system, bool):
        crewai["memory"] = memory_system

    planning = agent.get("planning_capability", {})
    crewai["reasoning"] = planning.get("enabled", False)

    return crewai
