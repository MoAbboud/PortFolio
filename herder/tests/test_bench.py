"""The benchmark's pure parts: the fact list format, the scoring, and the generated corpus."""

from __future__ import annotations

import json

import pytest

from bench import facts as F
from bench.metrics import Judged, Rate, score


def judged(truth: str, verdict: str, kind: str = "decision", fact_id: str = "f1") -> Judged:
    return Judged("c", "coding", "herder", fact_id, kind, truth, verdict)


# ------------------------------------------------------------------ scoring


def test_recall_counts_true_facts_judged_true() -> None:
    result = score([judged("true", "true"), judged("true", "not_stated"), judged("true", "false")])
    assert (result.recall.hits, result.recall.total) == (1, 3)
    assert (result.contradiction.hits, result.contradiction.total) == (1, 3)


def test_hallucination_is_a_false_fact_carried_forward_as_true() -> None:
    """A proposal the user turned down, or a reversed decision, read back as settled."""
    result = score([judged("false", "true"), judged("false", "false"), judged("false", "not_stated")])
    assert (result.hallucination.hits, result.hallucination.total) == (1, 3)


def test_a_reader_error_is_counted_and_left_out_of_every_rate() -> None:
    result = score([judged("true", "true"), judged("true", "error")])
    assert result.recall.total == 1
    assert result.errors == 1


def test_every_rate_prints_its_count() -> None:
    """Eight conversations is a small corpus; a percentage without its count hides that."""
    assert str(Rate(21, 30)) == "0.70 (21 of 30)"
    assert str(Rate(0, 0)) == "- (0 facts)"


def test_recall_is_reported_per_kind() -> None:
    result = score([judged("true", "true", "constraint"), judged("true", "not_stated", "fact")])
    assert result.by_kind["constraint"].value == 1.0
    assert result.by_kind["fact"].value == 0.0


# ------------------------------------------------------------------ the fact list


def test_turn_numbers_parse_and_refuse_nonsense() -> None:
    assert F.parse_turns("12, 40 41 12") == [12, 40, 41]
    with pytest.raises(F.FactError):
        F.parse_turns("12, forty")


def test_a_fact_is_validated_before_it_is_saved() -> None:
    F.validate(F.Fact("f001", "The service uses SQLite.", "decision", "true", [3]), turn_count=10)
    for bad in (
        F.Fact("f001", "  ", "decision", "true"),
        F.Fact("f001", "x", "opinion", "true"),
        F.Fact("f001", "x", "decision", "maybe"),
        F.Fact("f001", "x", "decision", "true", [11]),
    ):
        with pytest.raises(F.FactError):
            F.validate(bad, turn_count=10)


def test_facts_round_trip_through_the_file(tmp_path) -> None:
    (tmp_path / "demo").mkdir()
    facts = F.FactList("demo", [F.Fact("f001", "Money is Decimal.", "constraint", "true", [4], "said twice")])
    F.save(tmp_path, facts)
    again = F.load(tmp_path, "demo")
    assert again.facts == facts.facts
    assert not (tmp_path / "demo" / "facts.json.tmp").exists()


def test_ids_keep_counting_after_a_deletion() -> None:
    facts = F.FactList("demo", [F.Fact("f001", "a", "fact", "true"), F.Fact("f003", "b", "fact", "true")])
    assert F.next_id(facts) == "f004"


# ------------------------------------------------------------------ the generated corpus


def test_the_corpus_is_eight_conversations_two_per_archetype_in_range() -> None:
    from bench.generate import DATASETS, MAX_TOKENS, MIN_TOKENS

    metas = [json.loads((d / "meta.json").read_text(encoding="utf-8")) for d in sorted(DATASETS.iterdir()) if (d / "meta.json").exists()]
    assert len(metas) == 8
    archetypes = [m["archetype"] for m in metas]
    for archetype in ("coding", "research", "planning", "handover"):
        assert archetypes.count(archetype) == 2
    assert all(MIN_TOKENS <= m["tokens"] <= MAX_TOKENS for m in metas)


def test_the_generator_writes_no_answer_key() -> None:
    """The fact lists are written by a person. A manifest of what was planted would be an
    answer key one step from being copied."""
    from bench.generate import DATASETS

    for folder in DATASETS.iterdir():
        assert not (folder / "manifest.json").exists()


def test_the_benchmark_conversations_are_not_the_stage_4_ones() -> None:
    """The heuristic was tuned on stage 4's phrasings; grading it on them would flatter it."""
    from pathlib import Path

    from bench.generate import DATASETS

    stage4 = Path(__file__).resolve().parents[1] / "corpus"
    old = {line for f in stage4.glob("*.txt") for line in f.read_text(encoding="utf-8").splitlines() if len(line) > 40}
    new = {line for d in DATASETS.iterdir() if (d / "conversation.txt").exists()
           for line in (d / "conversation.txt").read_text(encoding="utf-8").splitlines() if len(line) > 40}
    assert not (old & new)
