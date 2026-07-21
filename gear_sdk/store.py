from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .conversion import BuildResult


class BuildStore:
    """SQLite-backed local history for conversion builds and execution logs."""

    def __init__(self, path: str | Path = ".gear/gear.db") -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS builds (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    target TEXT NOT NULL,
                    source_hash TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    output_dir TEXT,
                    schema_version TEXT NOT NULL DEFAULT '1.0',
                    connector_version TEXT NOT NULL DEFAULT 'unknown',
                    duration_ms INTEGER NOT NULL DEFAULT 0,
                    server_generated INTEGER NOT NULL DEFAULT 0,
                    report_json TEXT NOT NULL,
                    outputs_json TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS runs (
                    id TEXT PRIMARY KEY,
                    build_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    stdout TEXT NOT NULL DEFAULT '',
                    stderr TEXT NOT NULL DEFAULT '',
                    trace_id TEXT,
                    FOREIGN KEY (build_id) REFERENCES builds(id)
                );
                CREATE INDEX IF NOT EXISTS idx_builds_created_at ON builds(created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs(created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_runs_build_id ON runs(build_id);
                """
            )
            columns = {row[1] for row in connection.execute("PRAGMA table_info(builds)")}
            for name, definition in {
                "schema_version": "TEXT NOT NULL DEFAULT '1.0'",
                "connector_version": "TEXT NOT NULL DEFAULT 'unknown'",
                "duration_ms": "INTEGER NOT NULL DEFAULT 0",
                "server_generated": "INTEGER NOT NULL DEFAULT 0",
            }.items():
                if name not in columns:
                    connection.execute(f"ALTER TABLE builds ADD COLUMN {name} {definition}")

    def record_build(self, build: BuildResult, *, server_generated: bool = False) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO builds
                (id, project_id, target, source_hash, created_at, output_dir, schema_version,
                 connector_version, duration_ms, server_generated, report_json, outputs_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    build.id,
                    build.project_id,
                    build.target,
                    build.source_hash,
                    build.created_at,
                    str(build.output_dir) if build.output_dir else None,
                    build.schema_version,
                    build.connector_version,
                    build.duration_ms,
                    int(server_generated),
                    json.dumps(build.report, ensure_ascii=False),
                    json.dumps(build.outputs, ensure_ascii=False),
                ),
            )

    def list_builds(self, limit: int = 50) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                """SELECT id, project_id, target, source_hash, created_at, output_dir,
                          schema_version, connector_version, duration_ms, server_generated
                   FROM builds ORDER BY created_at DESC LIMIT ?""",
                (limit,),
            ).fetchall()
        return [dict(row) for row in rows]

    def get_build(self, build_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM builds WHERE id = ?", (build_id,)).fetchone()
        if row is None:
            return None
        result = dict(row)
        result["report"] = json.loads(result.pop("report_json"))
        result["outputs"] = json.loads(result.pop("outputs_json"))
        return result

    def list_runs(self, limit: int = 50) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute("SELECT * FROM runs ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
        return [dict(row) for row in rows]

    def get_run(self, run_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
        return dict(row) if row else None

    def record_run(
        self,
        build_id: str,
        status: str,
        stdout: str = "",
        stderr: str = "",
        trace_id: str | None = None,
        *,
        run_id: str | None = None,
    ) -> str:
        if self.get_build(build_id) is None:
            raise KeyError(f"Unknown build: {build_id}")
        identifier = run_id or str(uuid.uuid4())
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO runs (id, build_id, status, created_at, stdout, stderr, trace_id)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    identifier,
                    build_id,
                    status,
                    datetime.now(UTC).isoformat(),
                    stdout,
                    stderr,
                    trace_id,
                ),
            )
        return identifier
