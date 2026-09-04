"""Stage 4: the rules, written from the failure list rather than from imagination.

Every rule here is a small function that takes the parsed fields and returns one outcome. The
registry below is what the pipeline runs; adding a rule is writing a function and adding it to
`RULES`, and nothing else changes.

**Where these came from.** Stage 3 put eleven documents through the pipeline with no rules at
all and wrote down every place it went wrong. Five extraction bugs came out of it, and the
thing they had in common is more useful than any of them individually: **not one of them
crashed.** A money pattern blind to bare amounts over 999, a date read as two amounts, an
identifier read as two amounts, a date mask deleting four-figure line amounts, and a substring
label test that dropped three line items out of four. Every one produced a record that looked
complete and was wrong.

That is what these rules are for. They are not here to catch malformed documents - they are
here to catch *plausible* wrong answers, which is the only failure mode that matters once the
obvious ones raise. The extractor comparison made the point again: the trained model produced
four documents whose own arithmetic did not add up, and the heuristic none.

**Arithmetic is checked in Python, on Decimal, never by asking a model whether its own answer
adds up.** A model asked to check its own arithmetic agrees with itself. A rule that was
written down can be read, tested, and disagreed with, and that is the difference between a
system and a demo.

**Two rules from `03-architecture.md` are deliberately not implemented.** Both were written
before any document had been through the pipeline, and the corpus says they do not survive
contact with it. The reasoning is at the bottom of this module, because a rule that was
considered and rejected is worth more than one that was never thought of.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import Callable

from mailman.invoice import REQUIRED_FIELDS, InvoiceFields
from mailman.status import SEVERITY_ERROR, SEVERITY_WARNING


@dataclass(frozen=True)
class RuleOutcome:
    """One rule's verdict on one document. Becomes one `validation_results` row.

    `message` names the numbers involved. "line items sum to 320.00, subtotal says 830.00"
    tells a reviewer where to look; "arithmetic check failed" makes them find it themselves,
    and the review queue is the expensive part of this system.
    """

    rule_name: str
    severity: str
    passed: bool
    message: str | None = None


# A rule returns None when it does not apply to this document - no tax line, no due date - as
# distinct from passing. A not-applicable rule writes no row, because recording it as a pass
# would inflate the pass rate with documents the rule never looked at.
Rule = Callable[[InvoiceFields], RuleOutcome | None]

# How far out a date may be before it is treated as a misparse rather than a date.
_FUTURE_TOLERANCE = timedelta(days=365)
_PAST_TOLERANCE = timedelta(days=365 * 10)


def _ok(name: str, severity: str, message: str | None = None) -> RuleOutcome:
    return RuleOutcome(name, severity, True, message)


def _fail(name: str, severity: str, message: str) -> RuleOutcome:
    return RuleOutcome(name, severity, False, message)


# --------------------------------------------------------------------------------------
# The rules
# --------------------------------------------------------------------------------------


def required_fields_present(fields: InvoiceFields) -> RuleOutcome:
    """Every required field has a value.

    Caught by the corpus twice: `02-many-lines` and `08-two-page` both lost their total
    entirely to the bare-thousands bug, and a record with no total is not a record. This is
    the cheapest rule here and it is the one that fires on the most damaging failure.
    """
    name = "required_fields_present"
    missing = fields.missing_required
    if missing:
        return _fail(name, SEVERITY_ERROR, "missing required field(s): " + ", ".join(missing))
    return _ok(name, SEVERITY_ERROR, "all of " + ", ".join(REQUIRED_FIELDS) + " present")


def amounts_parsed(fields: InvoiceFields) -> RuleOutcome | None:
    """Nothing that looked like a value failed to parse.

    `InvoiceFields` records a parse failure rather than raising, because an amount the system
    could not read and an amount that really is zero must never look the same - one of them is
    a reason to put a document in front of a person. This is the rule that reads that record.
    """
    name = "amounts_parsed"
    if not fields.problems:
        return _ok(name, SEVERITY_ERROR, "every value parsed")
    detail = ", ".join(f"{field}: {reason}" for field, reason in sorted(fields.problems.items()))
    return _fail(name, SEVERITY_ERROR, f"could not parse {detail}")


def line_items_sum_to_subtotal(fields: InvoiceFields) -> RuleOutcome | None:
    """The line items add up to the printed subtotal.

    The most valuable rule on this list. It catches a line item invented out of a date, a line
    item silently dropped, and a misread amount - three of the five stage 3 bugs - and it
    needs no labels at all, which is why it also works on documents nobody has an answer key
    for. It is what found the date-mask bug and `02-many-lines`' self-contradicting ground
    truth, in one pass, before it was a rule.
    """
    name = "line_items_sum_to_subtotal"
    if not fields.line_items or fields.subtotal is None:
        return None

    amounts = [item["amount"] for item in fields.line_items if item["amount"] is not None]
    if len(amounts) != len(fields.line_items):
        return _fail(
            name,
            SEVERITY_ERROR,
            f"{len(fields.line_items) - len(amounts)} of {len(fields.line_items)} line items "
            "have no readable amount, so they cannot be summed",
        )

    summed = sum(amounts, Decimal(0))
    if summed != fields.subtotal:
        return _fail(
            name,
            SEVERITY_ERROR,
            f"{len(amounts)} line items sum to {summed}, subtotal says {fields.subtotal} "
            f"(difference {fields.subtotal - summed})",
        )
    return _ok(name, SEVERITY_ERROR, f"{len(amounts)} line items sum to {summed}")


def subtotal_plus_tax_equals_total(fields: InvoiceFields) -> RuleOutcome | None:
    """Subtotal plus tax is the total.

    Holds for credit notes unchanged, which is the argument for treating them as invoices with
    the signs reversed rather than as a special case: -100.00 plus -20.00 is still -120.00.
    """
    name = "subtotal_plus_tax_equals_total"
    if fields.subtotal is None or fields.total is None:
        return None

    tax = fields.tax if fields.tax is not None else Decimal(0)
    if fields.subtotal + tax != fields.total:
        return _fail(
            name,
            SEVERITY_ERROR,
            f"subtotal {fields.subtotal} + tax {tax} = {fields.subtotal + tax}, "
            f"total says {fields.total}",
        )
    return _ok(name, SEVERITY_ERROR, f"{fields.subtotal} + {tax} = {fields.total}")


def line_arithmetic(fields: InvoiceFields) -> RuleOutcome | None:
    """Quantity times unit price is the line amount, on every line.

    Catches a per-line misread that happens to leave the subtotal intact - which the sum rule
    above cannot see. Seven of `08-two-page`'s forty lines were wrong in exactly that way and
    the document was called clean for a whole session.
    """
    name = "line_arithmetic"
    checkable = [
        item
        for item in fields.line_items
        if None not in (item["quantity"], item["unit_price"], item["amount"])
    ]
    if not checkable:
        return None

    wrong = [
        f"line {item['line_no']} ({item['description']!r}): "
        f"{item['quantity']} x {item['unit_price']} = "
        f"{item['quantity'] * item['unit_price']}, printed {item['amount']}"
        for item in checkable
        if item["quantity"] * item["unit_price"] != item["amount"]
    ]
    if wrong:
        return _fail(
            name,
            SEVERITY_ERROR,
            f"{len(wrong)} of {len(checkable)} lines do not multiply out - " + "; ".join(wrong[:3]),
        )
    return _ok(name, SEVERITY_ERROR, f"{len(checkable)} lines multiply out")


def currency_is_known(fields: InvoiceFields) -> RuleOutcome:
    """A currency was found, and it is one we recognise.

    An amount without a currency is not a number anyone can act on, and a currency the system
    invented is worse than none. The trained extractor scored 1/11 on this field on the corpus
    because it had only ever seen a currency on its own labelled line - so this rule is also
    the one that would have caught that, on the first document, without anyone reading a
    per-field table.
    """
    name = "currency_is_known"
    known = {"GBP", "USD", "EUR", "CAD", "AUD", "CHF", "JPY", "SEK", "NOK", "DKK", "PLN"}
    if fields.currency is None:
        return _fail(name, SEVERITY_ERROR, "no currency found on the document")
    if fields.currency not in known:
        return _fail(name, SEVERITY_ERROR, f"unrecognised currency {fields.currency!r}")
    return _ok(name, SEVERITY_ERROR, f"currency {fields.currency}")


def issue_date_is_plausible(fields: InvoiceFields) -> RuleOutcome | None:
    """The issue date is not in the future and not implausibly old.

    A misparsed year is the failure this catches, and it is a quiet one: `2026` read as `2062`
    is a perfectly well-formed date that no reviewer would notice in a list.
    """
    name = "issue_date_is_plausible"
    if fields.issue_date is None:
        return None

    today = date.today()
    if fields.issue_date > today + _FUTURE_TOLERANCE:
        return _fail(name, SEVERITY_ERROR, f"issue date {fields.issue_date} is in the future")
    if fields.issue_date < today - _PAST_TOLERANCE:
        return _fail(name, SEVERITY_ERROR, f"issue date {fields.issue_date} is over ten years old")
    return _ok(name, SEVERITY_ERROR, f"issue date {fields.issue_date}")


def dates_are_ordered(fields: InvoiceFields) -> RuleOutcome | None:
    """The due date is not before the issue date.

    A warning rather than an error. It is usually a swapped pair and the record is still
    filable; sending every one of them to a person would spend reviewer time on something a
    reviewer can see at a glance.
    """
    name = "dates_are_ordered"
    if fields.issue_date is None or fields.due_date is None:
        return None
    if fields.due_date < fields.issue_date:
        return _fail(
            name,
            SEVERITY_WARNING,
            f"due date {fields.due_date} is before issue date {fields.issue_date}",
        )
    return _ok(name, SEVERITY_WARNING, f"{fields.issue_date} then {fields.due_date}")


def dates_are_unambiguous(fields: InvoiceFields) -> RuleOutcome | None:
    """A date that reads two ways went to a person rather than being guessed.

    **This rule is not on the architecture's list. It comes from the corpus.**
    `06-ambiguous-date` exists to prove that `03/04/2026` is flagged rather than quietly
    resolved, `parse_date` has recorded exactly that since stage 2 - and nothing read it. The
    parser was doing the honest thing and the honesty was being dropped on the floor one layer
    up, which is the same shape as the labels nothing evaluated.

    A warning, not an error: day-first is right far more often than not on these documents, so
    the guess is usually correct and the cost of being wrong is a payment chased on the wrong
    day rather than a bad record.
    """
    name = "dates_are_unambiguous"
    if not fields.ambiguous_dates:
        return None
    readings = ", ".join(
        f"{field} {getattr(fields, field)} (read {fields.date_conventions.get(field)})"
        for field in fields.ambiguous_dates
    )
    return _fail(
        name,
        SEVERITY_WARNING,
        f"{readings} - the document does not say which reading is meant",
    )


def invoice_number_is_plausible(fields: InvoiceFields) -> RuleOutcome | None:
    """The invoice number looks like an identifier rather than something scraped off the page.

    **Deliberately weak, and the weakness is the finding.** The architecture calls for
    "invoice number matches the expected format" as an error. The corpus carries at least
    three shapes across eleven documents - `INV-2026-0042`, `NS-88213`, `MPW-3310` - and a
    fourth appears in the generated evaluation set. A single format rule marks two of eleven
    perfectly good documents as errors, which is the `02-many-lines` trap: a new rule failing
    on its own reference corpus at the moment it is least trusted, and the next question is
    "is the rule wrong or is the document wrong".

    So this checks only what every real invoice number has: some length, at least one digit,
    and no whitespace. The strict version belongs per vendor, which makes it a `vendors`
    column and a rule that cannot fire until the second invoice from a vendor arrives.
    """
    name = "invoice_number_is_plausible"
    number = fields.invoice_number
    if number is None:
        return None
    if len(number) < 3 or not any(ch.isdigit() for ch in number) or any(ch.isspace() for ch in number):
        return _fail(
            name,
            SEVERITY_WARNING,
            f"invoice number {number!r} does not look like an identifier",
        )
    return _ok(name, SEVERITY_WARNING, f"invoice number {number}")


# The registry the pipeline runs. Order is the order a reviewer reads them in: what is
# missing, then what does not add up, then what is merely odd.
RULES: tuple[Rule, ...] = (
    required_fields_present,
    amounts_parsed,
    currency_is_known,
    line_items_sum_to_subtotal,
    subtotal_plus_tax_equals_total,
    line_arithmetic,
    issue_date_is_plausible,
    dates_are_ordered,
    dates_are_unambiguous,
    invoice_number_is_plausible,
)


def validate(fields: InvoiceFields, rules: tuple[Rule, ...] = RULES) -> list[RuleOutcome]:
    """Run every rule. Returns one outcome per applicable rule, passes included.

    Passes are kept because a rule that used to pass and now fails is only visible if the pass
    was recorded, and because a pass rate over the corpus is how a rule earns its place.
    """
    outcomes = []
    for rule in rules:
        outcome = rule(fields)
        if outcome is not None:
            outcomes.append(outcome)
    return outcomes


def failed_errors(outcomes: list[RuleOutcome]) -> list[RuleOutcome]:
    return [o for o in outcomes if not o.passed and o.severity == SEVERITY_ERROR]


def failed_warnings(outcomes: list[RuleOutcome]) -> list[RuleOutcome]:
    return [o for o in outcomes if not o.passed and o.severity == SEVERITY_WARNING]


def needs_review(outcomes: list[RuleOutcome]) -> bool:
    """Any failed error sends the document to a person. Warnings do not.

    That is the whole routing rule at this stage. Confidence arrives in stage 5 and can only
    add documents to the queue, never remove one - a confident model and a broken total is
    exactly the case this exists for.
    """
    return bool(failed_errors(outcomes))


def summarise(outcomes: list[RuleOutcome]) -> str:
    """One line for a log or a queue row."""
    errors, warnings = failed_errors(outcomes), failed_warnings(outcomes)
    if not errors and not warnings:
        return f"all {len(outcomes)} rules passed"
    parts = []
    if errors:
        parts.append(f"{len(errors)} error(s): " + "; ".join(o.rule_name for o in errors))
    if warnings:
        parts.append(f"{len(warnings)} warning(s): " + "; ".join(o.rule_name for o in warnings))
    return " | ".join(parts)


# --------------------------------------------------------------------------------------
# Rules from 03-architecture.md that are NOT implemented, and why.
#
# Both were written before any document had been through the pipeline. Keeping the reasoning
# is the point of stage 3 coming before stage 4 at all.
#
#   "Total matches the total printed on the document" (error)
#       Unimplementable as stated, and it took reading the corpus to see it. The rule guards
#       against a model that COMPUTES a total instead of reading one - but `fields.total` IS
#       what was read, so there is no second signal to compare it against. The check it was
#       reaching for is `subtotal_plus_tax_equals_total`, which is implemented. If a future
#       extractor ever reports both what it read and what it computed, this becomes real.
#
#   "Invoice number matches the expected format" (error)
#       Implemented as a warning with a much weaker test - see the docstring above. As an
#       error with a real format it fails on two of eleven corpus documents that are entirely
#       well formed. Per-vendor formats are the honest version and they need the `vendors`
#       table, so this is stage 6 work at the earliest.
#
# Two more are real and need a database session, so they are not in this module: the vendor
# resolving against `vendors` (warning), and the invoice number not already recorded for that
# vendor (error, and the expensive mistake this system exists to prevent). Both land with the
# promotion work in stage 6, where there is a session and a populated table to check against.
# --------------------------------------------------------------------------------------
