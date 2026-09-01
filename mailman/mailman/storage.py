"""The document store.

Bytes never go in the database. They go here, behind one interface, and a row points at
them with a key.

The key layout is S3-shaped from the start - a date partition and then the document id -
so moving to object storage later is a second implementation of this interface rather than
a change to the schema or to anything upstream of it:

    2026/09/01/8f3a.../original.pdf
    2026/09/01/8f3a.../text.txt

The date partition is not decoration. A flat directory of every document ever received
becomes unlistable, and the same is true of an S3 prefix.
"""

from __future__ import annotations

import uuid
from datetime import date
from pathlib import Path
from typing import Protocol


class StorageError(RuntimeError):
    """Raised when the store cannot satisfy a request."""


# What a detected media type is called on disk. Only types the pipeline accepts need an
# entry; anything else never reaches the store.
EXTENSIONS: dict[str, str] = {
    "application/pdf": ".pdf",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/tiff": ".tif",
}


def build_key(document_id: uuid.UUID, media_type: str, on: date) -> str:
    """Return the key for a document's original bytes.

    The extension comes from the media type detected in the bytes, never from the uploaded
    filename. A PDF uploaded as `invoice.xlsx` is stored as `original.pdf`, because the
    store should say what the file is rather than repeat what the sender claimed. It also
    keeps an attacker-controlled string out of the path entirely.
    """
    suffix = EXTENSIONS.get(media_type, "")
    return f"{on:%Y/%m/%d}/{document_id}/original{suffix}"


def text_key_for(original_key: str) -> str:
    """Return the key for the text pulled out of a document, beside the original."""
    return original_key.rsplit("/", 1)[0] + "/text.txt"


class DocumentStore(Protocol):
    """What the pipeline needs from a store. Deliberately four methods."""

    def put(self, key: str, data: bytes) -> None: ...

    def get(self, key: str) -> bytes: ...

    def exists(self, key: str) -> bool: ...

    def path_for(self, key: str) -> str: ...


class LocalDocumentStore:
    """Files on disk under a root directory.

    The first implementation, and the one the AWS stage replaces rather than modifies.
    """

    def __init__(self, root: str | Path) -> None:
        self._root = Path(root).resolve()
        self._root.mkdir(parents=True, exist_ok=True)

    def _resolve(self, key: str) -> Path:
        """Resolve a key to a path, refusing anything that escapes the root.

        Keys are generated internally today, so this cannot currently be reached. It is
        here because that will stop being true the moment a key comes from anywhere else,
        and a path traversal found later is worse than a check written early.
        """
        candidate = (self._root / key).resolve()
        if not candidate.is_relative_to(self._root):
            raise StorageError(f"key escapes the storage root: {key!r}")
        return candidate

    def put(self, key: str, data: bytes) -> None:
        path = self._resolve(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def get(self, key: str) -> bytes:
        path = self._resolve(key)
        if not path.exists():
            raise StorageError(f"no such key: {key!r}")
        return path.read_bytes()

    def exists(self, key: str) -> bool:
        return self._resolve(key).exists()

    def path_for(self, key: str) -> str:
        return str(self._resolve(key))
