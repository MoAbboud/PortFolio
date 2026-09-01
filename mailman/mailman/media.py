"""What kind of file is this, according to the bytes.

The filename is attacker-controlled and the extension is a suggestion. A PDF renamed to
.xlsx is still a PDF, and an .exe renamed to .pdf is still not one. The type is decided by
the leading bytes and nothing else.

python-magic is not used: it needs libmagic, which is another native dependency on Windows,
for a job that is a handful of signatures here.
"""

from __future__ import annotations

PDF = "application/pdf"
PNG = "image/png"
JPEG = "image/jpeg"
TIFF = "image/tiff"
ZIP_OR_OOXML = "application/zip"
LEGACY_OFFICE = "application/vnd.ms-office"
UNKNOWN = "application/octet-stream"

# Longest signature first, so a prefix never shadows a longer match.
_SIGNATURES: tuple[tuple[bytes, str], ...] = (
    (b"\x89PNG\r\n\x1a\n", PNG),
    (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1", LEGACY_OFFICE),
    (b"%PDF-", PDF),
    (b"PK\x03\x04", ZIP_OR_OOXML),
    (b"\xff\xd8\xff", JPEG),
    (b"II*\x00", TIFF),
    (b"MM\x00*", TIFF),
)

# What the pipeline can currently do something with. Everything else is refused at the door
# with a reason, rather than stored and half-processed into a thin extraction that looks
# real. This set grows one entry at a time, each with the stage that earned it.
SUPPORTED: frozenset[str] = frozenset({PDF})

# Refusal messages that say what would need to change, because "unsupported file type" tells
# whoever hit it nothing about whether to wait or to give up.
_WHY_UNSUPPORTED: dict[str, str] = {
    PNG: "Images are not supported yet - they have no text layer, so they need OCR or a vision model first.",
    JPEG: "Images are not supported yet - they have no text layer, so they need OCR or a vision model first.",
    TIFF: "Images are not supported yet - they have no text layer, so they need OCR or a vision model first.",
    ZIP_OR_OOXML: "Spreadsheets and other Office files are not supported yet.",
    LEGACY_OFFICE: "Legacy Office files are not supported yet.",
    UNKNOWN: "This does not look like any file type the pipeline recognises.",
}


def sniff(data: bytes) -> str:
    """Return the media type of these bytes, or UNKNOWN."""
    for signature, media_type in _SIGNATURES:
        if data.startswith(signature):
            return media_type
    return UNKNOWN


def is_supported(media_type: str) -> bool:
    return media_type in SUPPORTED


def why_unsupported(media_type: str) -> str:
    """Explain the refusal in terms of what would have to change."""
    return _WHY_UNSUPPORTED.get(
        media_type, f"{media_type} is not supported yet."
    )
