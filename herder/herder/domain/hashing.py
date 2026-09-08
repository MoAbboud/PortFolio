"""Content hashing. Pure.

`content_hash` is what makes ingest idempotent: `unique (conversation_id, content_hash)`
means the extension can re-send the same turn on a retry, on a page reload, or because the
observer fired twice for one node, and the duplicate is silently acknowledged.

The normalisation is deliberately minimal. It is tempting to collapse all whitespace so that
two "obviously the same" messages hash alike - and that would make every code block in every
conversation hash the same as a reformatted version of itself, which is a silent data loss in
a system whose entire purpose is remembering what was said. Line endings and trailing spaces
are noise. Everything else is content.
"""

from __future__ import annotations

import hashlib


def normalise(text: str) -> str:
    """Line endings and trailing whitespace only. Internal structure is content."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    return "\n".join(line.rstrip() for line in text.split("\n")).strip()


def content_hash(vendor: str, conversation_ref: str, role: str, text: str) -> str:
    """sha256 over the identity of a turn.

    The conversation reference is part of the hash so that the same sentence said in two
    different chats is two different messages. It has to be, or moving a conversation
    between projects would start silently swallowing turns.
    """
    payload = "\x1f".join([vendor.strip().lower(), conversation_ref, role.strip().lower(), normalise(text)])
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()
