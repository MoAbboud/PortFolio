"""The transcript parser. Pure, no database.

The behaviour that matters most is the refusal. A transcript that is not understood must not
become one enormous turn: it would sail through ingest, chunk into nonsense, and produce a
brief built on a parse failure nobody was told about.
"""

from __future__ import annotations

import json

import pytest

from herder.domain.transcript import TranscriptError, parse_transcript


def test_plain_user_assistant() -> None:
    parsed = parse_transcript("User: what is the plan?\nAssistant: ship stage one.")
    assert [(t.role, t.content) for t in parsed.turns] == [
        ("user", "what is the plan?"),
        ("assistant", "ship stage one."),
    ]
    assert [t.position for t in parsed.turns] == [0, 1]


@pytest.mark.parametrize(
    "text",
    [
        "Human: hi\nAI: hello",
        "**User:** hi\n**Assistant:** hello",
        "### User: hi\n### Assistant: hello",
        "You: hi\nClaude: hello",
        "user: hi\nCHATGPT: hello",
    ],
)
def test_the_labels_people_actually_use(text: str) -> None:
    parsed = parse_transcript(text)
    assert [t.role for t in parsed.turns] == ["user", "assistant"]


def test_refuses_a_transcript_with_no_markers() -> None:
    with pytest.raises(TranscriptError) as exc:
        parse_transcript("just some prose about a project, with no speakers at all")
    assert "no speaker markers" in str(exc.value)
    # The reason has to be actionable, not just a refusal.
    assert "User:" in str(exc.value)


def test_refuses_an_empty_transcript() -> None:
    with pytest.raises(TranscriptError):
        parse_transcript("   \n\n  ")


def test_a_short_header_is_dropped_but_reported() -> None:
    parsed = parse_transcript("Conversation with Claude, 3 January\n\nUser: hi\nAssistant: hello")
    assert len(parsed.turns) == 2
    assert any("before the first speaker marker" in n for n in parsed.notes)


def test_a_long_preamble_is_refused_rather_than_dropped() -> None:
    """Dropping three paragraphs silently is how a brief ends up missing its beginning."""
    with pytest.raises(TranscriptError) as exc:
        parse_transcript("x" * 500 + "\nUser: hi\nAssistant: hello")
    assert "before the first speaker marker" in str(exc.value)


def test_a_mid_sentence_colon_does_not_split_a_turn() -> None:
    """The marker only matches at the start of a line, and this is why."""
    text = "User: here is the thing: it has a colon in it\nAssistant: noted"
    parsed = parse_transcript(text)
    assert len(parsed.turns) == 2
    assert parsed.turns[0].content == "here is the thing: it has a colon in it"


def test_a_code_block_survives_intact() -> None:
    """A parser that shredded code would silently destroy the most valuable turns."""
    code = 'def f():\n    d = {"a": 1}\n    print(f"a: {d}")\n    return d'
    parsed = parse_transcript(f"User: fix this\n```python\n{code}\n```\nAssistant: done")
    assert code in parsed.turns[0].content
    assert len(parsed.turns) == 2


def test_consecutive_same_role_turns_stay_separate() -> None:
    parsed = parse_transcript("User: one\nUser: two\nAssistant: three")
    assert [t.role for t in parsed.turns] == ["user", "user", "assistant"]


def test_a_marker_with_nothing_after_it_is_skipped_and_noted() -> None:
    parsed = parse_transcript("User: hi\nAssistant:\nUser: still there?")
    assert len(parsed.turns) == 2
    assert any("had no content" in n for n in parsed.notes)


def test_json_list_of_turns() -> None:
    raw = json.dumps([{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"}])
    parsed = parse_transcript(raw)
    assert [(t.role, t.content) for t in parsed.turns] == [("user", "hi"), ("assistant", "hello")]


def test_json_object_with_messages() -> None:
    raw = json.dumps({"messages": [{"role": "user", "content": "hi"}]})
    assert parse_transcript(raw).turns[0].content == "hi"


def test_json_content_as_parts() -> None:
    """Some exports carry content as a list of blocks rather than a string."""
    raw = json.dumps([{"role": "user", "content": [{"text": "one"}, {"text": "two"}]}])
    assert parse_transcript(raw).turns[0].content == "one\ntwo"


def test_json_object_without_messages_is_refused_with_a_reason() -> None:
    with pytest.raises(TranscriptError) as exc:
        parse_transcript(json.dumps({"conversation_title": "x", "created": 1}))
    assert "messages" in str(exc.value)


def test_text_that_merely_starts_with_a_brace_still_parses() -> None:
    """A transcript may legitimately open with a code block. Failing JSON is not fatal."""
    parsed = parse_transcript('{ not json at all\nUser: hi\nAssistant: hello')
    assert len(parsed.turns) == 2


def test_unknown_role_in_json_is_refused() -> None:
    with pytest.raises(TranscriptError):
        parse_transcript(json.dumps([{"role": "narrator", "content": "hi"}]))


# --------------------------------------------------------------- bug fixed 2026-09-11


def test_a_config_block_inside_a_turn_is_not_shredded() -> None:
    """`q` and `a` were case-insensitive speaker roles, so any line beginning `a:` split
    the turn. A pasted config block became four turns, with "1" attributed to the assistant
    and lineage pointing at turns nobody ever said.
    """
    parsed = parse_transcript(
        "User: here is the config we settled on\n"
        "a: 1\n"
        "q: 2\n"
        "port: 5432\n"
        "That is the whole thing.\n"
        "Assistant: noted."
    )

    assert len(parsed.turns) == 2
    assert parsed.turns[0].role == "user"
    assert "a: 1" in parsed.turns[0].content
    assert "port: 5432" in parsed.turns[0].content
    assert parsed.turns[1].role == "assistant"


def test_uppercase_q_and_a_are_still_speakers() -> None:
    """The fix keeps genuine Q&A transcripts working; only the lower-case forms went."""
    parsed = parse_transcript("Q: what is the budget?\nA: three thousand tokens.")
    assert [(t.role, t.content) for t in parsed.turns] == [
        ("user", "what is the budget?"),
        ("assistant", "three thousand tokens."),
    ]


def test_a_lowercase_single_letter_is_not_a_speaker() -> None:
    """With no other marker present this refuses rather than inventing turns."""
    with pytest.raises(TranscriptError):
        parse_transcript("a: 1\nq: 2\nport: 5432")


def test_multi_character_labels_stay_case_insensitive() -> None:
    parsed = parse_transcript("human: hi\nCLAUDE: hello\nUsEr: again")
    assert [t.role for t in parsed.turns] == ["user", "assistant", "user"]
