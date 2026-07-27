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


def prepend_manual_mlflow_bootstrap(code: str, target: str) -> str:

    framework = "adk" if target.strip().lower() == "adk" else "crewai"
    bootstrap = f'''
# --- GEAR MANUAL MLflow observability ---
_gear_manual_mlflow = None
_gear_manual_root_context = None
_gear_manual_root_span = None
_gear_manual_trace_closed = False
try:
    import atexit as _gear_manual_atexit
    import json as _gear_manual_json
    import os as _gear_manual_os
    import sys as _gear_manual_sys

    _gear_manual_tracking_uri = _gear_manual_os.environ.get("MLFLOW_TRACKING_URI", "").strip()
    if _gear_manual_tracking_uri:
        if {framework!r} == "adk":
            _gear_manual_os.environ["MLFLOW_USE_DEFAULT_TRACER_PROVIDER"] = "false"

        import mlflow as _gear_manual_mlflow

        _gear_manual_mlflow.set_tracking_uri(_gear_manual_tracking_uri)
        _gear_manual_experiment = _gear_manual_mlflow.set_experiment(
            _gear_manual_os.environ.get("MLFLOW_EXPERIMENT_NAME", "gear-framework-production")
        )
        if {framework!r} == "adk":
            try:
                from mlflow.entities import MlflowExperimentLocation as _GearManualExperimentLocation
                _gear_manual_mlflow.tracing.set_destination(
                    _GearManualExperimentLocation(_gear_manual_experiment.experiment_id)
                )
            except Exception:
                pass

        _gear_manual_tags = {{
            "gear.source": "manual-code",
            "gear.framework": {framework!r},
        }}
        try:
            _gear_manual_context = _gear_manual_json.loads(
                _gear_manual_os.environ.get("GEAR_MLFLOW_CONTEXT_JSON", "{{}}")
            )
            if isinstance(_gear_manual_context, dict):
                _gear_manual_tags.update({{
                    str(key): str(value)
                    for key, value in _gear_manual_context.items()
                    if value not in (None, "")
                }})
        except Exception:
            pass

        if {framework!r} == "crewai":
            try:
                _gear_manual_mlflow.crewai.autolog()
            except Exception as _gear_manual_crewai_autolog_error:
                print(
                    f"MLflow CrewAI tracing unavailable: {{_gear_manual_crewai_autolog_error}}",
                    file=_gear_manual_sys.stderr,
                )

        try:
            _gear_manual_mlflow.litellm.autolog()
        except Exception as _gear_manual_litellm_autolog_error:
            print(
                f"MLflow LiteLLM tracing unavailable: {{_gear_manual_litellm_autolog_error}}",
                file=_gear_manual_sys.stderr,
            )

        _gear_manual_root_context = _gear_manual_mlflow.start_span(
            name="gear.manual.{framework}",
            span_type="CHAIN",
            attributes=_gear_manual_tags,
        )
        _gear_manual_root_span = _gear_manual_root_context.__enter__()
        _gear_manual_root_span.set_inputs({{
            "framework": {framework!r},
            "task_id": _gear_manual_tags.get("gear.task_id", ""),
            "task_log_id": _gear_manual_tags.get("gear.task_log_id", ""),
        }})
        _gear_manual_mlflow.update_current_trace(tags=_gear_manual_tags)
        _gear_manual_sys.stderr.write(
            "__GEAR_TRACE_START__\\n"
            + _gear_manual_json.dumps({{"trace_id": _gear_manual_root_span.trace_id}})
            + "\\n__GEAR_TRACE_END__\\n"
        )
        _gear_manual_sys.stderr.flush()

        def _gear_manual_finish_trace(error=None):
            global _gear_manual_trace_closed
            if _gear_manual_trace_closed or _gear_manual_root_context is None:
                return
            _gear_manual_trace_closed = True
            if error is not None and _gear_manual_root_span is not None:
                _gear_manual_root_span.set_outputs({{"error": str(error)}})
                _gear_manual_root_span.set_status("ERROR")
            _gear_manual_root_context.__exit__(None, None, None)
            _gear_manual_mlflow.flush_trace_async_logging()

        _gear_manual_original_excepthook = _gear_manual_sys.excepthook

        def _gear_manual_excepthook(error_type, error, traceback):
            _gear_manual_finish_trace(error)
            _gear_manual_original_excepthook(error_type, error, traceback)

        _gear_manual_sys.excepthook = _gear_manual_excepthook
        _gear_manual_atexit.register(_gear_manual_finish_trace)
except Exception as _gear_manual_mlflow_error:
    print(
        f"MLflow observability unavailable: {{_gear_manual_mlflow_error}}",
        file=__import__("sys").stderr,
    )
# --- End GEAR MANUAL MLflow observability ---
'''.lstrip()
    return bootstrap + "\n" + code