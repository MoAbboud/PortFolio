"""A minimal PDF writer, enough to lay out an invoice.

Written by hand rather than pulled from a library. The corpus needs PDFs with a text layer
that pdfplumber can read back, which is a few hundred bytes of PDF structure - not worth a
dependency the running service never uses, and a dependency here would be one more thing
between the generator and the labels it emits.

It writes one text-showing operator per line at a fixed leading, which is exactly what a
text-layer extractor sees. It does not do columns, and that is honest: a real invoice's
column layout is precisely what a text-only pipeline cannot see, and pretending otherwise
in the test corpus would hide the limitation rather than measure it.
"""

from __future__ import annotations

LINES_PER_PAGE = 46
FONT_SIZE = 11
LEADING = 15
TOP = 780
LEFT = 56


def _escape(text: str) -> str:
    return text.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


def _content_stream(lines: list[str]) -> bytes:
    parts = ["BT", f"/F1 {FONT_SIZE} Tf", f"{LEADING} TL", f"1 0 0 1 {LEFT} {TOP} Tm"]
    for line in lines:
        parts.append(f"({_escape(line)}) Tj")
        parts.append("T*")
    parts.append("ET")
    return "\n".join(parts).encode("latin-1", errors="replace")


def paginate(lines: list[str], per_page: int = LINES_PER_PAGE) -> list[list[str]]:
    """Split lines into pages, always returning at least one page."""
    if not lines:
        return [[]]
    return [lines[i : i + per_page] for i in range(0, len(lines), per_page)]


def build_pdf(lines: list[str], per_page: int = LINES_PER_PAGE) -> bytes:
    """Render text lines to a PDF with a real text layer.

    Object numbering: 1 catalog, 2 pages, 3 font, then a page object and a content stream
    for each page. Cross-reference offsets are computed as the file is written, because a
    wrong offset produces a file that opens in some readers and not others - the worst kind
    of broken.
    """
    pages = paginate(lines, per_page)
    page_count = len(pages)

    first_page_object = 4
    page_ids = [first_page_object + i * 2 for i in range(page_count)]
    content_ids = [first_page_object + i * 2 + 1 for i in range(page_count)]

    objects: dict[int, bytes] = {
        1: b"<< /Type /Catalog /Pages 2 0 R >>",
        2: (
            b"<< /Type /Pages /Kids ["
            + b" ".join(f"{pid} 0 R".encode() for pid in page_ids)
            + f"] /Count {page_count} >>".encode()
        ),
        3: b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    }

    for index, page_lines in enumerate(pages):
        stream = _content_stream(page_lines)
        objects[page_ids[index]] = (
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            + f"/Contents {content_ids[index]} 0 R ".encode()
            + b"/Resources << /Font << /F1 3 0 R >> >> >>"
        )
        objects[content_ids[index]] = (
            f"<< /Length {len(stream)} >>\nstream\n".encode() + stream + b"\nendstream"
        )

    out = bytearray(b"%PDF-1.4\n")
    offsets: dict[int, int] = {}
    for number in sorted(objects):
        offsets[number] = len(out)
        out += f"{number} 0 obj\n".encode() + objects[number] + b"\nendobj\n"

    xref_at = len(out)
    highest = max(objects)
    out += f"xref\n0 {highest + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for number in range(1, highest + 1):
        out += f"{offsets[number]:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {highest + 1} /Root 1 0 R >>\n".encode()
    out += f"startxref\n{xref_at}\n%%EOF\n".encode()
    return bytes(out)


def build_image_only_pdf(width: int = 400, height: int = 520) -> bytes:
    """A structurally valid PDF with no text layer at all.

    Draws rectangles and nothing else. This is what a scan looks like to `pdfplumber`: a
    perfectly good PDF that yields an empty string, which is a different failure from a
    malformed file and has to be reported as a different thing. The corpus needs documents the
    pipeline genuinely cannot handle, because an unsupported count visible in every run is a
    roadmap and a document quietly kept out of the corpus is a forgotten TODO.
    """
    content = b"1 0 0 RG\n2 w\n"
    for i in range(6):
        y = 40 + i * 70
        content += f"40 {y} {width - 80} 40 re\nS\n".encode("latin-1")

    objects: list[bytes] = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width} {height}] "
        f"/Contents 4 0 R /Resources << >> >>".encode("latin-1"),
        b"<< /Length " + str(len(content)).encode("ascii") + b" >>\nstream\n" + content + b"endstream",
    ]

    out = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n".encode("ascii") + body + b"\nendobj\n"

    start = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode("ascii")
    out += b"0000000000 65535 f \n"
    for offset in offsets[1:]:
        out += f"{offset:010d} 00000 n \n".encode("ascii")
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n".encode("ascii")
    return bytes(out)
