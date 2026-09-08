"""Chunking. Pure.

The rule under test throughout: a turn is never split. Splitting mid-turn would cut code
blocks in half and break lineage, because a candidate could cite a message id for content
the model only saw part of.
"""

from __future__ import annotations

import pytest

from herder.core.ids import uuid7
from herder.domain.chunking import ChunkMessage, chunk_messages


def msg(tokens: int, role: str = "user", content: str = "x") -> ChunkMessage:
    return ChunkMessage(id=uuid7(), role=role, content=content, token_count=tokens)


def test_empty_input_makes_no_chunks() -> None:
    assert chunk_messages([], 100) == []


def test_everything_under_target_is_one_chunk() -> None:
    chunks = chunk_messages([msg(10), msg(20), msg(30)], 100)
    assert len(chunks) == 1
    assert chunks[0].token_count == 60
    assert len(chunks[0].messages) == 3


def test_it_splits_when_the_target_is_crossed() -> None:
    chunks = chunk_messages([msg(60), msg(60), msg(60)], 100)
    assert [c.token_count for c in chunks] == [60, 60, 60]


def test_it_packs_up_to_the_target() -> None:
    chunks = chunk_messages([msg(40), msg(40), msg(40)], 100)
    assert [c.token_count for c in chunks] == [80, 40]


def test_a_single_turn_larger_than_the_target_becomes_its_own_chunk() -> None:
    """Somebody pastes a 20,000-token file into a chat. This is that case.

    The honest handling is an oversized chunk that says it is oversized, not an invented
    boundary in the middle of somebody's file.
    """
    chunks = chunk_messages([msg(500)], 100)
    assert len(chunks) == 1
    assert chunks[0].oversized is True
    assert chunks[0].token_count == 500
    assert len(chunks[0].messages) == 1


def test_an_oversized_turn_does_not_drag_the_next_one_with_it() -> None:
    chunks = chunk_messages([msg(500), msg(10)], 100)
    assert len(chunks) == 2
    assert chunks[0].oversized is True
    assert chunks[1].token_count == 10
    assert chunks[1].oversized is False


def test_an_oversized_turn_in_the_middle_stands_alone() -> None:
    chunks = chunk_messages([msg(30), msg(500), msg(30)], 100)
    assert [c.token_count for c in chunks] == [30, 500, 30]
    assert [c.oversized for c in chunks] == [False, True, False]


def test_no_message_is_ever_lost_or_duplicated() -> None:
    messages = [msg(i * 7 % 90 + 1) for i in range(60)]
    chunks = chunk_messages(messages, 100)

    seen = [m for chunk in chunks for m in chunk.messages]
    assert seen == messages
    assert sum(c.token_count for c in chunks) == sum(m.token_count for m in messages)


def test_chunk_token_count_matches_its_messages() -> None:
    chunks = chunk_messages([msg(10), msg(20), msg(80), msg(5)], 100)
    for chunk in chunks:
        assert chunk.token_count == sum(m.token_count for m in chunk.messages)


def test_a_nonsense_target_is_an_error() -> None:
    with pytest.raises(ValueError):
        chunk_messages([msg(1)], 0)


def test_render_shows_ids_because_lineage_is_checked_against_them() -> None:
    a, b = msg(5, "user", "hello"), msg(5, "assistant", "hi")
    chunk = chunk_messages([a, b], 100)[0]
    rendered = chunk.render()

    assert str(a.id) in rendered
    assert str(b.id) in rendered
    assert "user:" in rendered and "assistant:" in rendered
    assert chunk.message_ids == frozenset({a.id, b.id})
