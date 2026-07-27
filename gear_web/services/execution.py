from __future__ import annotations

import ast
import json
import textwrap


_ALLOWED_MANUAL_IMPORT_ROOTS = {
    "asyncio",
    "collections",
    "crewai",
    "dataclasses",
    "datetime",
    "decimal",
    "dotenv",
    "enum",
    "functools",
    "google",
    "itertools",
    "json",
    "litellm",
    "math",
    "operator",
    "pydantic",
    "re",
    "statistics",
    "typing",
    "uuid",
}

_BLOCKED_CALLS = {
    "__import__",
    "breakpoint",
    "compile",
    "delattr",
    "eval",
    "exec",
    "getattr",
    "globals",
    "help",
    "input",
    "locals",
    "open",
    "setattr",
    "vars",
}

_BLOCKED_ATTRIBUTES = {
    "__bases__",
    "__builtins__",
    "__class__",
    "__code__",
    "__dict__",
    "__func__",
    "__globals__",
    "__mro__",
    "__subclasses__",
}


class ManualCodeValidationError(ValueError):
    """Raised when manually supplied Python uses a forbidden construct."""


def validate_manual_code(code: str, target: str) -> None:
    """Apply a conservative pre-execution check to experiment code.

    This check reduces accidental access to the host but is not a replacement for
    a container or virtual-machine sandbox. It intentionally permits only the
    imports normally needed by the CrewAI and Google ADK experiment tasks.
    """
    try:
        tree = ast.parse(code, mode="exec")
    except SyntaxError as error:
        location = f" line {error.lineno}" if error.lineno else ""
        raise ManualCodeValidationError(f"Python syntax error{location}: {error.msg}") from error

    target = target.strip().lower()
    expected_root = "crewai" if target == "crewai" else "google"
    imported_expected_framework = False

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                root = alias.name.split(".", 1)[0]
                if root not in _ALLOWED_MANUAL_IMPORT_ROOTS:
                    raise ManualCodeValidationError(
                        f"Import '{alias.name}' is not allowed in manual experiment execution."
                    )
                imported_expected_framework |= root == expected_root

        elif isinstance(node, ast.ImportFrom):
            if node.level:
                raise ManualCodeValidationError("Relative imports are not allowed in manual execution.")
            root = (node.module or "").split(".", 1)[0]
            if root not in _ALLOWED_MANUAL_IMPORT_ROOTS:
                raise ManualCodeValidationError(
                    f"Import '{node.module or ''}' is not allowed in manual experiment execution."
                )
            imported_expected_framework |= root == expected_root

        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            if node.func.id in _BLOCKED_CALLS:
                raise ManualCodeValidationError(
                    f"Call to '{node.func.id}' is not allowed in manual experiment execution."
                )

        elif isinstance(node, ast.Attribute):
            if node.attr.startswith("__") or node.attr in _BLOCKED_ATTRIBUTES:
                raise ManualCodeValidationError(
                    f"Attribute access '{node.attr}' is not allowed in manual experiment execution."
                )

    if not imported_expected_framework:
        framework_name = "CrewAI" if target == "crewai" else "Google ADK"
        raise ManualCodeValidationError(
            f"The script must import {framework_name} because it is the selected target framework."
        )


def prepend_google_adk_imports(code: str) -> str:
    required = "from google.adk.models.lite_llm import LiteLlm"
    return code if required in code else required + "\n" + code


def ensure_crewai_kickoff(code: str) -> str:
    if "kickoff(" in code or "kickoff_async(" in code or "run_workflow(" in code:
        return code
    wrapper = textwrap.dedent(
        """
        if "crew" in globals():
            result = crew.kickoff()
            print(result)
        else:
            raise RuntimeError("No 'crew' variable defined. Create a Crew instance named 'crew' or call kickoff() explicitly.")
        """
    ).strip("\n")
    return f"{code}\n{wrapper}\n"


def strip_crewai_tracing_messages(output: str) -> str:
    """Remove CrewAI's first-run tracing panels without touching workflow output."""
    if not output:
        return ""
    kept: list[str] = []
    skipping = False
    for line in output.splitlines(keepends=True):
        stripped = line.strip()
        if not skipping and stripped.startswith("╭") and (
            "Tracing Preference Saved" in stripped or "Tracing Status" in stripped
        ):
            skipping = True
            continue
        if skipping:
            if stripped.startswith("╰"):
                skipping = False
            continue
        kept.append(line)
    return "".join(kept).lstrip("\r\n")


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
