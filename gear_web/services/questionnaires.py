from __future__ import annotations

from typing import Any, Iterable


QUESTIONNAIRE_VERSION = "2026-07-v3"
MAX_LONG_TEXT_LENGTH = 4000

CURRENT_ROLES = {
    "student",
    "phd_student",
    "researcher",
    "software_developer",
    "other",
}
PYTHON_DURATIONS = {"never", "lt_1_year", "1_2_years", "3_5_years", "gt_5_years"}
USAGE_FREQUENCIES = {"never", "less_than_monthly", "monthly", "weekly", "daily"}
FRAMEWORK_EXPERIENCE_LEVELS = {
    "none",
    "read_about",
    "completed_tutorial",
    "one_project",
    "several_projects",
}
PRIOR_GEAR_USE_LEVELS = {"no", "once_or_twice", "more_than_twice"}
EASIER_FRAMEWORK_CHOICES = {
    "crewai_much_easier",
    "crewai_somewhat_easier",
    "no_meaningful_difference",
    "adk_somewhat_easier",
    "adk_much_easier",
}
PREFERRED_FRAMEWORK_CHOICES = {
    "crewai",
    "adk",
    "no_preference",
    "not_enough_information",
}
EXPERIMENTER_HELP_CHOICES = {"no", "yes", "unsure"}
OPERATOR_IDS = {"nada", "brell"}
CONCEPTUAL_HELP_CHOICES = {"no", "possibly", "yes"}
TECHNICAL_INCIDENT_CHOICES = {"none", "resolved_with_pause", "technical_failure"}
DATA_QUALITY_CHOICES = {
    "usable",
    "usable_with_reservations",
    "partially_usable",
    "exclude_primary_analysis",
    "to_review",
}
EXPERIMENT_MODES = {"GEAR", "MANUAL"}


def _object(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("The questionnaire payload must be a JSON object.")
    return payload


def _required_text(
    payload: dict[str, Any],
    name: str,
    *,
    maximum: int = MAX_LONG_TEXT_LENGTH,
) -> str:
    value = str(payload.get(name) or "").strip()
    if not value:
        raise ValueError(f"A response is required for '{name}'.")
    if len(value) > maximum:
        raise ValueError(f"'{name}' must contain at most {maximum} characters.")
    return value


def _optional_text(
    payload: dict[str, Any],
    name: str,
    *,
    maximum: int = MAX_LONG_TEXT_LENGTH,
) -> str:
    value = str(payload.get(name) or "").strip()
    if len(value) > maximum:
        raise ValueError(f"'{name}' must contain at most {maximum} characters.")
    return value


def _choice(payload: dict[str, Any], name: str, allowed: Iterable[str]) -> str:
    value = str(payload.get(name) or "").strip()
    if value not in set(allowed):
        raise ValueError(f"Invalid value for '{name}'.")
    return value


def _integer(payload: dict[str, Any], name: str, minimum: int, maximum: int) -> int:
    try:
        value = int(payload.get(name))
    except (TypeError, ValueError) as error:
        raise ValueError(f"A valid answer is required for '{name}'.") from error
    if not minimum <= value <= maximum:
        raise ValueError(f"'{name}' must be between {minimum} and {maximum}.")
    return value


def _step_integer(
    payload: dict[str, Any],
    name: str,
    minimum: int,
    maximum: int,
    step: int,
) -> int:
    value = _integer(payload, name, minimum, maximum)
    if (value - minimum) % step:
        raise ValueError(f"'{name}' must use increments of {step}.")
    return value


def _user_id(payload: dict[str, Any]) -> str:
    return _required_text(payload, "user_id", maximum=255)


def validate_background_response(payload: Any) -> dict[str, Any]:
    """Validate the concise pre-task profile used to describe important confounders."""
    source = _object(payload)
    return {
        "user_id": _user_id(source),
        "current_role": _choice(source, "current_role", CURRENT_ROLES),
        "python_duration": _choice(source, "python_duration", PYTHON_DURATIONS),
        "mas_experience": _choice(source, "mas_experience", FRAMEWORK_EXPERIENCE_LEVELS),
        "crewai_experience": _choice(source, "crewai_experience", FRAMEWORK_EXPERIENCE_LEVELS),
        "adk_experience": _choice(source, "adk_experience", FRAMEWORK_EXPERIENCE_LEVELS),
        "ai_coding_frequency": _choice(source, "ai_coding_frequency", USAGE_FREQUENCIES),
        "prior_gear_use": _choice(source, "prior_gear_use", PRIOR_GEAR_USE_LEVELS),
        "technical_english": _integer(source, "technical_english", 1, 7),
    }


def validate_task_response(payload: Any, *, translation: bool) -> dict[str, Any]:
    source = _object(payload)
    try:
        task_log_id = int(source.get("task_log_id"))
    except (TypeError, ValueError) as error:
        raise ValueError("A valid task_log_id is required.") from error
    if task_log_id <= 0:
        raise ValueError("A valid task_log_id is required.")

    values: dict[str, Any] = {
        "user_id": _user_id(source),
        "task_log_id": task_log_id,
        "seq_ease": _integer(source, "seq_ease", 1, 7),
        "technical_impact": _integer(source, "technical_impact", 0, 3),
        "reuse_extent": None,
        # Retained as NULL for compatibility with databases created by questionnaire v2.
        "previous_solution_help": None,
        "translation_rework": None,
    }
    if translation:
        values.update({
            "reuse_extent": _integer(source, "reuse_extent", 0, 4),
            "translation_rework": _integer(source, "translation_rework", 1, 7),
        })
    return values


def raw_tlx_score(values: dict[str, int]) -> float:
    dimensions = (
        "mental_demand",
        "physical_demand",
        "temporal_demand",
        "performance",
        "effort",
        "frustration",
    )
    return round(sum(values[name] for name in dimensions) / len(dimensions), 2)


def validate_framework_response(payload: Any) -> dict[str, Any]:
    source = _object(payload)
    values: dict[str, Any] = {
        "user_id": _user_id(source),
        "framework": _choice(source, "framework", {"crewai", "adk"}),
    }
    for name in (
        "mental_demand",
        "physical_demand",
        "temporal_demand",
        "performance",
        "effort",
        "frustration",
    ):
        values[name] = _step_integer(source, name, 0, 100, 5)
    values["raw_tlx_score"] = raw_tlx_score(values)
    values["concept_clarity"] = _integer(source, "concept_clarity", 1, 7)
    error_clarity = _integer(source, "error_feedback_clarity", 0, 7)
    values["error_feedback_clarity"] = None if error_clarity == 0 else error_clarity
    return values


def sus_score(responses: list[int]) -> float:
    if len(responses) != 10:
        raise ValueError("SUS requires exactly ten responses.")
    contribution = 0
    for index, value in enumerate(responses, start=1):
        if not 1 <= value <= 5:
            raise ValueError("Each SUS response must be between 1 and 5.")
        contribution += value - 1 if index % 2 else 5 - value
    return contribution * 2.5


def validate_final_response(payload: Any, *, mode: str) -> dict[str, Any]:
    """Validate common measures plus two mode-specific explanatory items."""
    source = _object(payload)
    normalized_mode = str(mode or "").strip().upper()
    if normalized_mode not in EXPERIMENT_MODES:
        raise ValueError("A valid assigned experiment mode is required.")

    values: dict[str, Any] = {
        "user_id": _user_id(source),
        "assigned_mode": normalized_mode,
    }

    sus_responses = [_integer(source, f"sus_{index}", 1, 5) for index in range(1, 11)]
    for index, response in enumerate(sus_responses, start=1):
        values[f"sus_{index}"] = response
    values["sus_score"] = sus_score(sus_responses)

    # Two concise TAM-inspired items: perceived usefulness and future intention.
    for index in range(1, 3):
        values[f"usefulness_{index}"] = _integer(source, f"usefulness_{index}", 1, 7)

    # Three study-specific transfer items, reported individually.
    for index in range(1, 4):
        values[f"transfer_{index}"] = _integer(source, f"transfer_{index}", 1, 7)

    values["mode_specific_1"] = _integer(source, "mode_specific_1", 1, 7)
    values["mode_specific_2"] = _integer(source, "mode_specific_2", 1, 7)

    values.update({
        "easier_framework": _choice(source, "easier_framework", EASIER_FRAMEWORK_CHOICES),
        "preferred_framework": _choice(source, "preferred_framework", PREFERRED_FRAMEWORK_CHOICES),
        "preference_reason": _required_text(source, "preference_reason"),
        "translation_strategy": _required_text(source, "translation_strategy"),
        "main_difficulty": _required_text(source, "main_difficulty"),
        "main_help": _required_text(source, "main_help"),
        "missing_support": _required_text(source, "missing_support"),
        "additional_feedback": _optional_text(source, "additional_feedback"),
        "technical_impact_overall": _integer(source, "technical_impact_overall", 0, 3),
        "technical_issue_description": _optional_text(source, "technical_issue_description"),
        "experimenter_help": _choice(source, "experimenter_help", EXPERIMENTER_HELP_CHOICES),
        "experimenter_help_description": _optional_text(source, "experimenter_help_description"),
    })
    if values["technical_impact_overall"] > 0 and not values["technical_issue_description"]:
        raise ValueError("Please describe the technical problem that affected the experiment.")
    if values["experimenter_help"] != "no" and not values["experimenter_help_description"]:
        raise ValueError("Please describe the assistance received from the experimenter.")
    return values


def validate_operator_report(payload: Any) -> dict[str, Any]:
    source = _object(payload)
    protocol_value = source.get("protocol_followed")
    if isinstance(protocol_value, bool):
        protocol_followed = protocol_value
    elif str(protocol_value).strip().lower() in {"true", "1", "yes"}:
        protocol_followed = True
    elif str(protocol_value).strip().lower() in {"false", "0", "no"}:
        protocol_followed = False
    else:
        raise ValueError("A valid value is required for 'protocol_followed'.")

    values = {
        "user_id": _user_id(source),
        "operator_id": _choice(source, "operator_id", OPERATOR_IDS),
        "protocol_followed": protocol_followed,
        "conceptual_help": _choice(source, "conceptual_help", CONCEPTUAL_HELP_CHOICES),
        "technical_incidents": _choice(source, "technical_incidents", TECHNICAL_INCIDENT_CHOICES),
        "data_quality": _choice(source, "data_quality", DATA_QUALITY_CHOICES),
        "incident_notes": _optional_text(source, "incident_notes"),
        "quality_notes": _required_text(source, "quality_notes"),
    }
    if not protocol_followed and not values["incident_notes"]:
        raise ValueError("Please document the protocol deviation.")
    if values["technical_incidents"] != "none" and not values["incident_notes"]:
        raise ValueError("Please document the technical incident.")
    return values