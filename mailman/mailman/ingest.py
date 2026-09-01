"""Ingestion: bytes in, a document row out.

The order matters. Bytes are written to the store before the row is inserted, because an
orphaned blob is harmless and a row pointing at bytes that are not there is a broken record.
"""

from __future__ import annotations

import io
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from mailman import media, storage
from mailman.models import Document
from mailman.status import FAILED, RECEIVED
from mailman.transitions import move


class UnsupportedDocument(Exception):
    """The bytes are not something the pipeline can read yet.

    Refused at the door. Nothing is stored, because storing a file the system cannot open
    buys nothing and the sender needs to be told now rather than later.
    """

    def __init__(self, media_type: str, reason: str) -> None:
        super().__init__(reason)
        self.media_type = media_type
        self.reason = reason


class EmptyUpload(Exception):
    """Zero bytes. Usually a broken upload rather than a broken document."""


@dataclass(frozen=True)
class PreparedText:
    """The text pulled out of a document, and whether there was any."""

    text: str
    page_count: int

    @property
    def is_empty(self) -> bool:
        # A PDF of a scan parses perfectly and yields nothing. That is the case this
        # property exists to catch, and it is the most common real-world one.
        return not self.text.strip()


def extract_pdf_text(data: bytes) -> PreparedText:
    """Pull the text layer out of a PDF.

    Imported lazily so the rest of ingestion stays importable and testable without
    pdfplumber installed, the same way the provider client will be.
    """
    import pdfplumber

    pages: list[str] = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for page in pdf.pages:
            pages.append(page.extract_text() or "")

    return PreparedText(text="\n".join(pages), page_count=len(pages))


def ingest(
    session: Session,
    store: storage.DocumentStore,
    *,
    filename: str,
    data: bytes,
    max_bytes: int,
) -> Document:
    """Store a document and return its row.

    Raises UnsupportedDocument or EmptyUpload before anything is written - a file the
    pipeline cannot open is refused at the door, because storing it buys nothing and the
    sender needs to be told now rather than later.

    A PDF that cannot be read is different. It is a real document the pipeline is meant to
    handle one day, so the bytes are kept and the document is moved to `failed` with the
    reason. A visible count of those is a roadmap; a refused-and-forgotten upload is not.

    A document that succeeds is left at `received`. Nothing moves it on yet - the extractor
    arrives in stage 2, and parking documents in `extracting` with nothing to advance them
    would be a lie told by the status column.
    """
    if not data:
        raise EmptyUpload("the uploaded file is empty")
    if len(data) > max_bytes:
        raise UnsupportedDocument(
            media.UNKNOWN,
            f"file is {len(data)} bytes; the limit is {max_bytes}",
        )

    media_type = media.sniff(data)
    if not media.is_supported(media_type):
        raise UnsupportedDocument(media_type, media.why_unsupported(media_type))

    document_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    key = storage.build_key(document_id, media_type, now.date())

    # Bytes first, and before the text is even attempted. An orphan blob is harmless; a row
    # pointing at bytes that are not there is a broken record, and a document that failed to
    # parse is exactly the one whose bytes someone will want to look at.
    store.put(key, data)

    document = Document(
        id=document_id,
        filename=filename,
        storage_path=key,
        mime_type=media_type,
        doc_type="invoice",
        status=RECEIVED,
        status_history=[
            {
                "from": None,
                "to": RECEIVED,
                "at": now.isoformat(),
                "actor": "api",
                "detail": f"uploaded as {filename!r}, {len(data)} bytes",
            }
        ],
    )
    session.add(document)
    session.flush()

    failure = _prepare_text(store, key, data)
    if failure is not None:
        move(document, FAILED, actor="pipeline", detail=failure)

    session.commit()
    session.refresh(document)
    return document


def _prepare_text(store: storage.DocumentStore, key: str, data: bytes) -> str | None:
    """Pull the text out and store it beside the original.

    Returns None on success, or the reason the document has to fail.

    The text is kept rather than regenerated on demand because it answers the question that
    otherwise cannot be answered later: did the model read it wrong, or was it handed
    something unreadable.
    """
    try:
        prepared = extract_pdf_text(data)
    except Exception as exc:  # noqa: BLE001 - any parser failure means the same thing here
        # The bytes claim to be a PDF and are not readable as one. Deliberately broad: the
        # PDF parser can raise almost anything on a malformed file, and the response is the
        # same whatever it raises.
        return f"the file starts with a PDF header but could not be parsed: {type(exc).__name__}"

    if prepared.is_empty:
        # Parses fine, says nothing. Almost always a scan, and the most common real case.
        return (
            f"no text layer: the PDF has {prepared.page_count} page(s) but no extractable "
            "text. Probably a scan, which needs OCR or a vision model."
        )

    store.put(storage.text_key_for(key), prepared.text.encode("utf-8"))
    return None
