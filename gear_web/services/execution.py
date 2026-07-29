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
    invokes_adk_workflow = False

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

        elif isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name):
                if node.func.id in _BLOCKED_CALLS:
                    raise ManualCodeValidationError(
                        f"Call to '{node.func.id}' is not allowed in manual experiment execution."
                    )
                invokes_adk_workflow |= node.func.id == "run_workflow"
            elif isinstance(node.func, ast.Attribute):
                invokes_adk_workflow |= node.func.attr in {"run", "run_async", "run_live"}

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
    if target == "adk" and not invokes_adk_workflow:
        raise ManualCodeValidationError(
            "The Google ADK script must invoke a runner (run, run_async, or run_live)."
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
    uses_async_crewai = framework == "crewai" and any(
        marker in code
        for marker in (
            "kickoff_async(",
            "kickoff_for_each_async(",
            "akickoff(",
            "akickoff_for_each(",
            "async def run_workflow",
        )
    )
    usage_helpers = r'''
def _gear_manual_mapping(value):
    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    for method_name in ("model_dump", "dict"):
        method = getattr(value, method_name, None)
        if callable(method):
            try:
                mapped = method()
                if isinstance(mapped, dict):
                    return mapped
            except Exception:
                pass
    try:
        return vars(value)
    except (TypeError, ValueError):
        return {}


def _gear_manual_int(value):
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _gear_manual_usage_from_value(value):
    candidates = [
        getattr(value, "usage_metrics", None),
        getattr(value, "token_usage", None),
        value,
    ]
    for candidate in candidates:
        mapped = _gear_manual_mapping(candidate)
        if not mapped:
            continue
        input_tokens = _gear_manual_int(
            mapped.get("input_tokens", mapped.get("prompt_tokens", mapped.get("prompt_token_count")))
        )
        output_tokens = _gear_manual_int(
            mapped.get(
                "output_tokens",
                mapped.get("completion_tokens", mapped.get("candidates_token_count")),
            )
        )
        total_tokens = _gear_manual_int(mapped.get("total_tokens", mapped.get("total_token_count")))
        if total_tokens is None and input_tokens is not None and output_tokens is not None:
            total_tokens = input_tokens + output_tokens
        if input_tokens is None and output_tokens is None and total_tokens is None:
            continue
        usage = {
            "input_tokens": input_tokens or 0,
            "output_tokens": output_tokens or 0,
            "total_tokens": total_tokens or 0,
        }
        cached_tokens = _gear_manual_int(
            mapped.get("cached_prompt_tokens", mapped.get("cached_content_token_count"))
        )
        if cached_tokens is not None:
            usage["cache_read_input_tokens"] = cached_tokens
        return usage, _gear_manual_int(mapped.get("successful_requests"))
    return None, None


def _gear_manual_adk_usage(events):
    if not isinstance(events, (list, tuple)):
        return None, None
    totals = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
    cached_total = 0
    has_cached = False
    calls = 0
    for event in events:
        metadata = getattr(event, "usage_metadata", None)
        usage, _ = _gear_manual_usage_from_value(metadata)
        if not usage:
            continue
        totals["input_tokens"] += usage.get("input_tokens", 0)
        totals["output_tokens"] += usage.get("output_tokens", 0)
        totals["total_tokens"] += usage.get("total_tokens", 0)
        if "cache_read_input_tokens" in usage:
            cached_total += usage["cache_read_input_tokens"]
            has_cached = True
        calls += 1
    if not calls:
        return None, None
    if has_cached:
        totals["cache_read_input_tokens"] = cached_total
    return totals, calls


def _gear_manual_model_and_provider(value):
    if value is None:
        return None, None
    model = str(value).strip()
    if not model:
        return None, None
    if "/" in model:
        provider, model_name = model.split("/", 1)
        if provider and model_name:
            return model_name, provider
    return model, None


def _gear_manual_models_from_value(value):
    models = []

    def append_model(candidate):
        if isinstance(candidate, str) and candidate.strip():
            models.append(candidate)
            return
        nested = getattr(candidate, "model", None)
        if isinstance(nested, str) and nested.strip():
            models.append(nested)

    append_model(getattr(value, "model", None))
    append_model(getattr(value, "llm", None))
    for collection_name in ("agents", "sub_agents"):
        agents = getattr(value, collection_name, None)
        if not isinstance(agents, (list, tuple)):
            continue
        for agent in agents:
            append_model(getattr(agent, "model", None))
            append_model(getattr(agent, "llm", None))
    return models


def _gear_manual_apply_usage_fallback():
    if _gear_manual_root_span is None:
        return
    best_usage = None
    best_calls = None
    best_source = None
    model_values = []
    for name, value in list(globals().items()):
        if name.startswith("_gear_manual_"):
            continue
        model_values.extend(_gear_manual_models_from_value(value))
        if _gear_manual_framework == "adk":
            usage, calls = _gear_manual_adk_usage(value)
            source = "adk.events"
        else:
            usage, calls = _gear_manual_usage_from_value(value)
            source = "crewai.result"
        if not usage:
            continue
        score = usage.get("total_tokens", 0) or (
            usage.get("input_tokens", 0) + usage.get("output_tokens", 0)
        )
        current_score = -1 if best_usage is None else (
            best_usage.get("total_tokens", 0)
            or best_usage.get("input_tokens", 0) + best_usage.get("output_tokens", 0)
        )
        if score > current_score:
            best_usage = usage
            best_calls = calls
            best_source = source
    if not best_usage:
        return
    _gear_manual_root_span.set_attribute("mlflow.chat.tokenUsage", best_usage)
    _gear_manual_root_span.set_attribute("gear.usage_source", best_source)
    if best_calls is not None:
        _gear_manual_root_span.set_attribute("gear.llm.call_count", best_calls)
    normalized_models = {
        pair for pair in (_gear_manual_model_and_provider(value) for value in model_values) if pair[0]
    }
    if len(normalized_models) == 1:
        model, provider = next(iter(normalized_models))
        _gear_manual_root_span.set_attribute("mlflow.llm.model", model)
        if provider:
            _gear_manual_root_span.set_attribute("mlflow.llm.provider", provider)
'''

    bootstrap = f'''
# --- GEAR MANUAL MLflow observability ---
_gear_manual_mlflow = None
_gear_manual_root_context = None
_gear_manual_root_span = None
_gear_manual_otel_provider = None
_gear_manual_trace_closed = False
_gear_manual_framework = {framework!r}
{usage_helpers}
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
        except Exception as _gear_manual_context_error:
            print(
                f"Unable to load GEAR MLflow context: {{_gear_manual_context_error}}",
                file=_gear_manual_sys.stderr,
            )

        if {framework!r} == "adk":
            try:
                from mlflow.entities.trace_location import (
                    MlflowExperimentLocation as _GearManualExperimentLocation,
                )
                from opentelemetry import trace as _gear_manual_otel_trace
                from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
                    OTLPSpanExporter as _GearManualOTLPSpanExporter,
                )
                from opentelemetry.sdk.trace import TracerProvider as _GearManualTracerProvider
                from opentelemetry.sdk.trace.export import (
                    SimpleSpanProcessor as _GearManualSimpleSpanProcessor,
                )

                _gear_manual_mlflow.tracing.set_destination(
                    _GearManualExperimentLocation(_gear_manual_experiment.experiment_id)
                )
                _gear_manual_otel_provider = _GearManualTracerProvider()
                _gear_manual_exporter = _GearManualOTLPSpanExporter(
                    endpoint=f"{{_gear_manual_tracking_uri.rstrip('/')}}/v1/traces",
                    headers={{
                        "x-mlflow-experiment-id": _gear_manual_experiment.experiment_id,
                    }},
                )
                _gear_manual_otel_provider.add_span_processor(
                    _GearManualSimpleSpanProcessor(_gear_manual_exporter)
                )
                _gear_manual_otel_trace.set_tracer_provider(_gear_manual_otel_provider)
            except Exception as _gear_manual_adk_trace_error:
                print(
                    f"MLflow ADK native tracing unavailable: {{_gear_manual_adk_trace_error}}",
                    file=_gear_manual_sys.stderr,
                )

        if {framework!r} == "crewai":
            try:
                if {uses_async_crewai!r}:
                    # MLflow's CrewAI integration is synchronous-only. GEAR's
                    # generated workflow uses kickoff_async(), so trace the
                    # underlying LiteLLM calls instead.
                    _gear_manual_mlflow.litellm.autolog()
                else:
                    _gear_manual_mlflow.crewai.autolog()
            except Exception as _gear_manual_crewai_autolog_error:
                print(
                    f"MLflow CrewAI/LiteLLM tracing unavailable: {{_gear_manual_crewai_autolog_error}}",
                    file=_gear_manual_sys.stderr,
                )

        _gear_manual_trace_attributes = dict(_gear_manual_tags)
        _gear_manual_experiment_user = _gear_manual_tags.get("gear.experiment_user_id")
        _gear_manual_session_id = _gear_manual_os.environ.get("GEAR_SESSION_ID", "").strip()
        if _gear_manual_experiment_user:
            _gear_manual_trace_attributes["user.id"] = _gear_manual_experiment_user
        if _gear_manual_session_id:
            _gear_manual_trace_attributes["session.id"] = _gear_manual_session_id

        _gear_manual_root_context = _gear_manual_mlflow.start_span(
            name="gear.manual.{framework}",
            span_type="CHAIN",
            attributes=_gear_manual_trace_attributes,
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
            _gear_manual_apply_usage_fallback()
            if _gear_manual_root_span is not None:
                if error is not None:
                    _gear_manual_root_span.set_outputs({{"error": str(error)}})
                    _gear_manual_root_span.set_status("ERROR")
                else:
                    _gear_manual_root_span.set_outputs({{"status": "completed"}})
            _gear_manual_root_context.__exit__(None, None, None)
            if _gear_manual_otel_provider is not None:
                _gear_manual_otel_provider.force_flush()
                _gear_manual_otel_provider.shutdown()
            _gear_manual_mlflow.flush_trace_async_logging(terminate=True)

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
