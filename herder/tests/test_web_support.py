"""The pure helpers behind the pages: highlighting and redirect targets."""

from __future__ import annotations

from herder.web.support import back_to, highlight


def test_highlighting_escapes_everything_it_does_not_mark() -> None:
    """Messages are user text. A message containing markup must be shown, not run."""
    out = str(highlight("<script>alert(1)</script> we use Postgres here", "we use Postgres here"))
    assert "<script>" not in out
    assert "&lt;script&gt;" in out
    assert "<mark>we use Postgres here</mark>" in out


def test_highlighting_marks_nothing_when_nothing_matches() -> None:
    """Marking text that was not matched would overstate the evidence."""
    assert "<mark>" not in str(highlight("something else entirely", "we use Postgres in production"))


def test_a_merged_entry_marks_each_of_its_claims() -> None:
    message = "Money values are always Decimal. Also, amounts must never be floats anywhere in this system."
    entry = "Money values are always Decimal\n\nPreviously: amounts must never be floats anywhere in this system."
    out = str(highlight(message, entry))
    assert out.count("<mark>") == 2


def test_back_accepts_only_a_path_on_this_site() -> None:
    assert back_to("/projects/1", "/") == "/projects/1"
    assert back_to("//evil.example/", "/") == "/"
    assert back_to("https://evil.example/", "/") == "/"
    assert back_to(None, "/fallback") == "/fallback"
