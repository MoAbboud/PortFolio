"""Stage 4's rules, one test per rule, each with the case where it should pass.

A rule tested only on the input that breaks it is half a rule. The expensive failure here is
not a rule that misses something - it is a rule that fires on a good document, because that
spends reviewer time on nothing and teaches everyone to ignore the queue.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest

from mailman.invoice import InvoiceFields, InvoiceRead, LineItemRead
from mailman.status import SEVERITY_ERROR, SEVERITY_WARNING
from mailman.validation import (
    RULES,
    amounts_parsed,
    currency_is_known,
    dates_are_ordered,
    dates_are_unambiguous,
    failed_errors,
    failed_warnings,
    invoice_number_is_plausible,
    issue_date_is_plausible,
    line_arithmetic,
    line_items_sum_to_subtotal,
    needs_review,
    required_fields_present,
    summarise,
    validate,
)


def fields(**overrides) -> InvoiceFields:
    """A clean invoice, with named fields replaced. Every rule passes on the default."""
    lines = overrides.pop("line_items", [("Widget", "2", "100.00", "200.00")])
    base = dict(
        invoice_number="INV-2026-0042",
        vendor_name="Acme Corp Ltd",
        buyer_name="Orchard Foods",
        issue_date="2026-08-14",
        due_date="2026-09-13",
        currency="GBP",
        subtotal="200.00",
        tax="40.00",
        total="240.00",
        confidence=1.0,
        unreadable=[],
    )
    base.update(overrides)
    read = InvoiceRead(
        line_items=[
            LineItemRead(line_no=i + 1, description=d, quantity=q, unit_price=u, amount=a)
            for i, (d, q, u, a) in enumerate(lines)
        ],
        **base,
    )
    return InvoiceFields(read)


def test_the_baseline_invoice_passes_every_rule() -> None:
    """If this fails, every other test in the file is testing the fixture."""
    outcomes = validate(fields())
    assert not failed_errors(outcomes)
    assert not failed_warnings(outcomes)
    assert summarise(outcomes).startswith("all ")
    assert not needs_review(outcomes)


def test_every_rule_in_the_registry_is_exercised_here() -> None:
    """A rule added to RULES without a test is a rule nobody has disagreed with yet."""
    tested = {
        required_fields_present, amounts_parsed, currency_is_known,
        line_items_sum_to_subtotal, subtotal_plus_tax_equals_total_ref(),
        line_arithmetic, issue_date_is_plausible, dates_are_ordered,
        dates_are_unambiguous, invoice_number_is_plausible,
    }
    assert set(RULES) == tested, "RULES and the rules tested in this file disagree"


def subtotal_plus_tax_equals_total_ref():
    from mailman.validation import subtotal_plus_tax_equals_total

    return subtotal_plus_tax_equals_total


# --- required fields -------------------------------------------------------------------


def test_required_fields_present_fails_when_the_total_is_missing() -> None:
    """Both `02-many-lines` and `08-two-page` lost their total to the bare-thousands bug."""
    outcome = required_fields_present(fields(total=None))
    assert not outcome.passed and outcome.severity == SEVERITY_ERROR
    assert "total" in outcome.message


def test_required_fields_present_passes_on_a_complete_record() -> None:
    assert required_fields_present(fields()).passed


# --- parsing ---------------------------------------------------------------------------


def test_amounts_parsed_fails_on_a_value_that_could_not_be_read() -> None:
    """An amount the system could not read and an amount that is zero must not look alike."""
    outcome = amounts_parsed(fields(subtotal="not a number"))
    assert not outcome.passed
    assert "subtotal" in outcome.message


def test_amounts_parsed_passes_when_everything_read() -> None:
    assert amounts_parsed(fields()).passed


# --- currency --------------------------------------------------------------------------


def test_currency_is_known_fails_when_no_currency_was_found() -> None:
    """The trained extractor scored 1/11 here on the corpus. This is the rule that says so."""
    outcome = currency_is_known(fields(currency=None))
    assert not outcome.passed and outcome.severity == SEVERITY_ERROR


def test_currency_is_known_fails_on_something_invented() -> None:
    assert not currency_is_known(fields(currency="XYZ")).passed


def test_currency_is_known_passes_on_a_real_code() -> None:
    assert currency_is_known(fields(currency="EUR")).passed


# --- arithmetic ------------------------------------------------------------------------


def test_line_items_sum_to_subtotal_fails_when_a_line_is_missing() -> None:
    """The `_TOTALS_WORDS` bug dropped three line items of four and nothing raised."""
    outcome = line_items_sum_to_subtotal(
        fields(subtotal="830.00", line_items=[("Site survey", "1", "320.00", "320.00")])
    )
    assert not outcome.passed
    assert "320.00" in outcome.message and "830.00" in outcome.message


def test_line_items_sum_to_subtotal_fails_on_a_phantom_line() -> None:
    """A date read as two amounts became a line item. The sum is how it surfaces."""
    outcome = line_items_sum_to_subtotal(
        fields(
            subtotal="200.00",
            line_items=[("Widget", "2", "100.00", "200.00"), ("03 09", "1", "3.00", "3.00")],
        )
    )
    assert not outcome.passed


def test_line_items_sum_to_subtotal_passes_when_they_add_up() -> None:
    assert line_items_sum_to_subtotal(fields()).passed


def test_line_items_sum_to_subtotal_does_not_apply_without_line_items() -> None:
    """Not applicable is not a pass. A rule that never looked writes no row."""
    assert line_items_sum_to_subtotal(fields(line_items=[])) is None


def test_subtotal_plus_tax_equals_total_fails_on_a_misread_total() -> None:
    outcome = subtotal_plus_tax_equals_total_ref()(fields(total="999.00"))
    assert not outcome.passed
    assert "999.00" in outcome.message


def test_subtotal_plus_tax_equals_total_holds_for_a_credit_note() -> None:
    """Signs reversed throughout: -100.00 plus -20.00 is still -120.00.

    This is the argument for credit notes being invoices rather than a special case, and it
    is asserted rather than assumed because the whole scope decision rests on it.
    """
    outcome = subtotal_plus_tax_equals_total_ref()(
        fields(
            subtotal="-100.00", tax="-20.00", total="-120.00",
            line_items=[("Returned goods", "4", "-25.00", "-100.00")],
        )
    )
    assert outcome.passed


def test_line_arithmetic_fails_when_a_line_does_not_multiply_out() -> None:
    """Seven of `08-two-page`'s forty lines were wrong this way and the document read clean."""
    outcome = line_arithmetic(
        fields(line_items=[("Reel stock", "34", "30.00", "1020.00"), ("Reel", "2", "30.00", "90.00")])
    )
    assert not outcome.passed
    assert "90.00" in outcome.message


def test_line_arithmetic_passes_when_every_line_multiplies_out() -> None:
    assert line_arithmetic(fields()).passed


def test_line_arithmetic_ignores_lines_with_no_quantity() -> None:
    """A row with no quantity column cannot be multiplied out, and that is not a failure."""
    assert line_arithmetic(fields(line_items=[("Consulting", None, "100.00", "100.00")])) is None


# --- dates -----------------------------------------------------------------------------


def test_issue_date_is_plausible_fails_on_a_misparsed_year() -> None:
    """`2026` read as `2062` is a well-formed date nobody would notice in a list."""
    far = (date.today() + timedelta(days=365 * 20)).isoformat()
    assert not issue_date_is_plausible(fields(issue_date=far)).passed


def test_issue_date_is_plausible_passes_on_a_recent_date() -> None:
    assert issue_date_is_plausible(fields(issue_date=date.today().isoformat())).passed


def test_dates_are_ordered_warns_when_the_due_date_precedes_the_issue_date() -> None:
    outcome = dates_are_ordered(fields(issue_date="2026-09-13", due_date="2026-08-14"))
    assert not outcome.passed
    assert outcome.severity == SEVERITY_WARNING, "a swapped pair is still a filable record"


def test_dates_are_ordered_passes_in_the_normal_case() -> None:
    assert dates_are_ordered(fields()).passed


def test_dates_are_unambiguous_warns_on_a_date_that_reads_two_ways() -> None:
    """`06-ambiguous-date` exists for this, `parse_date` has recorded it since stage 2, and
    until now nothing read it. The honesty was being dropped one layer above the parser."""
    outcome = dates_are_unambiguous(fields(issue_date="03/04/2026"))
    assert outcome is not None and not outcome.passed
    assert outcome.severity == SEVERITY_WARNING


def test_dates_are_unambiguous_does_not_apply_to_an_iso_date() -> None:
    assert dates_are_unambiguous(fields(issue_date="2026-08-14")) is None


# --- invoice number --------------------------------------------------------------------


@pytest.mark.parametrize(
    "number", ["INV-2026-0042", "NS-88213", "MPW-3310", "BW-2026-771", "2026/0042"]
)
def test_invoice_number_is_plausible_accepts_every_shape_in_the_corpus(number: str) -> None:
    """The reason this rule is weak.

    The architecture asks for a format check as an error. The corpus carries at least three
    shapes and the generated evaluation set a fourth, so a single format marks good documents
    as broken - the `02-many-lines` trap, where a new rule fails against its own reference
    corpus and the next question is whether to weaken the rule or the corpus.
    """
    assert invoice_number_is_plausible(fields(invoice_number=number)).passed


@pytest.mark.parametrize("number", ["OICE", "a", "INV 2026 0042"])
def test_invoice_number_is_plausible_rejects_something_scraped_off_the_page(number: str) -> None:
    outcome = invoice_number_is_plausible(fields(invoice_number=number))
    assert not outcome.passed and outcome.severity == SEVERITY_WARNING


# --- routing ---------------------------------------------------------------------------


def test_a_failed_error_routes_to_review() -> None:
    assert needs_review(validate(fields(total="999.00")))


def test_a_failed_warning_does_not_route_to_review() -> None:
    """Warnings are recorded and do not cost reviewer time. That is the whole point of two
    severities: a queue that contains everything is a queue nobody opens."""
    outcomes = validate(fields(issue_date="03/04/2026"))
    assert failed_warnings(outcomes)
    assert not failed_errors(outcomes)
    assert not needs_review(outcomes)


def test_passes_are_recorded_not_just_failures() -> None:
    """A rule that used to pass and now fails is only visible if the pass was recorded."""
    outcomes = validate(fields())
    assert len(outcomes) >= 8
    assert all(o.passed for o in outcomes)
    assert all(o.message for o in outcomes), "every outcome names its numbers"


def test_the_messages_name_the_numbers() -> None:
    """A reviewer needs to know where to look, not only that something failed."""
    outcome = line_items_sum_to_subtotal(
        fields(subtotal="830.00", line_items=[("Site survey", "1", "320.00", "320.00")])
    )
    assert "320.00" in outcome.message
    assert "830.00" in outcome.message
    assert "510.00" in outcome.message, "the difference is what a reviewer actually wants"


def test_a_stored_extraction_revalidates_through_the_same_parser() -> None:
    """Re-validating reads the stored strings back through `InvoiceFields`.

    Amounts cross JSON as strings on purpose, and `_read_from` has to hand them back to the
    same parser the original run used. A shortcut that read the numbers directly would
    validate a different value from the one the pipeline produced, and the corrections
    endpoint in stage 6 re-validates on every fix - so this is the path most likely to drift
    and least likely to be noticed drifting.
    """
    import json

    from mailman.pipeline import _read_from

    original = fields()
    stored = json.loads(json.dumps(original.to_json()))
    restored = InvoiceFields(InvoiceRead(**_read_from(stored)))

    assert restored.total == original.total
    assert restored.subtotal == original.subtotal
    assert restored.currency == original.currency
    assert len(restored.line_items) == len(original.line_items)
    assert [o.rule_name for o in validate(restored)] == [o.rule_name for o in validate(original)]

    # The self-report has to survive the round trip too. `to_json` stores it under a different
    # name, and the first version of `_read_from` fabricated 0.0 rather than renaming it back -
    # so every document that went through validation scored zero on that term of the composite,
    # quietly, because validation always reads the stored extraction and never the live object.
    from mailman.confidence import score

    assert restored.read.confidence == original.read.confidence
    assert score(restored, validate(restored)).score == score(original, validate(original)).score


def test_the_rules_catch_a_record_that_looks_complete_and_is_wrong() -> None:
    """The failure mode this whole stage exists for.

    Not a malformed document - a plausible one. Every required field present, every value
    parsed, a currency, dates in order, an ordinary-looking invoice number. The only thing
    wrong is that the numbers do not agree with each other, which is exactly what all five
    stage 3 extraction bugs produced and what four of the trained extractor's eleven corpus
    documents produced.
    """
    plausible = fields(
        subtotal="830.00", tax="166.00", total="996.00",
        line_items=[("Site survey", "1", "320.00", "320.00")],
    )
    outcomes = validate(plausible)

    assert required_fields_present(plausible).passed
    assert amounts_parsed(plausible).passed
    assert currency_is_known(plausible).passed

    errors = {o.rule_name for o in failed_errors(outcomes)}
    assert "line_items_sum_to_subtotal" in errors
    assert needs_review(outcomes), "a plausible wrong answer must reach a person"


# --- stage 5: confidence and routing ---------------------------------------------------


def test_a_clean_document_scores_one() -> None:
    from mailman.confidence import score

    assert score(fields(), validate(fields())).score == 1.0


def test_one_failed_warning_sits_exactly_on_the_threshold() -> None:
    """The threshold is a policy statement and this is the arithmetic that makes it statable.

    Clean is 1.00, one failed warning is 0.90, two are 0.80. A threshold of 0.90 therefore
    says "one warning is tolerable, two compound and warrant a person" - and routing is
    `< threshold`, so a single warning does not route.
    """
    from mailman.config import settings
    from mailman.confidence import score

    ambiguous = fields(issue_date="03/04/2026")
    confidence = score(ambiguous, validate(ambiguous))

    assert confidence.score == 0.9
    assert not confidence.score < settings.confidence_threshold


def test_two_failed_warnings_fall_below_the_threshold() -> None:
    from mailman.config import settings
    from mailman.confidence import score

    both = fields(issue_date="03/04/2026", due_date="2026-01-01")
    outcomes = validate(both)

    assert len(failed_warnings(outcomes)) == 2
    assert not failed_errors(outcomes), "warnings only - the errors must not be what routes it"
    assert score(both, outcomes).score < settings.confidence_threshold


def test_the_warnings_term_does_not_depend_on_how_many_rules_applied() -> None:
    """One failed warning must be worth the same whatever else happened to be applicable.

    Scored as a fraction, adding a warning rule to the registry would silently re-rank every
    document already in the system.
    """
    from mailman.confidence import score
    from mailman.validation import RuleOutcome

    scores = {
        total: score(
            fields(),
            [RuleOutcome(f"w{i}", SEVERITY_WARNING, i != 0) for i in range(total)],
        ).score
        for total in (1, 2, 5)
    }
    assert len(set(scores.values())) == 1, scores


def test_confidence_can_send_a_document_to_review_and_never_rescue_one() -> None:
    """The rule that makes this a system of rules rather than of suggestions.

    A document with a broken total scores well on every confidence term - all four required
    fields present, everything parsed, no warnings, the extractor happy with itself - and it
    still has to reach a person.
    """
    from mailman.confidence import score

    broken = fields(total="999.00")
    outcomes = validate(broken)
    confidence = score(broken, outcomes)

    assert confidence.score >= 0.9, "nothing in the composite notices a wrong total"
    assert failed_errors(outcomes)
    assert needs_review(outcomes), "the rule routes it regardless of the score"


def test_the_model_self_report_is_the_smallest_term() -> None:
    """Confidently wrong is the failure being designed around, so the model's opinion of
    itself is the least of four terms and cannot carry a document on its own."""
    from mailman.confidence import WEIGHTS

    assert WEIGHTS["model_self_report"] == min(WEIGHTS.values())
    assert WEIGHTS["model_self_report"] < WEIGHTS["required_fields"]


def test_a_term_that_does_not_apply_is_dropped_not_scored_zero() -> None:
    """Punishing a document for something it was never asked about is how a score stops
    meaning anything. With no warning rules applicable, the remaining weights renormalise."""
    from mailman.confidence import score

    assert "rule_warnings" not in score(fields(), []).components
    assert score(fields(), []).score == 1.0


def test_the_explanation_names_every_term() -> None:
    """"Why is this in the queue" has to be answerable from the status history alone."""
    from mailman.confidence import score

    explanation = score(fields(), validate(fields())).explain()
    for term in ("required_fields", "values_parsed", "rule_warnings", "model_self_report"):
        assert term in explanation
