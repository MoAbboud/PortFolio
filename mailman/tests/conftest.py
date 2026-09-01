"""Shared fixtures.

The PDFs here are built by hand rather than by a library. Stage 1 needs something to ingest
and something that fails to ingest, and pulling in a PDF-writing dependency to get two test
files would be a dependency the running system never uses. The real invoice generator
arrives in stage 3, where it is the point rather than a side effect.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from sqlalchemy import text as sql_text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from mailman.db import Base, engine

# Imported for the side effect of registering the tables on Base.metadata.
from mailman import models  # noqa: F401


def build_pdf(body: str | None = "Invoice INV-001\nTotal 1234.56") -> bytes:
    """Return a small valid PDF.

    With `body`, the page draws that text and a parser can read it back. With None, the page
    draws a rectangle instead - structurally a perfectly good PDF with no text layer at all,
    which is exactly what a scan looks like to the pipeline.
    """
    if body is None:
        content = b"1 0 0 RG\n72 72 200 200 re\nS\n"
    else:
        lines = []
        y = 720
        for line in body.split("\n"):
            escaped = line.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")
            lines.append(f"BT /F1 12 Tf 72 {y} Td ({escaped}) Tj ET".encode("latin-1"))
            y -= 18
        content = b"\n".join(lines) + b"\n"

    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length " + str(len(content)).encode() + b" >>\nstream\n" + content + b"endstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]

    out = bytearray(b"%PDF-1.4\n")
    offsets: list[int] = []
    for number, body_bytes in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n".encode() + body_bytes + b"\nendobj\n"

    xref_at = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for offset in offsets:
        out += f"{offset:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n".encode()
    out += f"startxref\n{xref_at}\n%%EOF\n".encode()
    return bytes(out)


@pytest.fixture
def pdf_with_text() -> bytes:
    return build_pdf()


@pytest.fixture
def pdf_without_text() -> bytes:
    return build_pdf(None)


@pytest.fixture
def db_session() -> Iterator[Session]:
    """A session whose work is rolled back afterwards, even across commits.

    The session joins an outer transaction on a single connection and creates savepoints for
    its own commits, so code under test can commit normally and the database is still left
    exactly as it was found. Skipped when there is no database, which keeps the rest of the
    suite runnable on a machine with nothing running.
    """
    try:
        connection = engine.connect()
        connection.execute(sql_text("SELECT 1"))
        # The probe autobegins a transaction. It has to be cleared, or the explicit begin()
        # below raises "this connection has already initialized a Transaction".
        connection.rollback()
    except SQLAlchemyError as exc:
        pytest.skip(f"no database available: {type(exc).__name__}")

    transaction = connection.begin()
    session = Session(bind=connection, join_transaction_mode="create_savepoint")
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()
