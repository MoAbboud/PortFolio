"""The heuristic extractor. Pure, no model, no network.

The most important test in this file is the one asserting that assistant turns are ignored.
A conversation with a chatbot is mostly the chatbot talking, and an extractor that treats
assistant output as fact fills the memory with suggestions the user read and rejected - which
is worse than forgetting them, because they get handed back later as established fact.
"""

from __future__ import annotations

import pytest

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
    assert outcome.model == "rules-v2"
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


# ============================================= found by the stage 4 corpus run, 2026-09-12


def test_a_refusal_whose_referent_is_a_pronoun_is_not_extracted() -> None:
    """Thirteen entries like this reached real briefs in the stage 4 run.

    The main clause's subject is "that", which points at the assistant turn this extractor
    deliberately never reads. A reader of the brief learns something was refused and has no
    way to find out what, which is noise with the shape of a constraint.
    """
    outcome = run(
        ("user", "Not for item 69 - that is a service I would have to explain in an interview for no gain.")
    )
    assert outcome.candidates == []


def test_a_refusal_with_a_leading_no_is_also_caught() -> None:
    outcome = run(("user", "No. Not for item 2 - that is a service I would have to explain for no gain."))
    assert outcome.candidates == []


def test_would_rather_not_with_nothing_preferred_is_not_a_preference() -> None:
    """It matched on "i would rather" and became a stated preference with nothing in it."""
    outcome = run(("user", "I would rather not, thanks. Let us leave it there for now."))
    assert [c.kind for c in outcome.candidates] == []


def test_would_rather_not_WITH_a_complement_survives() -> None:
    """The guard has to be narrow: this one names what is being refused."""
    outcome = run(("user", "I would rather not use Redis for the queue at any point."))
    assert kinds(outcome) == ["preference"]


def test_a_stated_preference_with_a_than_clause_survives() -> None:
    outcome = run(("user", "I would rather have a loud failure than a silent fallback."))
    assert kinds(outcome) == ["preference"]


def test_a_constraint_opening_with_it_is_survives() -> None:
    """"It is never acceptable..." is not a refusal opening, so the anaphor guard must not
    fire on it - the sentence carries its own content."""
    outcome = run(("user", "It is never acceptable to use floats for money in this system."))
    assert kinds(outcome) == ["constraint"]


def test_a_demonstrative_followed_by_a_noun_survives() -> None:
    """"That approach" is resolvable enough; "that is" is not."""
    outcome = run(("user", "That approach must never be used for the hosted demo."))
    assert kinds(outcome) == ["constraint"]


# ------------------------------------------------------------------ reversals (stage 10)


@pytest.mark.parametrize(
    "sentence",
    [
        "Scrap the rounding I mentioned earlier - keep stock exact to the gram.",
        "Change of plan on who gets the reorder email: it goes to both Marisol and the shop manager.",
        "Update the backup schedule I described earlier: the offsite drive is weekly now, not monthly.",
        "Correction on citation style - the department requires APA 7th, so Harvard is out.",
        "The June opening is off - builders cannot start until spring, so the target is September.",
        "We are switching from Postgres to MySQL after all.",
        "I am lowering the group size from earlier - at most three students per tutor.",
        "Forget the 10,000 words I mentioned before - the limit is 7,500.",
        "I have changed my mind about the schedule.",
    ],
)
def test_a_reversal_is_extracted(sentence: str) -> None:
    """The stage 9 baseline measured this: every false claim herder carried forward was a
    reversal, and the cause was that the sentence announcing the change matched no rule, so
    nothing was ever extracted to contradict the entry it replaced."""
    outcome = run(("user", sentence))
    assert outcome.candidates, f"nothing extracted from {sentence!r}"
    assert outcome.candidates[0].kind == "decision"


@pytest.mark.parametrize(
    "sentence",
    [
        "We are going with Postgres for production instead of SQLite.",
        "Stock quantities are never allowed to go negative.",
        "I prefer plain functions over classes.",
        "The chain has four shops and one central bakery.",
        "The deadline is earlier than we thought.",
    ],
)
def test_an_ordinary_sentence_is_not_called_a_reversal(sentence: str) -> None:
    outcome = run(("user", sentence))
    reversal = [c for c in outcome.candidates if c.confidence == 0.66]
    assert not reversal, f"{sentence!r} was read as a reversal"


# ------------------------------------------------- stage 10, attempt 3: sentences with no cue


@pytest.mark.parametrize(
    "sentence",
    ["No database.", "No franchising.", "Nothing leaves the office network.", "Nobody gets local admin rights.",
     "Only peer-reviewed sources count."],
)
def test_a_prohibition_carried_by_its_determiner_is_a_constraint(sentence: str) -> None:
    """Including the short ones: "No franchising." is under the 20-character floor and is a
    whole constraint."""
    outcome = run(("user", sentence))
    assert kinds(outcome) == ["constraint"]


@pytest.mark.parametrize("sentence", ["No thanks.", "No problem at all.", "No, the limit stays as it is."])
def test_no_as_an_answer_or_a_stock_phrase_is_not_a_prohibition(sentence: str) -> None:
    outcome = run(("user", sentence))
    assert "constraint" not in kinds(outcome)


def test_a_negated_verb_is_a_constraint_only_with_its_verb() -> None:
    assert kinds(run(("user", "Support doesn't answer billing tickets at all."))) == ["constraint"]
    trailing = run(("user", "It looks fine right up until the day it does not."))
    assert "constraint" not in kinds(trailing)


@pytest.mark.parametrize(
    "sentence",
    [
        "The thesis is due in May.",
        "Duplicates are detected by a hash of the file contents.",
        "Opening hours will be 7am to 4pm, seven days a week.",
        "I'm building the inventory service for a bakery chain.",
    ],
)
def test_a_plain_statement_is_a_fact(sentence: str) -> None:
    outcome = run(("user", sentence))
    assert kinds(outcome) == ["fact"]
    assert outcome.candidates[0].layer == "project"


@pytest.mark.parametrize(
    "sentence",
    [
        "Is the thesis due in May?",                        # a question
        "Can you explain how the hash is computed?",         # a request
        "That's fine by me for the moment.",                # a pronoun pointing at the assistant
        "Here is the compose file as it stands today:",     # introduces pasted material
        "A short answer is fine for this one.",             # about the reply, not memory
        "I'm wondering whether the schedule is right.",     # musing, not a statement
        "I want to understand the boundary rather than be told it is handled.",  # a request
    ],
)
def test_what_is_not_a_plain_statement(sentence: str) -> None:
    assert "fact" not in kinds(run(("user", sentence)))


def test_no_benchmark_generator_lead_in_carries_signal_on_its_own() -> None:
    """Attempt 3 was bound by one rule, chosen by the author: **general English only, never the
    benchmark generator's phrasing.** The generator wraps planted claims in fixed lead-ins
    ("Final answer on that one:", "Non-negotiable:"), and a rule keyed on them would raise the
    score by memorising the generator rather than reading conversations.

    Each lead-in is wrapped around a clause that matches nothing by itself. If the wrapped
    sentence matches, the lead-in is the signal. The few allowed matches come from cue words
    written at stage 2 (2026-09-08), before the generator existed (2026-09-13).
    """
    from bench import generate as G

    neutral_l, neutral_s = "the blue folder sits by the door", "The blue folder sits by the door."
    assert run(("user", neutral_s)).candidates == []

    pre_existing = {"Okay, that's decided: {l}", "Let's settle it - {l}", "Going with this: {l}", "{s} Let's park it for now."}
    wraps = G.DECISION_WRAPS + G.CONSTRAINT_WRAPS + G.PREFERENCE_WRAPS + G.FACT_WRAPS + G.THREAD_WRAPS
    carrying = [
        wrap for wrap in wraps
        if wrap not in pre_existing and run(("user", wrap.format(l=neutral_l, s=neutral_s))).candidates
    ]
    assert carrying == []
