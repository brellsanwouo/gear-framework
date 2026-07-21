from gear_web.services.execution import ensure_crewai_kickoff, strip_crewai_tracing_messages


def test_generated_async_crewai_workflow_is_not_wrapped_again():
    code = "async def run_workflow(value):\n    return value\n\nif __name__ == '__main__':\n    print('ok')\n"

    assert ensure_crewai_kickoff(code) == code


def test_crewai_tracing_preference_panels_are_removed_from_output():
    output = """\
╭──────── Tracing Preference Saved ────────╮
│ Info: Tracing has been disabled.         │
╰──────────────────────────────────────────╯

╭──────── Tracing Status ──────────────────╮
│ Info: Tracing is disabled.               │
╰──────────────────────────────────────────╯

Workflow result
"""

    assert strip_crewai_tracing_messages(output) == "Workflow result\n"
