from gear_sdk.runner import run_python


def test_runner_uses_an_isolated_writable_home():
    result = run_python(
        """
import os
from pathlib import Path

home = Path(os.environ["HOME"])
paths = [
    home / ".local" / "share" / "gear-test",
    Path(os.environ["XDG_CACHE_HOME"]) / "gear-test",
    Path(os.environ["XDG_CONFIG_HOME"]) / "gear-test",
]
for path in paths:
    path.mkdir(parents=True, exist_ok=True)
    (path / "writable").write_text("yes", encoding="utf-8")
print(home == Path.cwd())
""",
        timeout=10,
    )

    assert result.returncode == 0
    assert result.stdout.strip() == "True"
    assert result.stderr == ""
