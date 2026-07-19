"""Backward-compatible Gear web entry point.

The application now lives in :mod:`gear_web.app`; this module keeps existing
commands and imports working for users of earlier Gear releases.
"""

from gear_web.app import HOST, PORT, app, main

__all__ = ["HOST", "PORT", "app", "main"]


if __name__ == "__main__":
    main()
