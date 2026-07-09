"""Minimal display helpers.

Given the original text and the flags, print the text with flagged spans marked
inline and their warning level shown, followed by a per-flag breakdown. Plain
text only (no ANSI) so it behaves the same across terminals.
"""

from __future__ import annotations

from .models import AnalysisResult, Flag

_LEVEL_MARK = {"low": "!", "medium": "!!", "high": "!!!"}


def _locate(span: str, text: str) -> int:
    """Index of ``span`` in ``text`` (exact first, then case-insensitive), or -1."""
    idx = text.find(span)
    if idx != -1:
        return idx
    return text.lower().find(span.lower())


def render_marked_text(result: AnalysisResult) -> str:
    """Return the original text with flagged spans wrapped and labelled.

    A flagged span becomes:  [[span <!!! high: ad hominem>]]
    Overlapping spans are resolved by taking the earliest, longest first and
    skipping any later span that overlaps one already marked.
    ASCII-only markers so the report prints on any terminal (incl. Windows cp1252).
    """
    text = result.text

    located: list[tuple[int, int, Flag]] = []
    for flag in result.flags:
        idx = _locate(flag.span, text)
        if idx != -1:
            located.append((idx, idx + len(flag.span), flag))

    # Earliest start first; on a tie, longer span first.
    located.sort(key=lambda t: (t[0], -(t[1] - t[0])))

    out: list[str] = []
    cursor = 0
    last_end = 0
    for start, end, flag in located:
        if start < last_end:
            continue  # overlaps an already-marked span; skip
        out.append(text[cursor:start])
        mark = _LEVEL_MARK.get(flag.warning_level, "!")
        out.append(f"[[{text[start:end]} <{mark} {flag.warning_level}: {flag.fallacy_type}>]]")
        cursor = end
        last_end = end
    out.append(text[cursor:])
    return "".join(out)


def format_flag(flag: Flag, index: int) -> str:
    """One flag as a short block of lines."""
    lines = [
        f"[{index}] {flag.warning_level.upper():<6} {flag.fallacy_type}  "
        f"(confidence {flag.confidence:.2f})",
        f'      span: "{flag.span}"',
        f"      why:  {flag.explanation}",
    ]
    if flag.charitable_read:
        lines.append(f"      charitable read: {flag.charitable_read}")
    return "\n".join(lines)


def render_report(result: AnalysisResult) -> str:
    """Full human-readable report: marked text + flag breakdown."""
    parts = ["=== Text (flagged spans marked) ===", "", render_marked_text(result), ""]

    if not result.flags:
        parts.append("No possible fallacies flagged.")
        return "\n".join(parts)

    parts.append(f"=== Warnings ({len(result.flags)}) ===")
    parts.append(
        "(These are WARNINGS, not verdicts. This tool does not decide who is right.)"
    )
    parts.append("")
    for i, flag in enumerate(result.flags, start=1):
        parts.append(format_flag(flag, i))
        parts.append("")
    return "\n".join(parts).rstrip() + "\n"


def print_report(result: AnalysisResult) -> None:
    print(render_report(result))
