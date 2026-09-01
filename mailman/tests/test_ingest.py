"""Ingestion: bytes in, a document row out."""

from __future__ import annotations

import pytest

from mailman import ingest as ingest_module
from mailman import media, status as st, storage


def test_a_pdf_with_text_lands_at_received(db_session, tmp_path, pdf_with_text) -> None:
    store = storage.LocalDocumentStore(tmp_path)
    document = ingest_module.ingest(
        db_session, store, filename="inv.pdf", data=pdf_with_text, max_bytes=10_000_000
    )

    assert document.status == st.RECEIVED
    assert document.mime_type == media.PDF
    assert store.exists(document.storage_path)

    # The text is kept beside the original, because "did the model read it wrong or was it
    # handed something unreadable" cannot be answered after the fact otherwise.
    text = store.get(storage.text_key_for(document.storage_path)).decode()
    assert "INV-001" in text


def test_a_pdf_with_no_text_layer_fails_with_a_reason(
    db_session, tmp_path, pdf_without_text
) -> None:
    """A scan. Kept rather than refused - it is a document the pipeline should handle later."""
    store = storage.LocalDocumentStore(tmp_path)
    document = ingest_module.ingest(
        db_session, store, filename="scan.pdf", data=pdf_without_text, max_bytes=10_000_000
    )

    assert document.status == st.FAILED
    assert store.exists(document.storage_path), "the bytes are kept even though it failed"
    assert not store.exists(storage.text_key_for(document.storage_path))

    reason = document.status_history[-1]["detail"]
    assert "no text layer" in reason
    assert "scan" in reason


def test_an_unsupported_type_is_refused_and_nothing_is_stored(db_session, tmp_path) -> None:
    store = storage.LocalDocumentStore(tmp_path)
    with pytest.raises(ingest_module.UnsupportedDocument) as caught:
        ingest_module.ingest(
            db_session, store, filename="sheet.xlsx", data=b"PK\x03\x04zzz", max_bytes=10_000_000
        )

    assert caught.value.media_type == media.ZIP_OR_OOXML
    assert not any(tmp_path.rglob("*")), "nothing is written for a refused upload"


def test_an_empty_upload_is_a_bad_request_not_a_document(db_session, tmp_path) -> None:
    store = storage.LocalDocumentStore(tmp_path)
    with pytest.raises(ingest_module.EmptyUpload):
        ingest_module.ingest(
            db_session, store, filename="x.pdf", data=b"", max_bytes=10_000_000
        )


def test_an_oversized_upload_is_refused(db_session, tmp_path, pdf_with_text) -> None:
    store = storage.LocalDocumentStore(tmp_path)
    with pytest.raises(ingest_module.UnsupportedDocument):
        ingest_module.ingest(
            db_session, store, filename="x.pdf", data=pdf_with_text, max_bytes=10
        )


def test_a_corrupt_pdf_is_kept_and_failed_not_crashed(db_session, tmp_path) -> None:
    """It claims to be a PDF and is not one. The bytes are exactly what someone will want."""
    store = storage.LocalDocumentStore(tmp_path)
    document = ingest_module.ingest(
        db_session,
        store,
        filename="broken.pdf",
        data=b"%PDF-1.4\nthis is not actually a pdf",
        max_bytes=10_000_000,
    )

    assert document.status == st.FAILED
    assert store.exists(document.storage_path)
