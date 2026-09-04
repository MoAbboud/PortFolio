"""The corpus reader: the eleven documents, run and compared, inside the repository.

Every corpus figure quoted in `requirements/06-context.md` up to this point - "5 of 10",
"8 of 10", "9 of 10" - came from a script written for the occasion and thrown away. Three
separate sessions each wrote their own, and the one number that was never produced by a
script at all ("91 tests pass") is the one that turned out to be wrong. This module is that
script, kept.

**The comparison itself lives in `mailman/corpus_check.py`**, not here, because
`python -m mailman.corpus_check` scores every extractor against the same documents and two
implementations of "did this extractor get this document right" would drift - and the copy
that drifted would be the one reporting the numbers. This file is the regression test over
the deployed extractor; that module is the comparison. They share one answer key.

It is deliberately not the stage 8 harness. That reports per-field accuracy across thirty to
forty documents and records a baseline; this asserts that eleven known documents still come
out right.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from mailman.corpus import CASES, Case
from mailman.corpus_check import (
    KNOWN_GAPS,
    arithmetic_problems,
    document_text,
    field_problems,
    unknown_keys,
)
from mailman.extractor import ExtractionError
from mailman.heuristic import HeuristicExtractor

CORPUS_DIR = Path(__file__).resolve().parent.parent / "corpus"

EXTRACTING = [case for case in CASES if not case.should_fail]
REFUSING = [case for case in CASES if case.should_fail]


def _ids(cases: list[Case]) -> list[str]:
    return [case.name for case in cases]


def _extract(case: Case):
    text, page_count = document_text(case)
    return HeuristicExtractor().extract(text).fields, page_count


def test_every_expected_key_is_checkable() -> None:
    """A label that cannot be evaluated is not an assertion.

    This is the guard the corpus went three sessions without. `06-ambiguous-date` exists to
    prove the parser flags `03/04/2026` instead of quietly picking a reading, and its only
    statement of that was a key no comparison knew what to do with, on a case that carries no
    `issue_date` label either. It could not fail on its own subject.
    """
    unknown = unknown_keys()
    assert not unknown, (
        "expected keys with no entry in CHECKS: " + ", ".join(unknown) + ". "
        "Add the key with how it is measured, or take it out of the label - a key nothing "
        "evaluates reads as a passing assertion."
    )


@pytest.mark.parametrize("case", EXTRACTING, ids=_ids(EXTRACTING))
def test_case_extracts_every_expected_field(case: Case) -> None:
    """Compare every key in `expected`, not the ones a run happens to print."""
    fields, page_count = _extract(case)
    wrong = field_problems(case, fields, page_count)
    assert not wrong, f"{case.name} ({case.tests})\n  " + "\n  ".join(wrong)


@pytest.mark.parametrize("case", EXTRACTING, ids=_ids(EXTRACTING))
def test_case_adds_up(case: Case) -> None:
    """Each document against its own arithmetic. No labels involved.

    This is the check that needs nothing to be right about the answer key, so it survives a
    label that is wrong and a document that contradicts itself. Both of those have happened
    here, and this is what found them.
    """
    fields, _ = _extract(case)
    wrong = arithmetic_problems(fields)
    assert not wrong, f"{case.name} ({case.tests})\n  " + "\n  ".join(wrong)


@pytest.mark.parametrize("case", REFUSING, ids=_ids(REFUSING))
def test_case_is_refused(case: Case) -> None:
    """A corpus of documents that should all succeed cannot measure refusal.

    The `expected` block on a refusing case says which fields are absent, and those are
    checked against the read carried on the error rather than discarded - a refusal that
    happened for the wrong reason is not the behaviour being asserted.
    """
    text, _ = document_text(case)

    with pytest.raises(ExtractionError) as raised:
        HeuristicExtractor().extract(text)

    read = raised.value.raw["read"]
    still_found = {
        key: read.get(key)
        for key, value in case.expected.items()
        if value is None and read.get(key) is not None
    }
    assert not still_found, (
        f"{case.name} was refused, but it still produced {still_found} - "
        "the label says those fields are not in the document"
    )


def test_known_gaps_are_still_gaps() -> None:
    """A known gap that has closed should be deleted, not left as a silent exemption.

    `KNOWN_GAPS` exempts `01-clean`'s `buyer_name` because the heuristic does not attempt a
    buyer. If something ever makes it attempt one, this fails and the entry comes out -
    otherwise the exemption outlives the reason for it, which is how a suppressed failure
    becomes permanent.
    """
    for name, key in sorted(KNOWN_GAPS):
        case = next(c for c in CASES if c.name == name)
        fields, page_count = _extract(case)
        problems = field_problems(case, fields, page_count, apply_known_gaps=False)
        assert any(p.startswith(f"{key}:") for p in problems), (
            f"{name}.{key} is listed in KNOWN_GAPS but now passes. Remove the entry."
        )


@pytest.mark.parametrize("case", CASES, ids=_ids(CASES))
def test_files_on_disk_match_the_generator(case: Case) -> None:
    """`corpus/` is a build artefact of `corpus.py`, and a stale one is invisible.

    Everything above runs against freshly generated bytes, so a corpus directory that has
    drifted would never show up there - and the labels beside those PDFs are what the stage 8
    harness will read. Both halves are compared, because regenerating a PDF without its
    labels, or the reverse, is the shape a hand-edited answer key takes.
    """
    pdf_path = CORPUS_DIR / f"{case.name}.pdf"
    labels_path = CORPUS_DIR / f"{case.name}.labels.json"

    if not pdf_path.exists() or not labels_path.exists():
        pytest.skip(f"{case.name} not written to {CORPUS_DIR}; run python -m mailman.corpus")

    assert pdf_path.read_bytes() == case.pdf(), (
        f"{pdf_path.name} differs from what corpus.py produces - regenerate with "
        "python -m mailman.corpus"
    )

    on_disk = json.loads(labels_path.read_text(encoding="utf-8"))
    assert on_disk["expected"] == json.loads(json.dumps(case.expected)), (
        f"{labels_path.name} differs from the expected block in corpus.py - regenerate with "
        "python -m mailman.corpus"
    )
    assert on_disk["should_fail"] == case.should_fail


def test_the_hybrid_falls_back_to_the_heuristic_without_weights() -> None:
    """The deployed path has to work with no model on disk.

    The weights are 250MB, gitignored, and will not fit a free hosting tier, so `hybrid` has
    to behave exactly as `heuristic` when they are absent rather than raising. If this ever
    fails, the demo goes down the moment it is deployed somewhere without the model.
    """
    from mailman.hybrid import HybridExtractor

    case = next(c for c in CASES if c.name == "01-clean")
    text, page_count = document_text(case)

    hybrid = HybridExtractor(model_dir="./models/definitely-not-here")
    assert hybrid.trained is None
    assert hybrid.model_name == "hybrid:heuristic-only"

    fields = hybrid.extract(text).fields
    assert not field_problems(case, fields, page_count)   # known gaps applied: buyer stays null
    assert fields.buyer_name is None
