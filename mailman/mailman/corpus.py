"""The evaluation corpus: invoices as PDFs, with their correct answers beside them.

Every document here exists to test one thing that is known to be hard. They are hand-written
rather than randomly generated, because ten random invoices measure the generator's average
case and what is wanted is its worst cases - a discount line, a credit note with negative
amounts, European separators, a date that reads two ways, a table crossing a page break.

**The labels are the document's truth, not the pipeline's output.** They are written here,
beside the text that produces them, so ground truth exists by construction and never passes
through anyone's judgement about what the extractor "should have" found.

`expected` holds only the fields worth asserting on. A value of None means the document does
not carry that field, and the correct extraction is a null - not a guess.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from decimal import Decimal
from pathlib import Path

from mailman.pdfwriter import build_pdf


@dataclass
class Case:
    """One corpus document."""

    name: str
    # What this document is for. It is the reason the case exists, and it is what gets read
    # when the pipeline fails on it.
    tests: str
    lines: list[str]
    expected: dict
    # Set when the pipeline is expected to refuse or fail this document rather than extract
    # it. A corpus that only contains documents that should succeed cannot measure refusal.
    should_fail: bool = False

    def pdf(self) -> bytes:
        return build_pdf(self.lines)


def _lines(text: str) -> list[str]:
    return [line.rstrip() for line in text.strip("\n").split("\n")]


# Quantity and unit price for each of the twelve lines of `02-many-lines`. The subtotal, tax
# and total below are computed from these rather than typed out, because the first version of
# that case had a subtotal of 1170.00 printed against line items summing to 1352.00. Ground
# truth that contradicts itself is worse than no ground truth: the stage 4 rule "line items
# sum to the subtotal" would have failed against the corpus rather than against a document,
# and the case still looked clean because the run only counted line items instead of adding
# them up.
_NORTHGATE_ITEMS = [(i + 1, Decimal(10 + i)) for i in range(12)]
_NORTHGATE_SUBTOTAL = sum((q * u for q, u in _NORTHGATE_ITEMS), Decimal(0))
_NORTHGATE_TAX = (_NORTHGATE_SUBTOTAL * Decimal("0.20")).quantize(Decimal("0.01"))
_NORTHGATE_TOTAL = _NORTHGATE_SUBTOTAL + _NORTHGATE_TAX


CASES: list[Case] = [
    Case(
        name="01-clean",
        tests="The baseline. If this fails, nothing else is worth reading.",
        lines=_lines(
            """
ACME CORP LTD
17 Fleet Street, London EC4Y 1AA

INVOICE

Invoice Number: INV-2026-0042
Invoice Date: 14 August 2026
Due Date: 13 September 2026

Bill To: Orchard Foods Ltd

Description               Qty    Unit Price     Amount
Widget assembly             2       GBP 100.00   GBP 200.00
Freight charge              1        GBP 25.00    GBP 25.00

Subtotal                                         GBP 225.00
VAT 20%                                           GBP 45.00
Total Due                                        GBP 270.00
"""
        ),
        expected={
            "invoice_number": "INV-2026-0042",
            "vendor_name": "ACME CORP LTD",
            "buyer_name": "Orchard Foods Ltd",
            "issue_date": "2026-08-14",
            "due_date": "2026-09-13",
            "currency": "GBP",
            "subtotal": "225.00",
            "tax": "45.00",
            "total": "270.00",
            "line_items": [
                {"description": "Widget assembly", "quantity": "2",
                 "unit_price": "100.00", "amount": "200.00"},
                {"description": "Freight charge", "quantity": "1",
                 "unit_price": "25.00", "amount": "25.00"},
            ],
        },
    ),
    Case(
        name="02-many-lines",
        tests="Twelve line items. Does line extraction degrade as the table grows.",
        lines=_lines(
            """
NORTHGATE SUPPLIES
INVOICE
Invoice No. NS-88213
Date: 2026-07-02
Due: 2026-08-01
Bill To: Pelham Group plc

Description               Qty    Unit Price     Amount
"""
        )
        + [
            f"Component {chr(65 + i)}-{100 + i}            {quantity}       GBP {price:.2f}"
            f"     GBP {quantity * price:.2f}"
            for i, (quantity, price) in enumerate(_NORTHGATE_ITEMS)
        ]
        + _lines(
            f"""
Subtotal                                         GBP {_NORTHGATE_SUBTOTAL:.2f}
VAT 20%                                          GBP {_NORTHGATE_TAX:.2f}
Total Due                                        GBP {_NORTHGATE_TOTAL:.2f}
"""
        ),
        expected={
            "invoice_number": "NS-88213",
            "vendor_name": "NORTHGATE SUPPLIES",
            "issue_date": "2026-07-02",
            "due_date": "2026-08-01",
            "currency": "GBP",
            "subtotal": f"{_NORTHGATE_SUBTOTAL:.2f}",
            "tax": f"{_NORTHGATE_TAX:.2f}",
            "total": f"{_NORTHGATE_TOTAL:.2f}",
            "line_item_count": 12,
        },
    ),
    Case(
        name="03-discount",
        tests="A negative discount line. It is a line item and it must not be read as a total.",
        lines=_lines(
            """
BLUEWATER LOGISTICS
INVOICE
Invoice Number: BW-2026-771
Invoice Date: 03/09/2026
Bill To: Kestrel Retail Ltd

Description               Qty    Unit Price     Amount
Pallet storage             10       GBP 40.00   GBP 400.00
Handling                    1       GBP 60.00    GBP 60.00
Early settlement discount   1      GBP -46.00   GBP -46.00

Subtotal                                         GBP 414.00
VAT 20%                                           GBP 82.80
Total Due                                        GBP 496.80
"""
        ),
        expected={
            "invoice_number": "BW-2026-771",
            "vendor_name": "BLUEWATER LOGISTICS",
            "issue_date": "2026-09-03",
            "currency": "GBP",
            "subtotal": "414.00",
            "tax": "82.80",
            "total": "496.80",
            "line_item_count": 3,
            "has_negative_line": True,
        },
    ),
    Case(
        name="04-credit-note",
        tests="Every amount negative, printed in parentheses. Accountants' convention.",
        lines=_lines(
            """
HARROW AND FINCH
CREDIT NOTE
Credit Note Number: CN-2026-0019
Date: 21 August 2026
Bill To: Vantage Media

Description               Qty    Unit Price     Amount
Returned goods              4      GBP (25.00)  GBP (100.00)

Subtotal                                        GBP (100.00)
VAT 20%                                          GBP (20.00)
Total Due                                       GBP (120.00)
"""
        ),
        expected={
            "invoice_number": "CN-2026-0019",
            "vendor_name": "HARROW AND FINCH",
            "issue_date": "2026-08-21",
            "currency": "GBP",
            "subtotal": "-100.00",
            "tax": "-20.00",
            "total": "-120.00",
            "line_item_count": 1,
        },
    ),
    Case(
        name="05-european-separators",
        tests="1.234,56 rather than 1,234.56, and a dotted date. Wrong reading gives a "
              "plausible number a thousand times too large.",
        lines=_lines(
            """
TESSELLATE SYSTEMS GmbH
RECHNUNG / INVOICE
Invoice Number: TS-2026-4417
Invoice Date: 14.08.2026
Due Date: 13.09.2026
Bill To: Ashcombe Interiors

Description               Qty    Unit Price     Amount
Server rental              12     EUR 1.250,00  EUR 15.000,00
Support retainer            1       EUR 850,50     EUR 850,50

Subtotal                                       EUR 15.850,50
VAT 19%                                         EUR 3.011,60
Total Due                                      EUR 18.862,10
"""
        ),
        expected={
            "invoice_number": "TS-2026-4417",
            "vendor_name": "TESSELLATE SYSTEMS GmbH",
            "issue_date": "2026-08-14",
            "due_date": "2026-09-13",
            "currency": "EUR",
            "subtotal": "15850.50",
            "tax": "3011.60",
            "total": "18862.10",
            "line_item_count": 2,
        },
    ),
]

CASES += [
    Case(
        name="06-ambiguous-date",
        tests="03/04/2026 is two real dates and the document does not say which. The parser "
              "must flag it rather than pick one quietly.",
        lines=_lines(
            """
MERIDIAN PRINT WORKS
INVOICE
Invoice Number: MPW-3310
Invoice Date: 03/04/2026
Bill To: Trent Valley Foods

Description               Qty    Unit Price     Amount
Bulk print run              5       GBP 90.00   GBP 450.00

Subtotal                                         GBP 450.00
VAT 20%                                           GBP 90.00
Total Due                                        GBP 540.00
"""
        ),
        expected={
            "invoice_number": "MPW-3310",
            "vendor_name": "MERIDIAN PRINT WORKS",
            "currency": "GBP",
            "total": "540.00",
            "issue_date_is_ambiguous": True,
        },
    ),
    Case(
        name="07-no-due-date",
        tests="An optional field genuinely absent. The correct answer is null, not a guess "
              "and not the issue date repeated.",
        lines=_lines(
            """
CORVID ENGINEERING
INVOICE
Invoice Number: CE-2026-0088
Invoice Date: 2026-06-11
Payment terms: on receipt
Bill To: Ridgeway Motors

Description               Qty    Unit Price     Amount
Site survey                 1      GBP 320.00   GBP 320.00

Subtotal                                         GBP 320.00
VAT 20%                                           GBP 64.00
Total Due                                        GBP 384.00
"""
        ),
        expected={
            "invoice_number": "CE-2026-0088",
            "vendor_name": "CORVID ENGINEERING",
            "issue_date": "2026-06-11",
            "due_date": None,
            "currency": "GBP",
            "total": "384.00",
        },
    ),
    Case(
        name="08-two-page",
        tests="A line-item table crossing a page break. pdfplumber returns the pages "
              "concatenated, so the header block appears once and the table twice.",
        lines=_lines(
            """
ASHLAND PAPER CO
INVOICE
Invoice Number: AP-2026-5120
Invoice Date: 2026-05-30
Due Date: 2026-06-29
Bill To: Bexley Wholesale

Description               Qty    Unit Price     Amount
"""
        )
        + [
            f"Reel stock lot {i:02}          {i}       GBP 30.00     GBP {i * 30}.00"
            for i in range(1, 41)
        ]
        + _lines(
            """
Subtotal                                         GBP 24600.00
VAT 20%                                          GBP 4920.00
Total Due                                        GBP 29520.00
"""
        ),
        expected={
            "invoice_number": "AP-2026-5120",
            "vendor_name": "ASHLAND PAPER CO",
            "currency": "GBP",
            "total": "29520.00",
            "line_item_count": 40,
            "spans_pages": True,
        },
    ),
    Case(
        name="09-symbol-currency",
        tests="A currency symbol and no ISO code anywhere. The code has to be inferred from "
              "the symbol or the field is a null that sends the document to review.",
        lines=_lines(
            """
PEREGRINE TOOLING
INVOICE
Invoice Number: PT-2026-0451
Invoice Date: 12 March 2026
Due Date: 11 April 2026
Bill To: Maplewood Care

Description               Qty    Unit Price     Amount
Calibration service         3         $145.00      $435.00
Emergency callout           1         $210.00      $210.00

Subtotal                                           $645.00
Sales Tax 8.5%                                      $54.83
Total Due                                          $699.83
"""
        ),
        expected={
            "invoice_number": "PT-2026-0451",
            "vendor_name": "PEREGRINE TOOLING",
            "issue_date": "2026-03-12",
            "due_date": "2026-04-11",
            "currency": "USD",
            "subtotal": "645.00",
            "tax": "54.83",
            "total": "699.83",
            "line_item_count": 2,
        },
    ),
    Case(
        name="10-not-an-invoice",
        tests="A delivery note. No amounts, no invoice number. The pipeline must refuse it "
              "rather than assemble a record out of whatever it can find.",
        lines=_lines(
            """
OAKFIELD PLANT HIRE
DELIVERY NOTE
Delivery Reference: DN-4471
Delivered: 2026-04-02
Deliver To: Saltburn Leisure

Item                                        Qty
Excavator, 3 tonne                            1
Breaker attachment                            2

Received by: ..............................
Signature:   ..............................
"""
        ),
        expected={
            "invoice_number": None,
            "total": None,
            "currency": None,
        },
        should_fail=True,
    ),
    Case(
        name="11-totals-words-in-description",
        tests="Line descriptions containing the six words the totals block is recognised "
              "by. A total station is a surveying instrument; 'Overdue' contains 'due'.",
        lines=_lines(
            """
STANWICK SURVEYORS
INVOICE
Invoice Number: SS-2026-0143
Invoice Date: 2026-04-17
Due Date: 2026-05-17
Bill To: Halden Construction

Description               Qty    Unit Price     Amount
Total station hire          3       GBP 90.00   GBP 270.00
Overdue account fee         1       GBP 40.00    GBP 40.00
Tax advisory services       2      GBP 100.00   GBP 200.00
Site survey                 1      GBP 320.00   GBP 320.00

Subtotal                                         GBP 830.00
VAT 20%                                          GBP 166.00
Total Due                                        GBP 996.00
"""
        ),
        expected={
            "invoice_number": "SS-2026-0143",
            "vendor_name": "STANWICK SURVEYORS",
            "issue_date": "2026-04-17",
            "due_date": "2026-05-17",
            "currency": "GBP",
            "subtotal": "830.00",
            "tax": "166.00",
            "total": "996.00",
            "line_items": [
                {"description": "Total station hire", "quantity": "3",
                 "unit_price": "90.00", "amount": "270.00"},
                {"description": "Overdue account fee", "quantity": "1",
                 "unit_price": "40.00", "amount": "40.00"},
                {"description": "Tax advisory services", "quantity": "2",
                 "unit_price": "100.00", "amount": "200.00"},
                {"description": "Site survey", "quantity": "1",
                 "unit_price": "320.00", "amount": "320.00"},
            ],
        },
    ),
]


def write_corpus(out_dir: str | Path = "corpus") -> list[Path]:
    """Write every case to disk as a PDF with its labels beside it.

    Layout matches what the stage 8 harness expects:

        corpus/01-clean.pdf
        corpus/01-clean.labels.json
    """
    directory = Path(out_dir)
    directory.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []

    for case in CASES:
        pdf_path = directory / f"{case.name}.pdf"
        labels_path = directory / f"{case.name}.labels.json"

        pdf_path.write_bytes(case.pdf())
        labels_path.write_text(
            json.dumps(
                {
                    "name": case.name,
                    "tests": case.tests,
                    "should_fail": case.should_fail,
                    "expected": case.expected,
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        written.extend([pdf_path, labels_path])

    return written


if __name__ == "__main__":
    import sys

    paths = write_corpus(sys.argv[1] if len(sys.argv) > 1 else "corpus")
    print(f"wrote {len(paths) // 2} documents to {Path(paths[0]).parent}")
    for case in CASES:
        marker = "  (expected to fail)" if case.should_fail else ""
        print(f"  {case.name:22} {case.tests[:58]}{marker}")
