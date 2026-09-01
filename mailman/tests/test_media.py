"""The type comes from the bytes, never from the name."""

from __future__ import annotations

from mailman import media
from tests.conftest import build_pdf


def test_pdf_is_detected_from_its_header() -> None:
    assert media.sniff(build_pdf()) == media.PDF


def test_extension_does_not_decide() -> None:
    """A PDF called .xlsx is still a PDF, and the sniffer never sees the name at all."""
    assert media.sniff(build_pdf()) == media.PDF
    assert media.sniff(b"PK\x03\x04rest-of-a-real-xlsx") == media.ZIP_OR_OOXML


def test_images_and_office_files_are_recognised_but_not_supported() -> None:
    for data, expected in (
        (b"\x89PNG\r\n\x1a\n", media.PNG),
        (b"\xff\xd8\xff\xe0", media.JPEG),
        (b"PK\x03\x04", media.ZIP_OR_OOXML),
        (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1", media.LEGACY_OFFICE),
    ):
        assert media.sniff(data) == expected
        assert not media.is_supported(expected)


def test_unknown_bytes_are_unknown_rather_than_guessed() -> None:
    assert media.sniff(b"just some text") == media.UNKNOWN
    assert not media.is_supported(media.UNKNOWN)


def test_only_pdf_is_supported_so_far() -> None:
    """When this list grows, it should be because a stage earned it."""
    assert media.SUPPORTED == {media.PDF}


def test_refusals_say_what_would_have_to_change() -> None:
    """A refusal has to tell the sender whether to wait or to give up."""
    for media_type in (media.PNG, media.ZIP_OR_OOXML, media.UNKNOWN):
        reason = media.why_unsupported(media_type)
        assert reason.endswith(".")
        assert len(reason) > 20
