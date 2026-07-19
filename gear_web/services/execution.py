from __future__ import annotations

import json
import textwrap


def prepend_google_adk_imports(code: str) -> str:
    required = "from google.adk.models.lite_llm import LiteLlm"
    return code if required in code else required + "\n" + code


def ensure_crewai_kickoff(code: str) -> str:
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


def parse_trace_id(stderr: str) -> str | None:
    if "__GEAR_TRACE_START__" not in stderr:
        return None
    try:
        json_part = stderr.split("__GEAR_TRACE_START__", 1)[1]
        json_part = json_part.split("__GEAR_TRACE_END__", 1)[0].strip()
        return (json.loads(json_part) or {}).get("trace_id")
    except (IndexError, TypeError, ValueError, json.JSONDecodeError):
        return None


def strip_trace_markers(stderr: str) -> str:
    if not stderr:
        return ""
    start = stderr.find("__GEAR_TRACE_START__")
    if start == -1:
        return stderr
    end = stderr.find("__GEAR_TRACE_END__", start)
    if end == -1:
        return stderr[:start].rstrip()
    end += len("__GEAR_TRACE_END__")
    return (stderr[:start] + stderr[end:]).strip()
