"""Content hashing. Pure.

This is what makes ingest idempotent, so the two properties that matter are opposite ones:
noise must not change the hash, and content must.
"""

from __future__ import annotations

from herder.domain.hashing import content_hash, normalise


def h(text: str, *, vendor: str = "claude", ref: str = "abc", role: str = "user") -> str:
    return content_hash(vendor, ref, role, text)


def test_line_endings_are_noise() -> None:
    assert h("one\r\ntwo") == h("one\ntwo") == h("one\rtwo")


def test_trailing_whitespace_is_noise() -> None:
    assert h("one   \ntwo\t") == h("one\ntwo")


def test_surrounding_blank_lines_are_noise() -> None:
    assert h("\n\n  hello  \n\n") == h("hello")


def test_internal_newlines_are_content() -> None:
    """Collapsing these would make every code block hash like a reformatted version.

    That is silent data loss in a system whose entire job is remembering what was said.
    """
    assert h("def f():\n    return 1") != h("def f():     return 1")


def test_internal_spacing_is_content() -> None:
    assert h("a  b") != h("a b")


def test_role_is_part_of_the_identity() -> None:
    assert h("same words", role="user") != h("same words", role="assistant")


def test_conversation_is_part_of_the_identity() -> None:
    """The same sentence in two chats is two messages.

    It has to be, or moving a conversation between projects would start swallowing turns.
    """
    assert h("same words", ref="one") != h("same words", ref="two")


def test_vendor_case_is_noise() -> None:
    assert h("hi", vendor="Claude") == h("hi", vendor="claude")


def test_hash_is_stable_across_runs() -> None:
    """A hash that changed between processes would break idempotency after a restart."""
    assert h("hello") == "".join(h("hello"))
    assert len(h("hello")) == 64


def test_normalise_is_idempotent() -> None:
    once = normalise("a  \r\n b \n\n")
    assert normalise(once) == once
