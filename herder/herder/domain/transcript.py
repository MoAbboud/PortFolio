"""Parsing a pasted transcript into turns.

Pure. No IO, no database, no models.

The rule that shapes this module: **an unrecognised transcript is refused with a reason
rather than parsed into one enormous turn.** A single 40,000-token "message" would sail
through ingest, chunk into nonsense, and produce a brief that looked plausible and was
built on a parse failure nobody was told about. Refusing is the honest failure.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

# How much text may sit before the first speaker marker before the parse is not believed.
# A title line or a date is normal. Three paragraphs means the format was misread.
MAX_PREAMBLE_CHARS = 200


class TranscriptError(ValueError):
    """The transcript could not be parsed. The message says why, and reaches the caller."""


@dataclass(frozen=True)
class ParsedTurn:
    role: str
    content: str
    position: int


@dataclass
class ParsedTranscript:
    turns: list[ParsedTurn]
    # Anything the parser did that the user should know about - a dropped title line, a
    # marker with nothing after it. Returned by the API rather than swallowed.
    notes: list[str] = field(default_factory=list)


# Speaker labels seen in the wild, mapped onto the four roles the schema allows.
_ROLE_WORDS = {
    "user": "user",
    "human": "user",
    "you": "user",
    "me": "user",
    "q": "user",
    "prompt": "user",
    "assistant": "assistant",
    "ai": "assistant",
    "claude": "assistant",
    "chatgpt": "assistant",
    "gpt": "assistant",
    "gemini": "assistant",
    "copilot": "assistant",
    "bot": "assistant",
    "a": "assistant",
    "answer": "assistant",
    "system": "system",
    "tool": "tool",
}

# A speaker marker at the start of a line: optional markdown bold or heading, the word, a
# colon. Kept deliberately tight - matching mid-sentence colons would shred code blocks and
# prose alike, and a transcript that silently loses its code is worse than one that is
# refused.
_MARKER = re.compile(
    r"^[ \t]{0,3}(?:#{1,6}[ \t]*)?(?:\*\*|__)?[ \t]*"
    r"(" + "|".join(sorted(_ROLE_WORDS, key=len, reverse=True)) + r")"
    r"[ \t]*(?:\*\*|__)?[ \t]*:[ \t]*",
    re.IGNORECASE | re.MULTILINE,
)


def normalise_role(raw: str) -> str:
    role = _ROLE_WORDS.get(raw.strip().lower())
    if role is None:
        raise TranscriptError(f"unknown speaker role {raw!r}")
    return role


def parse_transcript(text: str) -> ParsedTranscript:
    """Parse a pasted transcript. Raises TranscriptError with a reason if it cannot."""
    if not text or not text.strip():
        raise TranscriptError("the transcript is empty")

    stripped = text.lstrip()
    if stripped[:1] in "[{":
        try:
            return _parse_json(stripped)
        except TranscriptError:
            raise
        except (ValueError, TypeError):
            # It looked like JSON and was not. Fall through to the text parser rather than
            # refusing outright - a transcript can legitimately open with a code block.
            pass

    return _parse_marked_text(text)


def _parse_json(raw: str) -> ParsedTranscript:
    data = json.loads(raw)

    if isinstance(data, dict):
        for key in ("messages", "conversation", "turns", "chat"):
            if isinstance(data.get(key), list):
                data = data[key]
                break
        else:
            raise TranscriptError(
                "JSON object with no 'messages' list. Export the conversation as a list of "
                "{role, content} objects, or paste it as text with 'User:' and "
                "'Assistant:' markers."
            )

    if not isinstance(data, list) or not data:
        raise TranscriptError("JSON transcript is not a non-empty list of turns")

    turns: list[ParsedTurn] = []
    notes: list[str] = []

    for index, item in enumerate(data):
        if not isinstance(item, dict):
            raise TranscriptError(f"turn {index} is not an object")
        if "role" not in item:
            raise TranscriptError(f"turn {index} has no 'role'")

        content = item.get("content", item.get("text", ""))
        # Some exports carry content as a list of parts.
        if isinstance(content, list):
            content = "\n".join(
                part.get("text", "") if isinstance(part, dict) else str(part) for part in content
            )
        if not isinstance(content, str):
            raise TranscriptError(f"turn {index} has a content field that is not text")

        content = content.strip()
        if not content:
            notes.append(f"turn {index} had no content and was skipped")
            continue

        turns.append(ParsedTurn(normalise_role(str(item["role"])), content, len(turns)))

    if not turns:
        raise TranscriptError("JSON transcript contained no turns with content")
    return ParsedTranscript(turns, notes)


def _parse_marked_text(text: str) -> ParsedTranscript:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    matches = list(_MARKER.finditer(text))

    if not matches:
        raise TranscriptError(
            "no speaker markers found. A transcript needs lines beginning 'User:' or "
            "'Assistant:' (or Human/AI/Claude/ChatGPT), or a JSON list of "
            "{role, content} objects. Refusing rather than storing the whole paste as a "
            "single turn."
        )

    notes: list[str] = []

    preamble = text[: matches[0].start()].strip()
    if preamble:
        if len(preamble) > MAX_PREAMBLE_CHARS:
            raise TranscriptError(
                f"{len(preamble)} characters appear before the first speaker marker. That "
                "usually means the format was misread. Trim the header, or paste as JSON."
            )
        notes.append(f"ignored {len(preamble)} characters before the first speaker marker")

    turns: list[ParsedTurn] = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        content = text[match.end() : end].strip()
        role = normalise_role(match.group(1))

        if not content:
            notes.append(f"a '{match.group(1)}' marker at character {match.start()} had no content")
            continue

        turns.append(ParsedTurn(role, content, len(turns)))

    if not turns:
        raise TranscriptError("every speaker marker in the transcript was followed by nothing")
    return ParsedTranscript(turns, notes)
