"""Stage 8: the evaluation harness. The part that makes the rest worth showing.

    python -m mailman.eval run --corpus ./corpus --label baseline

**It drives the real pipeline.** The same extractor the API uses, over the same documents,
through the same parser. A harness that reimplements extraction measures the reimplementation
and drifts the moment the system changes - so the comparison logic lives in
`mailman/corpus_check.py` and is shared with the tests, and the extraction path is
`build_extractor()` with nothing special about it.

**Every run is written to `evaluations/` and never overwritten.** Measurement belongs in git
history where it can be read in a diff. Production tables carrying `eval_runs` and
`eval_results` would put the harness inside the schema it is meant to be judging.

## What it reports, and why each one

- **Per-field accuracy with the count behind it.** Thirty-odd documents is a small corpus and a
  two-document movement is noise. A rate with no denominator invites exactly that mistake.
- **Field kinds.** `invoice_number` has to match exactly; a vendor name that differs by a full
  stop is right; `2026-08-14` and `14 August 2026` are the same date; `270.0` and `270.00` are
  the same amount. Scoring all four as string equality would report failures that are not
  failures and hide the one that is.
- **Line items as a set, with precision and recall.** Order is not guaranteed, so they are
  matched rather than zipped - and when the matching itself fails that is visible as a recall
  drop rather than reported as a wrong amount on a line that was never there.
- **Every wrong field, with its document, expected and actual.** A percentage says how much is
  wrong; this says what, which is the only form the next fix can be written from.
- **Unsupported documents counted separately and never as wrong.** The difference between "94%"
  and "94% on the 91% of documents we accept" is the entire honesty of the number.
- **The model, the prompt version and the rule set on every run.** Two runs cannot be compared
  without knowing what produced them, which this project has now learned three times.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from mailman.corpus import CASES, Case
from mailman.corpus_check import arithmetic_problems, document_text

RESULTS_DIR = Path("evaluations")

# How each field is compared. The kind is a property of the field, not of the document, so it
# lives here once rather than being decided at each comparison site.
EXACT = "exact"
NORMALISED = "normalised"
DATE = "date"
DECIMAL = "decimal"

FIELD_KINDS: dict[str, str] = {
    "invoice_number": EXACT,
    "currency": EXACT,
    "vendor_name": NORMALISED,
    "buyer_name": NORMALISED,
    "issue_date": DATE,
    "due_date": DATE,
    "subtotal": DECIMAL,
    "tax": DECIMAL,
    "total": DECIMAL,
}
LINE_FIELD_KINDS = {
    "description": NORMALISED,
    "quantity": DECIMAL,
    "unit_price": DECIMAL,
    "amount": DECIMAL,
}

_PUNCT = re.compile(r"[^\w\s]+")


def normalise(value: Any) -> str:
    """Case, punctuation and runs of whitespace removed. For names and descriptions."""
    return " ".join(_PUNCT.sub(" ", str(value).casefold()).split())


def same(expected: Any, actual: Any, kind: str) -> bool:
    """One comparison, by kind. `None` on both sides is agreement, not a skip."""
    if expected is None or actual is None:
        return expected is None and actual is None

    if kind == DECIMAL:
        try:
            return Decimal(str(expected)) == Decimal(str(actual))
        except InvalidOperation:
            return False
    if kind == DATE:
        return str(expected)[:10] == str(actual)[:10]
    if kind == NORMALISED:
        return normalise(expected) == normalise(actual)
    return str(expected) == str(actual)


@dataclass
class Wrong:
    """One field the run got wrong. The unit the next fix is written from."""

    document: str
    field: str
    expected: Any
    actual: Any

    def as_dict(self) -> dict:
        return {
            "document": self.document,
            "field": self.field,
            "expected": None if self.expected is None else str(self.expected),
            "actual": None if self.actual is None else str(self.actual),
        }


@dataclass
class Tally:
    right: int = 0
    total: int = 0

    @property
    def rate(self) -> float:
        return self.right / self.total if self.total else 0.0


@dataclass
class Report:
    label: str
    extractor: str
    prompt_version: str
    rule_set: list[str]
    started_at: str
    fields: dict[str, Tally] = field(default_factory=dict)
    wrong: list[Wrong] = field(default_factory=list)
    documents_clean: int = 0
    documents_scored: int = 0
    refused_correctly: int = 0
    refused_wrongly: int = 0
    unsupported: list[dict] = field(default_factory=list)
    line_matched: int = 0
    line_expected: int = 0
    line_predicted: int = 0
    arithmetic_breaks: int = 0

    def count(self, name: str, right: bool) -> None:
        tally = self.fields.setdefault(name, Tally())
        tally.total += 1
        tally.right += int(right)

    @property
    def overall(self) -> Tally:
        out = Tally()
        for tally in self.fields.values():
            out.right += tally.right
            out.total += tally.total
        return out

    @property
    def line_precision(self) -> float:
        return self.line_matched / self.line_predicted if self.line_predicted else 0.0

    @property
    def line_recall(self) -> float:
        return self.line_matched / self.line_expected if self.line_expected else 0.0

    def as_dict(self) -> dict:
        return {
            "label": self.label,
            "started_at": self.started_at,
            "extractor": self.extractor,
            "prompt_version": self.prompt_version,
            "rule_set": self.rule_set,
            "documents": {
                "scored": self.documents_scored,
                "clean": self.documents_clean,
                "refused_correctly": self.refused_correctly,
                "refused_wrongly": self.refused_wrongly,
                "unsupported": len(self.unsupported),
            },
            "overall": {"right": self.overall.right, "of": self.overall.total,
                        "rate": round(self.overall.rate, 4)},
            "per_field": {
                name: {"right": t.right, "of": t.total, "rate": round(t.rate, 4)}
                for name, t in sorted(self.fields.items())
            },
            "line_items": {
                "matched": self.line_matched,
                "expected": self.line_expected,
                "predicted": self.line_predicted,
                "precision": round(self.line_precision, 4),
                "recall": round(self.line_recall, 4),
            },
            "arithmetic_breaks": self.arithmetic_breaks,
            "unsupported_documents": self.unsupported,
            "wrong": [w.as_dict() for w in self.wrong],
        }


def _match_lines(report: Report, name: str, expected: list[dict], actual: list[dict]) -> None:
    """Line items as a set, not a zip.

    Matched on the normalised description, greedily, because order is not guaranteed and a
    document whose lines come back shuffled is not wrong about its lines. A line that cannot be
    matched at all is a recall miss rather than four wrong fields on a row that was never
    there, which is the distinction the plan asked for: when the matching fails, that has to be
    visible as itself.
    """
    report.line_expected += len(expected)
    report.line_predicted += len(actual)

    remaining = list(actual)
    for want in expected:
        key = normalise(want.get("description"))
        found = next((a for a in remaining if normalise(a.get("description")) == key), None)
        if found is None:
            report.wrong.append(Wrong(name, "line_items[missing]", want.get("description"), None))
            continue
        remaining.remove(found)
        report.line_matched += 1
        for sub, kind in LINE_FIELD_KINDS.items():
            if sub not in want:
                continue
            ok = same(want.get(sub), found.get(sub), kind)
            report.count(f"line.{sub}", ok)
            if not ok:
                report.wrong.append(
                    Wrong(name, f"line[{want.get('description')}].{sub}",
                          want.get(sub), found.get(sub))
                )
    for extra in remaining:
        report.wrong.append(Wrong(name, "line_items[spurious]", None, extra.get("description")))


def _count_all_wrong(report: Report, case: Case) -> None:
    """Every scorable field on a document that produced nothing counts as wrong."""
    for key, expected in case.expected.items():
        if key == "line_items":
            report.line_expected += len(expected)
            continue
        if FIELD_KINDS.get(key) is None:
            continue
        report.count(key, False)


def score_case(report: Report, case: Case, fields, page_count: int) -> bool:
    """Compare one document. Returns whether every checked field was right."""
    clean = True
    for key, expected in case.expected.items():
        if key == "line_items":
            before = len(report.wrong)
            _match_lines(report, case.name, expected, fields.line_items)
            clean = clean and len(report.wrong) == before
            continue
        if key in ("line_item_count", "spans_pages", "has_negative_line",
                   "issue_date_is_ambiguous", "unsupported_reason"):
            continue           # structural assertions, checked by tests rather than scored
        kind = FIELD_KINDS.get(key)
        if kind is None:
            continue
        actual = getattr(fields, key, None)
        if kind == DATE and actual is not None:
            actual = actual.isoformat()
        ok = same(expected, actual, kind)
        report.count(key, ok)
        if not ok:
            clean = False
            report.wrong.append(Wrong(case.name, key, expected, actual))
    return clean


def run(
    label: str,
    cases: list[Case] | None = None,
    extractor_name: str | None = None,
) -> Report:
    """Every document through the real pipeline, scored."""
    from mailman.extractor import ExtractionError
    from mailman.extractors import build_extractor
    from mailman.validation import RULES

    cases = cases if cases is not None else CASES
    extractor = build_extractor(extractor_name)

    report = Report(
        label=label,
        extractor=extractor.model_name,
        prompt_version=extractor.prompt_version,
        rule_set=[rule.__name__ for rule in RULES],
        started_at=datetime.now(timezone.utc).isoformat(),
    )

    for case in cases:
        if case.unsupported:
            report.unsupported.append({"document": case.name, "reason": case.unsupported})
            continue

        try:
            text, page_count = document_text(case)
        except Exception as exc:                   # noqa: BLE001 - a corpus file that will not open
            report.unsupported.append(
                {"document": case.name, "reason": f"{type(exc).__name__}: {exc}"}
            )
            continue

        try:
            fields = extractor.extract(text).fields
        except ExtractionError as exc:
            if case.should_fail:
                report.refused_correctly += 1
            else:
                # A refusal on a document that should extract is not a gap in the
                # measurement, it is every field on that document being wrong.
                #
                # The first version of this skipped them, and the corpus reported 99.7% while
                # producing nothing at all for twelve of thirty-four documents. That is the
                # exact dishonesty this harness exists to prevent, and it has a sharper form:
                # **a system that refuses everything it finds hard would score 100%.** Scoring
                # a refusal as silence rewards refusing.
                report.refused_wrongly += 1
                report.documents_scored += 1
                report.wrong.append(Wrong(case.name, "(refused)", "an extraction", str(exc)))
                _count_all_wrong(report, case)
            continue

        if case.should_fail:
            report.refused_wrongly += 1
            report.wrong.append(Wrong(case.name, "(not refused)", "a refusal", "an extraction"))
            continue

        report.documents_scored += 1
        if score_case(report, case, fields, page_count):
            report.documents_clean += 1
        if arithmetic_problems(fields):
            report.arithmetic_breaks += 1

    return report


def write(report: Report, directory: Path = RESULTS_DIR) -> Path:
    """One file per run, named for the label and the time. Never overwritten.

    Append-only run history in the repository, so a change to the numbers shows up as a diff
    rather than as a memory of what the last run said.
    """
    directory.mkdir(parents=True, exist_ok=True)
    stamp = report.started_at.replace(":", "").replace("-", "")[:15]
    path = directory / f"{stamp}-{report.label}.json"
    path.write_text(json.dumps(report.as_dict(), indent=2) + "\n", encoding="utf-8")
    return path


def render(report: Report) -> str:
    """The summary a person reads. Every rate carries the count behind it."""
    out: list[str] = []
    add = out.append

    add(f"label            {report.label}")
    add(f"extractor        {report.extractor}")
    add(f"prompt version   {report.prompt_version}")
    add(f"rules            {len(report.rule_set)}")
    add("")
    add(f"documents scored     {report.documents_scored}")
    add(f"  every field right  {report.documents_clean}")
    add(f"  arithmetic breaks  {report.arithmetic_breaks}")
    add(f"refused correctly    {report.refused_correctly}")
    add(f"refused wrongly      {report.refused_wrongly}")
    add(f"unsupported          {len(report.unsupported)}")
    for entry in report.unsupported:
        add(f"    {entry['document']:34} {entry['reason']}")
    add("")
    add("PER FIELD")
    for name, tally in sorted(report.fields.items(), key=lambda kv: (kv[1].rate, kv[0])):
        add(f"  {name:22} {tally.rate:6.1%}  ({tally.right}/{tally.total})")
    overall = report.overall
    add(f"  {'OVERALL':22} {overall.rate:6.1%}  ({overall.right}/{overall.total})")
    add("")
    add(
        f"LINE ITEMS  precision {report.line_precision:.1%} "
        f"({report.line_matched}/{report.line_predicted})  "
        f"recall {report.line_recall:.1%} ({report.line_matched}/{report.line_expected})"
    )

    if report.wrong:
        add("")
        add(f"WRONG ({len(report.wrong)}) - what the next change has to fix")
        by_field: dict[str, list[Wrong]] = {}
        for w in report.wrong:
            by_field.setdefault(w.field.split("[")[0], []).append(w)
        for name, items in sorted(by_field.items(), key=lambda kv: -len(kv[1])):
            add(f"  {name} ({len(items)})")
            for w in items[:4]:
                add(f"      {w.document:30} expected {w.expected!r}, got {w.actual!r}")
            if len(items) > 4:
                add(f"      ... and {len(items) - 4} more")
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m mailman.eval")
    sub = parser.add_subparsers(dest="command", required=True)

    run_parser = sub.add_parser("run", help="score every corpus document")
    run_parser.add_argument("--corpus", default="./corpus", help="where the documents are")
    run_parser.add_argument("--label", required=True, help="what this run is, e.g. baseline")
    run_parser.add_argument("--extractor", default=None, help="override MAILMAN_EXTRACTOR")
    run_parser.add_argument("--no-write", action="store_true", help="print without recording")

    args = parser.parse_args(argv)

    report = run(args.label, extractor_name=args.extractor)
    print(render(report))
    if not args.no_write:
        path = write(report)
        print()
        print(f"written to {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
