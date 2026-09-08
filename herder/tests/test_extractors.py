"""The registry, lineage validation, and prompt versioning. Pure.

The real model is never loaded here. A suite that needs several gigabytes of weights is a
suite that stops being run, and a suite that stops being run is worth nothing.
"""

from __future__ import annotations

import pytest

from herder.core.ids import uuid7
from herder.domain.chunking import Chunk, ChunkMessage
from herder.extractors import get_extractor
from herder.extractors.base import ExtractorUnavailable, make_title, validate_lineage
from herder.prompts import PromptError, load_prompt
from herder.schemas.extraction import Candidate, CandidateList


def a_chunk(count: int = 2) -> Chunk:
    messages = tuple(
        ChunkMessage(id=uuid7(), role="user", content=f"turn {i}", token_count=5) for i in range(count)
    )
    return Chunk(messages, 5 * count)


def candidate(**kwargs) -> Candidate:
    base = {
        "layer": "project",
        "kind": "decision",
        "title": "a title",
        "text": "some text",
        "lineage": [],
        "confidence": 0.8,
    }
    return Candidate(**{**base, **kwargs})


# ------------------------------------------------------------------ the registry


def test_the_default_comes_from_settings() -> None:
    assert get_extractor().name == "heuristic"


def test_an_unknown_extractor_is_an_error() -> None:
    """Never a silent default. A typo would make every later number a lie."""
    with pytest.raises(ValueError) as exc:
        get_extractor("gpt-4")
    assert "heuristic" in str(exc.value)


def test_trained_says_it_is_stage_ten_rather_than_pretending() -> None:
    with pytest.raises(ExtractorUnavailable) as exc:
        get_extractor("trained")
    assert "stage 10" in str(exc.value)


def test_the_heuristic_needs_nothing_to_be_ready() -> None:
    get_extractor("heuristic").check_ready()


# ------------------------------------------------------------------ lineage


def test_a_candidate_citing_a_real_message_is_kept() -> None:
    chunk = a_chunk()
    real = str(next(iter(chunk.message_ids)))
    kept, invented, empty = validate_lineage([candidate(lineage=[real])], chunk)
    assert len(kept) == 1 and (invented, empty) == (0, 0)


def test_an_invented_id_is_dropped_and_counted() -> None:
    """The one failure that cannot be tolerated: the audit trail is the product."""
    kept, invented, empty = validate_lineage([candidate(lineage=[str(uuid7())])], a_chunk())
    assert kept == [] and invented == 1 and empty == 0


def test_empty_lineage_is_dropped_and_counted() -> None:
    """An entry that cannot say where it came from is an unsupported claim."""
    kept, invented, empty = validate_lineage([candidate(lineage=[])], a_chunk())
    assert kept == [] and empty == 1 and invented == 0


def test_partly_invented_lineage_keeps_only_the_real_citations() -> None:
    chunk = a_chunk()
    real = str(next(iter(chunk.message_ids)))
    fake = str(uuid7())
    kept, invented, empty = validate_lineage([candidate(lineage=[real, fake])], chunk)

    assert len(kept) == 1
    assert kept[0].lineage == [real]
    assert (invented, empty) == (0, 0)


def test_blank_strings_count_as_empty_not_as_invented() -> None:
    kept, invented, empty = validate_lineage([candidate(lineage=["", "  "])], a_chunk())
    assert kept == [] and empty == 1 and invented == 0


# ------------------------------------------------------------------ prompts


def test_the_extraction_prompt_loads_with_a_version() -> None:
    body, version = load_prompt("extract.md")
    assert version == "1"
    assert body


def test_the_prompt_leads_with_the_rule_that_outranks_everything() -> None:
    """If this ever stops being first, the extractor will start recording rejected ideas."""
    body, _ = load_prompt("extract.md")
    head = body[:1200].lower()
    assert "only what the user said" in head


def test_the_prompt_carries_three_worked_examples() -> None:
    body, _ = load_prompt("extract.md")
    for kind in ("decision", "code_state", "open_thread"):
        assert kind in body
    assert body.count("Output:") >= 3


def test_a_prompt_without_a_version_header_is_refused(tmp_path, monkeypatch) -> None:
    """A result produced by an unversioned prompt cannot be attributed to a version of it."""
    from herder import prompts

    bad = tmp_path / "nope.md"
    bad.write_text("no header here", encoding="utf-8")
    monkeypatch.setattr(prompts, "PROMPTS", tmp_path)
    prompts.load_prompt.cache_clear()

    with pytest.raises(PromptError) as exc:
        load_prompt("nope.md")
    assert "version" in str(exc.value)
    prompts.load_prompt.cache_clear()


# ------------------------------------------------------------------ the schema


def test_the_candidate_schema_generates_a_json_schema_for_decoding() -> None:
    """One definition, used as the decoding grammar and as the parse target."""
    schema = CandidateList.model_json_schema()
    assert schema["type"] == "object"
    assert "entries" in schema["properties"]


def test_a_blank_title_is_rejected() -> None:
    with pytest.raises(ValueError):
        candidate(title="   ")


def test_an_over_long_title_is_rejected() -> None:
    with pytest.raises(ValueError):
        candidate(title="x" * 81)


def test_confidence_is_bounded() -> None:
    with pytest.raises(ValueError):
        candidate(confidence=1.4)


def test_make_title_trims_trailing_punctuation() -> None:
    assert make_title("We are using Postgres.") == "We are using Postgres"
