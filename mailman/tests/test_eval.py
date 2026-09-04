"""Stage 8: the harness. The comparison logic is the part to read carefully.

The plan calls this one of the two areas that has to reflect the author's own judgement, and
the reason is that a comparison which is too strict reports failures that are not failures,
while one that is too loose hides the failure that is. These tests pin both edges.
"""

from __future__ import annotations

from datetime import date

import pytest

from mailman import eval as harness
from mailman.corpus import CASES


# --- field kinds -------------------------------------------------------------------------


@pytest.mark.parametrize(
    "expected,actual",
    [("INV-2026-0042", "INV-2026-0042")],
)
def test_an_invoice_number_must_match_exactly(expected: str, actual: str) -> None:
    assert harness.same(expected, actual, harness.EXACT)


@pytest.mark.parametrize("actual", ["INV-2026-042", "inv-2026-0042", "INV 2026 0042"])
def test_an_invoice_number_that_differs_at_all_is_wrong(actual: str) -> None:
    """The one field where punctuation and case are the content, not noise."""
    assert not harness.same("INV-2026-0042", actual, harness.EXACT)


@pytest.mark.parametrize(
    "actual", ["ACME CORP LTD", "Acme Corp Ltd.", "acme  corp   ltd", "Acme Corp, Ltd"]
)
def test_a_vendor_name_is_compared_normalised(actual: str) -> None:
    """Scoring a name by string equality reports a full stop as an extraction failure."""
    assert harness.same("Acme Corp Ltd", actual, harness.NORMALISED)


def test_a_genuinely_different_vendor_is_still_wrong() -> None:
    assert not harness.same("Acme Corp Ltd", "Northgate Supplies", harness.NORMALISED)


def test_dates_compare_as_dates() -> None:
    assert harness.same("2026-08-14", date(2026, 8, 14).isoformat(), harness.DATE)
    assert not harness.same("2026-08-14", "2026-04-08", harness.DATE)


def test_amounts_compare_as_decimals_not_strings() -> None:
    """270.0 and 270.00 are the same amount, and a string comparison says otherwise."""
    assert harness.same("270.00", "270.0", harness.DECIMAL)
    assert harness.same("270.00", 270, harness.DECIMAL)
    assert not harness.same("270.00", "27.00", harness.DECIMAL)


def test_a_value_that_is_not_a_number_is_wrong_rather_than_an_error() -> None:
    """A harness that raises on bad input stops mid-corpus and reports nothing."""
    assert not harness.same("270.00", "not a number", harness.DECIMAL)


def test_both_absent_is_agreement_and_one_absent_is_not() -> None:
    """`07-no-due-date` exists to assert that a genuinely missing field reads as null."""
    assert harness.same(None, None, harness.DATE)
    assert not harness.same("2026-09-13", None, harness.DATE)
    assert not harness.same(None, "2026-09-13", harness.DATE)


# --- line items --------------------------------------------------------------------------


def _report() -> harness.Report:
    return harness.Report(label="t", extractor="t", prompt_version="t", rule_set=[],
                          started_at="now")


def test_line_items_are_matched_as_a_set_not_zipped() -> None:
    """Order is not guaranteed, and a document whose lines come back shuffled is not wrong."""
    report = _report()
    expected = [{"description": "Widget", "amount": "200.00"},
                {"description": "Freight", "amount": "25.00"}]
    actual = [{"description": "Freight", "amount": "25.00"},
              {"description": "Widget", "amount": "200.00"}]

    harness._match_lines(report, "doc", expected, actual)

    assert report.line_matched == 2
    assert report.line_recall == 1.0
    assert not report.wrong


def test_a_line_that_cannot_be_matched_is_a_recall_miss_not_four_wrong_fields() -> None:
    """When the matching itself fails, that has to be visible as itself.

    Reporting it as wrong amounts on a row that was never there would send the next fix after
    the amounts, which are fine.
    """
    report = _report()
    expected = [{"description": "Widget", "amount": "200.00"},
                {"description": "Freight", "amount": "25.00"}]
    actual = [{"description": "Widget", "amount": "200.00"}]

    harness._match_lines(report, "doc", expected, actual)

    assert report.line_matched == 1
    assert report.line_recall == 0.5
    assert report.line_precision == 1.0
    missing = [w for w in report.wrong if w.field == "line_items[missing]"]
    assert len(missing) == 1 and missing[0].expected == "Freight"


def test_an_invented_line_costs_precision() -> None:
    report = _report()
    harness._match_lines(
        report, "doc",
        [{"description": "Widget", "amount": "200.00"}],
        [{"description": "Widget", "amount": "200.00"},
         {"description": "03 09", "amount": "3.00"}],
    )
    assert report.line_recall == 1.0
    assert report.line_precision == 0.5
    assert any(w.field == "line_items[spurious]" for w in report.wrong)


# --- the honesty of the headline ---------------------------------------------------------


def test_refusing_a_document_counts_every_field_on_it_as_wrong() -> None:
    """**A system that refuses everything it finds hard would otherwise score 100%.**

    The first version of the harness skipped refusals, and the corpus reported 99.7% while
    producing nothing at all for twelve of thirty-four documents. Scoring a refusal as silence
    rewards refusing, which is the opposite of what this measures.
    """
    # 23-ag-2026-0164 is the one document still refused after stage 9 - its currency is a
    # bare euro symbol the extractor does not find. 14-wt-2026-018 was used here until stage
    # 9 taught the extractor `Our reference` and it stopped refusing.
    report = harness.run("test", cases=[c for c in CASES if c.name == "23-ag-2026-0164"])

    assert report.refused_wrongly == 1
    assert report.documents_scored == 1
    assert report.overall.total > 0, "a refused document still has fields to be wrong about"
    assert report.overall.right == 0


def test_an_unsupported_document_is_reported_separately_and_never_as_wrong() -> None:
    """The difference between "94%" and "94% on the 91% we accept" is the whole honesty."""
    report = harness.run("test", cases=[c for c in CASES if c.unsupported])

    assert len(report.unsupported) == 2
    assert report.documents_scored == 0
    assert report.overall.total == 0
    assert all(entry["reason"] for entry in report.unsupported), "each says why"


def test_a_run_records_what_produced_it() -> None:
    """Two runs cannot be compared without knowing what made them, which this project has
    now learned three times."""
    report = harness.run("test", cases=CASES[:1])
    data = report.as_dict()

    assert data["extractor"]
    assert data["prompt_version"]
    assert len(data["rule_set"]) >= 10
    assert data["label"] == "test"
    assert data["started_at"]


def test_every_rate_carries_the_count_behind_it() -> None:
    """Thirty-odd documents is small and a two-document movement is noise."""
    report = harness.run("test", cases=CASES[:3])
    text = harness.render(report)

    assert "/" in text
    for name, tally in report.fields.items():
        assert f"({tally.right}/{tally.total})" in text


def test_the_wrong_list_names_the_document_and_both_values() -> None:
    """A percentage says how much is wrong; this says what, which is what a fix needs."""
    # 15-ap-2026-3390 reads "Letterhead, 500" as a description plus a quantity. 32-nm was
    # used here until stage 9's buyer rule fixed it.
    report = harness.run("test", cases=[c for c in CASES if c.name == "15-ap-2026-3390"])
    assert report.wrong
    entry = report.wrong[0].as_dict()
    assert entry["document"] and entry["field"]
    assert "expected" in entry and "actual" in entry
