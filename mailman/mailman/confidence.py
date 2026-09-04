"""Stage 5: a composite confidence, and the reason for every term in it.

**The failure mode this is designed around is confidently wrong**, so the model's own opinion
of itself is one term among four and the smallest of them. Everything weighted above it is a
fact about the record rather than an opinion about it: how much of the required set is
populated, how much of what was found actually parsed, and what the softer rules made of it.

**Confidence can send a document to review and can never rescue one.** A failed error rule
routes on its own and no score overrides it. That is not a detail - a system where a high
enough confidence can wave a broken total through has no rules, it has suggestions.

## The four terms

| Term | Weight | What it is |
| --- | --- | --- |
| `required_fields` | 0.40 | Fraction of `REQUIRED_FIELDS` with a value. A record missing one is not a record |
| `values_parsed` | 0.30 | Fraction of the values found that parsed. An amount the system could not read is a fact about the document |
| `rule_warnings` | 0.20 | 1.0 with no failed warnings, 0.5 with one, 0.0 with two or more |
| `model_self_report` | 0.10 | What the extractor said about itself |

**Only warnings feed the score, not errors.** A failed error already routes the document, so
including it here would count the same fact twice - and it would produce the confusing result
of a document sitting in review with a score that also says it should be in review. This also
gives warnings the only job they have: they do not route, so without this they would be
recorded and ignored.

**The model's self-report is the weakest term and on the heuristic path it is not even
independent.** `HeuristicExtractor` sets `read.confidence` to the fraction of required fields
it found, which is exactly what `required_fields` already measures. So for the deployed
extractor this term is a duplicate carrying a tenth of the weight, and it is kept only because
a provider-backed extractor returns something genuinely its own. That is an argument for the
weight being small, not for the term being absent - and it is the kind of thing that should be
said out loud rather than discovered by someone reading the numbers later.

## The breakdown is recomputed, not stored

Only the scalar goes on the extraction row. The breakdown is derived from `extracted_data` and
`validation_results`, both of which are already stored, so keeping a third copy would create a
third place for the same fact to disagree with itself. `explain()` reconstructs it exactly, and
the pipeline writes it into the status history where a person reads it.

## The threshold

Set in configuration, never as a literal in the pipeline, and the reason it is where it is
belongs in `NOTES.md` rather than in a comment nobody diffs.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal

from mailman.invoice import REQUIRED_FIELDS, InvoiceFields
from mailman.status import SEVERITY_WARNING
from mailman.validation import RuleOutcome

WEIGHTS: dict[str, float] = {
    "required_fields": 0.40,
    "values_parsed": 0.30,
    "rule_warnings": 0.20,
    "model_self_report": 0.10,
}


@dataclass(frozen=True)
class Confidence:
    """A score, and every number that went into it."""

    score: float
    components: dict[str, float] = field(default_factory=dict)

    def explain(self) -> str:
        """One line naming each term and its contribution.

        Written into the status history, so "why is this in the queue" is answerable a week
        later without rerunning anything.
        """
        parts = [
            f"{name} {value:.2f}x{WEIGHTS[name]:.2f}"
            for name, value in self.components.items()
        ]
        return f"confidence {self.score:.4f} = " + " + ".join(parts)


def _values_parsed(fields: InvoiceFields) -> float:
    """How much of what was found actually read as a number or a date.

    The denominator is what the extractor attempted, not the whole schema: a document with no
    tax line should not be marked down for a value that is not there. `InvoiceFields` records
    a parse failure rather than raising, and this is the term that reads that record.
    """
    attempted = sum(
        1
        for name in ("subtotal", "tax", "total", "issue_date", "due_date")
        if getattr(fields.read, name, None)
    )
    attempted += sum(
        1
        for item in fields.read.line_items
        for name in ("quantity", "unit_price", "amount")
        if getattr(item, name, None)
    )
    if not attempted:
        return 0.0
    return max(0.0, 1.0 - len(fields.problems) / attempted)


# What one failed warning costs. Two failed warnings take the term to zero.
_WARNING_PENALTY = 0.5


def _rule_warnings(outcomes: list[RuleOutcome]) -> float | None:
    """Scored by how many warnings failed, not by what fraction of them did.

    The fraction is the obvious implementation and it is unstable in a way that matters. A
    document where the only applicable warning fails scores 0.0 on this term; a document where
    one of two fails scores 0.5 - so the same single problem is worth a different amount
    depending on how many *other* warning rules happened to apply, which is a property of the
    registry rather than of the document. Adding a warning rule would then silently re-rank
    every document already in the system.

    Counting failures instead makes the term mean one thing: none is 1.0, one is 0.5, two or
    more is 0.0. That is also what makes the threshold statable in words - one failed warning
    is tolerated, two are not.
    """
    warnings = [o for o in outcomes if o.severity == SEVERITY_WARNING]
    if not warnings:
        return None
    failed = sum(1 for o in warnings if not o.passed)
    return max(0.0, 1.0 - _WARNING_PENALTY * failed)


def score(fields: InvoiceFields, outcomes: list[RuleOutcome] | None = None) -> Confidence:
    """The composite, with its terms.

    A term that does not apply is dropped and the remaining weights are renormalised, rather
    than being scored zero. Scoring an absent term zero would punish a document for something
    it was never asked about, which is how a confidence number stops meaning anything.
    """
    outcomes = outcomes or []

    components: dict[str, float] = {
        "required_fields": sum(
            1 for name in REQUIRED_FIELDS if getattr(fields, name, None) is not None
        )
        / len(REQUIRED_FIELDS),
        "values_parsed": _values_parsed(fields),
    }

    warnings = _rule_warnings(outcomes)
    if warnings is not None:
        components["rule_warnings"] = warnings

    self_report = getattr(fields.read, "confidence", None)
    if self_report is not None:
        components["model_self_report"] = float(self_report)

    total_weight = sum(WEIGHTS[name] for name in components)
    raw = sum(value * WEIGHTS[name] for name, value in components.items())
    return Confidence(round(raw / total_weight, 4) if total_weight else 0.0, components)


def as_decimal(confidence: Confidence) -> Decimal:
    """For the `numeric(5,4)` column. Never a float in the database."""
    return Decimal(str(confidence.score))
