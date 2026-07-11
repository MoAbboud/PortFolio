"""Database layer — persist every evaluation.

Stores the submitted text and its analysis result (the flags) so evaluations
can be reviewed later. Uses SQLite from the standard library — one file, no
external service, no extra dependency. Point ``FALLACY_WARN_DB`` at a different
path (e.g. a mounted volume) to relocate it.

What is stored, and nothing more:
  * created_at     UTC timestamp of the evaluation
  * text           the exact text that was submitted
  * warning_count  how many flags the analysis produced
  * flags_json     the flags, as JSON (fallacy_type, span, confidence, ...)

The table schema is documented in the README ("Database interface").
"""

from __future__ import annotations

import json
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional, Union

from .config import DB_PATH
from .models import AnalysisResult

PathLike = Union[str, Path]

_SCHEMA = """
CREATE TABLE IF NOT EXISTS analyses (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at    TEXT    NOT NULL,
    text          TEXT    NOT NULL,
    warning_count INTEGER NOT NULL,
    flags_json    TEXT    NOT NULL
);
"""


def _connect(path: PathLike) -> sqlite3.Connection:
    conn = sqlite3.connect(str(path))
    # WAL + a busy timeout keep concurrent web requests from tripping locks.
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=5000;")
    conn.row_factory = sqlite3.Row
    return conn


def init_db(path: PathLike = DB_PATH) -> None:
    """Create the table if it does not exist (idempotent)."""
    parent = Path(path).parent
    if str(parent) not in ("", "."):
        parent.mkdir(parents=True, exist_ok=True)
    with closing(_connect(path)) as conn:
        conn.execute(_SCHEMA)
        conn.commit()


def store_analysis(result: AnalysisResult, *, path: PathLike = DB_PATH) -> Optional[int]:
    """Insert one evaluation and return its row id.

    Best-effort: a storage failure never breaks the analysis — it returns
    ``None`` instead of raising, so the user still gets their result.
    """
    try:
        init_db(path)
        with closing(_connect(path)) as conn:
            cur = conn.execute(
                "INSERT INTO analyses (created_at, text, warning_count, flags_json) "
                "VALUES (?, ?, ?, ?)",
                (
                    datetime.now(timezone.utc).isoformat(),
                    result.text,
                    len(result.flags),
                    json.dumps([f.to_dict() for f in result.flags], ensure_ascii=False),
                ),
            )
            conn.commit()
            return int(cur.lastrowid) if cur.lastrowid is not None else None
    except sqlite3.Error:
        return None


def recent(limit: int = 20, *, path: PathLike = DB_PATH) -> list[dict[str, Any]]:
    """Return the most recent evaluations, newest first."""
    try:
        init_db(path)
        with closing(_connect(path)) as conn:
            rows = conn.execute(
                "SELECT id, created_at, text, warning_count, flags_json "
                "FROM analyses ORDER BY id DESC LIMIT ?",
                (limit,),
            ).fetchall()
    except sqlite3.Error:
        return []
    return [
        {
            "id": r["id"],
            "created_at": r["created_at"],
            "text": r["text"],
            "warning_count": r["warning_count"],
            "flags": json.loads(r["flags_json"]),
        }
        for r in rows
    ]
