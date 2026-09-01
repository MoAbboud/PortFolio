"""The document store, and the key layout that makes the AWS move a client swap."""

from __future__ import annotations

import uuid
from datetime import date

import pytest

from mailman import storage


def test_keys_are_date_partitioned_then_by_document() -> None:
    document_id = uuid.UUID("11111111-2222-3333-4444-555555555555")
    key = storage.build_key(document_id, "application/pdf", date(2026, 9, 1))
    assert key == f"2026/09/01/{document_id}/original.pdf"


def test_the_text_sits_beside_the_original() -> None:
    key = "2026/09/01/abc/original.pdf"
    assert storage.text_key_for(key) == "2026/09/01/abc/text.txt"


def test_the_filename_never_reaches_the_key() -> None:
    """The key is built from the detected type, so a hostile filename cannot shape a path.

    Found by looking at the store after a real upload: a PDF sent as liar.xlsx had been
    written as original.xlsx, which made the store repeat the sender's claim instead of
    recording what the file actually is.
    """
    document_id = uuid.uuid4()
    key = storage.build_key(document_id, "application/pdf", date(2026, 9, 1))
    assert key.endswith("/original.pdf")

    # An unknown type gets no extension rather than a guessed one.
    assert storage.build_key(document_id, "application/zip", date(2026, 9, 1)).endswith(
        "/original"
    )


def test_put_and_get_round_trip(tmp_path) -> None:
    store = storage.LocalDocumentStore(tmp_path)
    store.put("2026/09/01/abc/original.pdf", b"bytes")
    assert store.exists("2026/09/01/abc/original.pdf")
    assert store.get("2026/09/01/abc/original.pdf") == b"bytes"


def test_a_key_that_escapes_the_root_is_refused(tmp_path) -> None:
    """Unreachable today because keys are generated internally. Written for the day it is not."""
    store = storage.LocalDocumentStore(tmp_path / "root")
    with pytest.raises(storage.StorageError):
        store.put("../escaped.txt", b"nope")


def test_a_missing_key_raises_rather_than_returning_empty(tmp_path) -> None:
    store = storage.LocalDocumentStore(tmp_path)
    with pytest.raises(storage.StorageError):
        store.get("2026/09/01/nothing/original.pdf")
