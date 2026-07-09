"""SQLite results store.

One row per (case_id, run_id, scorer_name). A run_id groups all results from a
single `harness run` invocation so you can diff runs later (Phase 3: regression
tracking). We also persist the raw model output per (run_id, case_id) so a run
is fully reproducible/inspectable after the fact.

SQLite is the right call here: zero setup, a single file you can commit or
`.gitignore`, and `sqlite3` ships with Python. If the eval set grows to
thousands of cases and you want dashboards, this schema ports cleanly to Postgres.
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from types import TracebackType
from typing import Any

from .models import ModelResponse, ScoreResult

_SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    run_id      TEXT PRIMARY KEY,
    created_at  TEXT NOT NULL,
    model       TEXT NOT NULL,
    notes       TEXT
);

CREATE TABLE IF NOT EXISTS responses (
    run_id      TEXT NOT NULL,
    case_id     TEXT NOT NULL,
    model       TEXT NOT NULL,
    raw_text    TEXT NOT NULL,
    meta        TEXT NOT NULL,
    PRIMARY KEY (run_id, case_id),
    FOREIGN KEY (run_id) REFERENCES runs(run_id)
);

CREATE TABLE IF NOT EXISTS scores (
    run_id       TEXT NOT NULL,
    case_id      TEXT NOT NULL,
    scorer_name  TEXT NOT NULL,
    score        REAL NOT NULL,
    detail       TEXT NOT NULL,
    PRIMARY KEY (run_id, case_id, scorer_name),
    FOREIGN KEY (run_id) REFERENCES runs(run_id)
);
"""


def new_run_id() -> str:
    """Generate a fresh, sortable-ish run id."""
    return f"run_{uuid.uuid4().hex[:12]}"


class ResultsStore:
    """Thin wrapper around a SQLite database file.

    Usable as a context manager so the connection is always closed:

        with ResultsStore("results.db") as store:
            store.start_run(run_id, model="claude-opus-4-8")
            ...
    """

    def __init__(self, db_path: str | Path = "results.db") -> None:
        self._conn = sqlite3.connect(str(db_path))
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA foreign_keys = ON")
        self._conn.executescript(_SCHEMA)
        self._conn.commit()

    def __enter__(self) -> ResultsStore:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        self.close()

    def close(self) -> None:
        self._conn.close()

    def start_run(self, run_id: str, *, model: str, notes: str | None = None) -> None:
        self._conn.execute(
            "INSERT INTO runs (run_id, created_at, model, notes) VALUES (?, ?, ?, ?)",
            (run_id, datetime.now(timezone.utc).isoformat(), model, notes),
        )
        self._conn.commit()

    def save_response(self, run_id: str, response: ModelResponse) -> None:
        self._conn.execute(
            "INSERT OR REPLACE INTO responses "
            "(run_id, case_id, model, raw_text, meta) VALUES (?, ?, ?, ?, ?)",
            (
                run_id,
                response.case_id,
                response.model,
                response.raw_text,
                json.dumps(response.meta),
            ),
        )
        self._conn.commit()

    def save_score(self, run_id: str, case_id: str, result: ScoreResult) -> None:
        self._conn.execute(
            "INSERT OR REPLACE INTO scores "
            "(run_id, case_id, scorer_name, score, detail) VALUES (?, ?, ?, ?, ?)",
            (
                run_id,
                case_id,
                result.scorer_name,
                result.score,
                json.dumps(result.detail),
            ),
        )
        self._conn.commit()

    def run_summary(self, run_id: str) -> list[dict[str, Any]]:
        """Return mean score per scorer for a run (handy for a quick readout)."""
        rows = self._conn.execute(
            "SELECT scorer_name, AVG(score) AS mean_score, COUNT(*) AS n "
            "FROM scores WHERE run_id = ? GROUP BY scorer_name",
            (run_id,),
        ).fetchall()
        return [dict(r) for r in rows]
