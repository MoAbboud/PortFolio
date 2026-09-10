"""The heuristic extractor. Pure, no model, no network.

The most important test in this file is the one asserting that assistant turns are ignored.
A conversation with a chatbot is mostly the chatbot talking, and an extractor that treats
assistant output as fact fills the memory with suggestions the user read and rejected - which
is worse than forgetting them, because they get handed back later as established fact.
"""

from __future__ import annotations

from herder.core.ids import uuid7
from herder.domain.chunking import Chunk, ChunkMessage
from herder.extractors.heuristic import HeuristicExtractor


def chunk_of(*turns: tuple[str, str]) -> Chunk:
    messages = tuple(
        ChunkMessage(id=uuid7(), role=role, content=content, token_count=len(content) // 4 + 1)
        for role, content in turns
    )
    return Chunk(messages, sum(m.token_count for m in messages))


def run(*turns: tuple[str, str], titles: list[str] | None = None):
    return HeuristicExtractor().extract(chunk_of(*turns), titles or [])


def kinds(outcome) -> list[str]:
    return [c.kind for c in outcome.candidates]


def test_the_assistants_suggestions_are_never_extracted() -> None:
    """The rule that outranks every other rule."""
    outcome = run(
        ("assistant", "You could use Redis for the queue, and you must always shard the database."),
        ("user", "Thanks, I'll think about it."),
    )
    assert outcome.candidates == []


def test_a_user_constraint_is_extracted() -> None:
    outcome = run(("user", "Amounts must never be floats anywhere in this system."))
    assert kinds(outcome) == ["constraint"]
    assert outcome.candidates[0].layer == "project"


def test_a_user_decision_is_extracted() -> None:
    outcome = run(("user", "We are going with Postgres for production instead of SQLite."))
    assert kinds(outcome) == ["decision"]


def test_a_constraint_outranks_a_decision_when_both_match() -> None:
    """"We will never use X" is a constraint wearing a decision's clothes."""
    outcome = run(("user", "We will never use a message broker in this project."))
    assert kinds(outcome) == ["constraint"]


def test_a_preference_lands_in_the_stable_layer() -> None:
    outcome = run(("user", "I prefer short answers with no preamble at the start."))
    assert kinds(outcome) == ["preference"]
    assert outcome.candidates[0].layer == "stable"


def test_identity_lands_in_the_stable_layer() -> None:
    outcome = run(("user", "I work on a Windows machine and I test everything from PowerShell."))
    assert outcome.candidates[0].layer == "stable"


def test_an_open_thread_lands_in_the_session_layer() -> None:
    outcome = run(("user", "We still need to pick the confidence threshold before shipping."))
    assert kinds(outcome) == ["open_thread"]
    assert outcome.candidates[0].layer == "session"


def test_chatter_produces_nothing() -> None:
    """An empty answer is a correct answer, and much better than an invented one."""
    outcome = run(("user", "Thanks, that looks good to me overall."))
    assert outcome.candidates == []


def test_every_candidate_carries_lineage_to_its_own_message() -> None:
    chunk = chunk_of(
        ("user", "We are going with Postgres for production instead of SQLite."),
        ("user", "Amounts must never be floats anywhere in this system."),
    )
    outcome = HeuristicExtractor().extract(chunk, [])

    assert len(outcome.candidates) == 2
    for candidate in outcome.candidates:
        assert len(candidate.lineage) == 1
        assert candidate.lineage[0] in {str(i) for i in chunk.message_ids}


def test_titles_are_capped_and_cut_at_a_word_boundary() -> None:
    long = "We are going with " + "a very long deliberate justification " * 6
    outcome = run(("user", long))
    title = outcome.candidates[0].title
    assert len(title) <= 80
    assert not title.endswith(" ")
    # Cut between words, not through one.
    assert long.startswith(title)


def test_a_title_already_known_is_not_repeated() -> None:
    sentence = "We are going with Postgres for production instead of SQLite."
    first = run(("user", sentence))
    again = run(("user", sentence), titles=[first.candidates[0].text])
    assert again.candidates == []


def test_the_same_sentence_twice_in_one_chunk_is_extracted_once() -> None:
    sentence = "Amounts must never be floats anywhere in this system."
    outcome = run(("user", sentence), ("user", sentence))
    assert len(outcome.candidates) == 1


def test_a_code_block_is_not_split_into_sentences() -> None:
    code = "```python\ndef f():\n    return {'a': 1}\n```"
    outcome = run(("user", f"Here is the code. {code} We must always keep it in domain/."))
    assert kinds(outcome) == ["constraint"]


def test_short_fragments_are_ignored() -> None:
    outcome = run(("user", "we will."))
    assert outcome.candidates == []


def test_it_reports_itself_and_costs_no_model_tokens() -> None:
    outcome = run(("user", "We are going with Postgres for production instead of SQLite."))
    assert outcome.model == "rules-v1"
    assert outcome.output_tokens == 0
    assert outcome.failed is False
    # No inference happened, so there is no prompt/generation split to report.
    assert outcome.prompt_ms == 0 and outcome.generation_ms == 0


# --------------------------------------------------------------- bugs found by reading output


def test_a_content_free_rejection_is_not_extracted() -> None:
    """"I don't want that either" matched the obligation rule and became a constraint.

    It tells a later reader nothing: "that" refers to something in the assistant turn, which
    this extractor deliberately never reads, so the reference is unresolvable by construction.
    An entry like that is pure noise in a brief.
    """
    outcome = run(("user", "I don't want that either, it adds nothing to the design."))
    assert [c.kind for c in outcome.candidates] == []


def test_a_rejection_that_names_what_it_rejects_is_still_extracted() -> None:
    """The guard has to be narrow. This one carries real content and is a real constraint."""
    outcome = run(("user", "I don't want the Redis queue anywhere near production."))
    assert kinds(outcome) == ["constraint"]


def test_identity_outranks_an_obligation_in_the_same_sentence() -> None:
    """Recorded as a constraint because of "has to", which put a durable fact about the
    user into the project layer, where session and project entries expire.

    A sentence-level extractor has to pick one, and identity is the half that outlives the
    project. A first-person self-description is also a far more specific signal than a modal
    verb, and specific should outrank generic.
    """
    outcome = run(
        ("user", "I work on a Windows machine and test everything from PowerShell, "
                 "so every stage has to be checkable there.")
    )
    assert kinds(outcome) == ["identity"]
    assert outcome.candidates[0].layer == "stable"


def test_a_constraint_with_no_identity_marker_is_still_a_constraint() -> None:
    """The reorder must not swallow ordinary constraints."""
    outcome = run(("user", "Every stage has to be checkable from a terminal."))
    assert kinds(outcome) == ["constraint"]


def test_an_explicit_open_thread_still_outranks_an_obligation() -> None:
    """The earlier fix of the same shape, kept under test after the reorder."""
    outcome = run(("user", "We still need to pick the confidence threshold before shipping."))
    assert kinds(outcome) == ["open_thread"]
