"""Splitting new messages into chunks for extraction. Pure.

One rule shapes this whole module: **a turn is never split.** A chunk boundary always falls
between messages.

Splitting mid-turn would cut code blocks in half and hand the extractor a fragment whose
meaning depends on text it cannot see - and worse, it would break lineage, because a
candidate could then cite a message id for content the model only saw half of. A single turn
larger than the target simply becomes an oversized chunk of its own. That is a real case
(somebody pastes a 20,000-token file into a chat) and the honest handling is to let the chunk
be large and record that it was, rather than to invent a boundary.

Chunk size is the biggest lever on how long a derive takes, because every chunk re-processes
the instructions, the worked examples and the existing entry titles. See the open question in
requirements/00-plan.md.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field


@dataclass(frozen=True)
class ChunkMessage:
    id: uuid.UUID
    role: str
    content: str
    token_count: int


@dataclass(frozen=True)
class Chunk:
    messages: tuple[ChunkMessage, ...]
    token_count: int
    # True when this chunk is a single turn that was already over the target on its own.
    # Recorded rather than hidden: it is the case most likely to strain a small model's
    # context, and a slow derive with one of these in it is explained rather than mysterious.
    oversized: bool = False

    @property
    def message_ids(self) -> frozenset[uuid.UUID]:
        return frozenset(m.id for m in self.messages)

    def render(self) -> str:
        """The chunk as the extractor sees it.

        Message ids are shown because the extractor is required to cite them, and lineage is
        checked against this exact set afterwards.
        """
        return "\n\n".join(f"[{m.id}] {m.role}:\n{m.content}" for m in self.messages)


def chunk_messages(messages: Sequence[ChunkMessage], target_tokens: int) -> list[Chunk]:
    """Group messages into chunks of about `target_tokens`, never splitting one."""
    if target_tokens < 1:
        raise ValueError("target_tokens must be positive")

    chunks: list[Chunk] = []
    current: list[ChunkMessage] = []
    running = 0

    for message in messages:
        if current and running + message.token_count > target_tokens:
            chunks.append(Chunk(tuple(current), running))
            current, running = [], 0

        current.append(message)
        running += message.token_count

        # A single turn already past the target closes the chunk immediately rather than
        # dragging the next turn over the line with it.
        if len(current) == 1 and running >= target_tokens:
            chunks.append(Chunk(tuple(current), running, oversized=True))
            current, running = [], 0

    if current:
        chunks.append(Chunk(tuple(current), running))

    return chunks
