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

`buyer_name` is labelled on every document even though the heuristic never finds one. It used
to be labelled only on `01-clean`, exempted through `KNOWN_GAPS`, and that exemption hid the
only field where the trained model beats the rules: the extractor comparison could not show a
difference on a field it was suppressing. Labelled everywhere, the comparison reads
heuristic 0/10 against hybrid 10/10, which is the argument for the weights existing.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

from mailman.pdfwriter import build_image_only_pdf, build_pdf


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

    # Set when the pipeline CANNOT handle this document yet, with the reason. Different from
    # should_fail: that is a document the system correctly declines, this is one it has no
    # answer for. The harness reports these separately and never as wrong, because an
    # unsupported count in every run is a roadmap and a document kept out of the corpus is a
    # forgotten TODO.
    unsupported: str | None = None

    # For documents that are not built from text lines - an image-only PDF, a spreadsheet.
    raw: bytes | None = None
    suffix: str = ".pdf"

    def pdf(self) -> bytes:
        """The document bytes. Named `pdf` because that is what all but two of them are."""
        if self.raw is not None:
            return self.raw
        if self.unsupported and not self.lines:
            return build_image_only_pdf()
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
            "buyer_name": "Pelham Group plc",
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
            "buyer_name": "Kestrel Retail Ltd",
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
            "buyer_name": "Vantage Media",
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
            "buyer_name": "Ashcombe Interiors",
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
            "buyer_name": "Trent Valley Foods",
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
            "buyer_name": "Ridgeway Motors",
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
            "buyer_name": "Bexley Wholesale",
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
            "buyer_name": "Maplewood Care",
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
            "buyer_name": "Halden Construction",
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



# ---------------------------------------------------------------------------------------
# Stage 8: breadth.
#
# The eleven cases above are hand-written, each for one known-hard thing. Getting to thirty
# to forty that way would be thirty to forty hand-typed answer keys, and `02-many-lines` is
# the standing evidence for what that costs: twelve computed line items under three typed
# totals that disagreed with them by 182.00, which sat in the corpus looking clean.
#
# So the rest are built by `_invoice` below, which renders a document and derives its labels
# **from the same values**. That is what "ground truth by construction" actually means, and
# it is only true of the parts genuinely constructed. Every number in the expected block
# below comes from the list the lines are printed from.
#
# Variety here is deliberate rather than random: currencies and separator conventions, date
# formats, label wordings, header orders, table shapes, and the number of line items. What is
# NOT varied is correctness - these documents are all internally consistent, because the
# corpus needs a majority of good documents for an accuracy figure to mean anything, and the
# awkward ones are the eleven above plus the deliberate failures at the end.

_LAYOUTS = 4


def _fmt(value: Decimal, symbol: str, european: bool = False) -> str:
    text = f"{value:,.2f}"
    if european:
        text = text.replace(",", "\x00").replace(".", ",").replace("\x00", ".")
    return f"{symbol}{text}"


def _date(d: date, style: int) -> str:
    return (
        d.isoformat(),
        d.strftime("%d/%m/%Y"),
        d.strftime("%d %B %Y"),
        d.strftime("%b %d, %Y"),
        d.strftime("%d.%m.%Y"),
    )[style % 5]


def _invoice(
    name: str,
    tests: str,
    *,
    vendor: str,
    buyer: str,
    number: str,
    issued: date,
    due: date | None,
    code: str,
    symbol: str,
    items: list[tuple[str, int, str]],
    tax_rate: str = "0.20",
    layout: int = 0,
    date_style: int = 0,
    european: bool = False,
) -> Case:
    """One generated invoice, and its labels, from one set of values.

    The totals are computed from `items`; the printed lines and the expected block are both
    rendered from the results. Nothing in the answer key is typed twice.
    """
    priced = [(desc, qty, Decimal(unit)) for desc, qty, unit in items]
    amounts = [(qty * unit) for _, qty, unit in priced]
    subtotal = sum(amounts, Decimal(0))
    tax = (subtotal * Decimal(tax_rate)).quantize(Decimal("0.01"))
    total = subtotal + tax

    number_label, date_label, due_label, sub_label, tax_label, total_label = (
        ("Invoice Number:", "Invoice Date:", "Due Date:", "Subtotal", "VAT 20%", "Total Due"),
        ("Invoice No.", "Date of Issue:", "Payment Due:", "Net total", "Tax", "Amount Due"),
        ("Our reference", "Issued:", "Pay by", "Goods value", "Sales Tax", "Balance due"),
        ("Document ID", "Tax point", "Settlement by", "Total excl. tax", "GST", "Total payable"),
    )[layout % _LAYOUTS]

    header = (
        "Description               Qty    Unit Price     Amount",
        "Particulars Units Rate Value",
        "Item Quantity Price Total",
        "Details Qty Rate Net",
    )[layout % _LAYOUTS]

    body = [vendor, f"{17 + layout} Fleet Street", "INVOICE", f"{number_label} {number}",
            f"{date_label} {_date(issued, date_style)}"]
    if due is not None:
        body.append(f"{due_label} {_date(due, date_style)}")
    body += [f"Bill To: {buyer}", "", header]
    for (desc, qty, unit), amount in zip(priced, amounts):
        body.append(
            f"{desc:<26}{qty:>3}   {_fmt(unit, symbol, european):>14}"
            f"{_fmt(amount, symbol, european):>16}"
        )
    body += ["", f"{sub_label:<40}{_fmt(subtotal, symbol, european):>16}",
             f"{tax_label:<40}{_fmt(tax, symbol, european):>16}",
             f"{total_label:<40}{_fmt(total, symbol, european):>16}"]

    expected = {
        "invoice_number": number,
        "vendor_name": vendor,
        "buyer_name": buyer,
        "issue_date": issued.isoformat(),
        "due_date": due.isoformat() if due else None,
        "currency": code,
        "subtotal": f"{subtotal:.2f}",
        "tax": f"{tax:.2f}",
        "total": f"{total:.2f}",
        "line_items": [
            {"description": desc, "quantity": str(qty),
             "unit_price": f"{unit:.2f}", "amount": f"{amount:.2f}"}
            for (desc, qty, unit), amount in zip(priced, amounts)
        ],
    }
    return Case(name=name, tests=tests, lines=body, expected=expected)


_GENERATED: list[tuple] = [
    ("Ravensworth Tooling", "Halcyon Foods", "RT-2026-0101", 12, 30, "GBP", "GBP ",
     [("Milling cutter set", 2, "145.00"), ("Delivery", 1, "18.50")], 0, 0, False),
    ("Corrib Marine Ltd", "Portside Traders", "CM-4471", 20, 44, "EUR", "EUR ",
     [("Hull inspection", 1, "820.00"), ("Anode replacement", 6, "47.25")], 1, 1, False),
    ("Wexford Textiles", "Brightmoor Retail", "WT/2026/018", 33, 63, "GBP", "£",
     [("Cotton drill, per metre", 120, "4.65")], 2, 2, False),
    ("Alderman Print", "Cavendish Legal", "AP-2026-3390", 47, 77, "USD", "$",
     [("Letterhead, 500", 1, "212.00"), ("Compliment slips", 2, "84.50"),
      ("Artwork amends", 3, "65.00")], 3, 3, False),
    ("Tallow & Sons", "Northgate Hotels", "TS-9912", 58, 88, "GBP", "GBP ",
     [("Candles, boxed", 40, "12.75"), ("Storage", 1, "95.00")], 0, 4, False),
    ("Kestrel Instruments", "Fenland Water", "KI-2026-0077", 66, 96, "EUR", "EUR ",
     [("Flow meter", 3, "1240.00"), ("Calibration", 3, "180.00")], 1, 0, True),
    ("Bridgehouse Joinery", "Ashfield Schools", "BJ-2026-0450", 74, 104, "GBP", "GBP ",
     [("Door set, oak", 12, "310.00"), ("Ironmongery", 12, "44.00"),
      ("Fitting", 1, "1450.00")], 2, 1, False),
    ("Stonebridge Haulage", "Merrow Aggregates", "SH-2026-2201", 81, 111, "GBP", "GBP ",
     [("Tipper day rate", 5, "480.00"), ("Fuel surcharge", 1, "132.40")], 3, 2, False),
    ("Vantage Analytics", "Redhill Insurance", "VA-2026-0012", 95, 125, "USD", "$",
     [("Platform licence, annual", 1, "18400.00")], 0, 3, False),
    ("Larkspur Catering", "Oakwell Trust", "LC-3308", 103, 118, "GBP", "GBP ",
     [("Buffet, per head", 85, "14.20"), ("Service staff", 4, "120.00"),
      ("Equipment hire", 1, "230.00"), ("Delivery", 1, "45.00")], 1, 4, False),
    ("Penrose Scaffolding", "Harbour Developments", "PS-2026-0819", 112, 142, "GBP", "GBP ",
     [("Erect and dismantle", 1, "3850.00"), ("Weekly hire", 6, "420.00")], 2, 0, False),
    ("Aurora Glassworks", "Lyndhurst Interiors", "AG-2026-0164", 124, 154, "EUR", "€",
     [("Toughened panel", 8, "268.75"), ("Edge polishing", 8, "31.50")], 3, 1, True),
    ("Dunmore Electrical", "Castleford Leisure", "DE-2026-7714", 133, 163, "GBP", "GBP ",
     [("Consumer unit", 2, "410.00"), ("Testing and certification", 1, "295.00"),
      ("Labour, day", 4, "265.00")], 0, 2, False),
    ("Sable Freight", "Windermere Imports", "SF-2026-0555", 141, 171, "USD", "$",
     [("Container haulage", 2, "1875.00"), ("Customs entry", 2, "62.00"),
      ("Demurrage", 3, "145.00")], 1, 3, False),
    ("Thornhill Nurseries", "Greenway Councils", "TN-2026-0290", 150, 180, "GBP", "GBP ",
     [("Semi-mature birch", 24, "185.00"), ("Planting", 24, "42.00"),
      ("Mulch, cubic metre", 15, "38.50")], 2, 4, False),
    ("Marlowe Security", "Kingsbridge Retail", "MS-2026-1120", 158, 188, "GBP", "£",
     [("Monitoring, monthly", 12, "340.00")], 3, 0, False),
    ("Pemberly Stationers", "Ardleigh Chambers", "PST-2026-0044", 167, 197, "GBP", "GBP ",
     [("Copier paper, box", 30, "22.40"), ("Toner", 6, "89.00"),
      ("Binding covers", 10, "12.60"), ("Delivery", 1, "0.00")], 0, 1, False),
    ("Ferrier Plant Hire", "Southgate Civils", "FPH-2026-0623", 176, 206, "GBP", "GBP ",
     [("Excavator, weekly", 3, "1150.00"), ("Operator, day", 15, "290.00"),
      ("Transport", 2, "180.00")], 1, 2, False),
    ("Ledbury Wine Co", "The Copper Kettle", "LW-2026-0908", 185, 215, "EUR", "EUR ",
     [("Case, red", 18, "94.50"), ("Case, white", 12, "88.00"),
      ("Glassware hire", 1, "65.00")], 2, 3, True),
    ("Ashcombe Roofing", "Beaumont Estates", "AR-2026-0337", 193, 223, "GBP", "GBP ",
     [("Slate, per square metre", 240, "68.00"), ("Scaffold", 1, "2400.00"),
      ("Waste removal", 3, "185.00")], 3, 4, False),
    ("Nightingale Medical", "Fairview Practice", "NM-2026-0071", 202, 232, "GBP", "GBP ",
     [("Consumables pack", 45, "18.90"), ("Sharps disposal", 12, "26.00")], 0, 0, False),
    ("Bracken Software", "Delta Logistics", "BS-2026-0505", 211, 241, "USD", "$",
     [("Seats, annual", 40, "295.00"), ("Onboarding", 1, "3500.00")], 1, 1, False),
    ("Whitfield Surveys", "Portland Homes", "WS-2026-0148", 219, 249, "GBP", "GBP ",
     [("Topographic survey", 1, "2250.00"), ("Setting out", 3, "480.00")], 2, 2, False),
    ("Calder Packaging", "Hartley Foods", "CP-2026-1177", 228, 258, "GBP", "GBP ",
     [("Corrugated case", 2400, "0.86"), ("Pallet wrap", 30, "14.20"),
      ("Tape, per roll", 60, "2.35")], 3, 3, False),
]

for _entry in _GENERATED:
    _vendor, _buyer, _number, _issue_off, _due_off, _code, _symbol, _items, _layout, _style, _euro = _entry
    CASES.append(
        _invoice(
            f"{len(CASES) + 1:02d}-{_number.lower().replace('/', '-')}",
            f"Generated breadth: {_code}, layout {_layout}, date style {_style}"
            + (", European separators" if _euro else ""),
            vendor=_vendor, buyer=_buyer, number=_number,
            issued=date(2026, 1, 1) + timedelta(days=_issue_off),
            due=date(2026, 1, 1) + timedelta(days=_due_off),
            code=_code, symbol=_symbol, items=_items,
            layout=_layout, date_style=_style, european=_euro,
        )
    )


# --- documents the pipeline cannot handle yet -------------------------------------------
#
# These exist so the harness reports an unsupported count in every run. That count is a
# roadmap; a document quietly kept out of the corpus is a forgotten TODO, and the difference
# between "we score 94%" and "we score 94% on the 91% of documents we accept" is the whole
# honesty of the number.

CASES += [
    Case(
        name="36-scan-no-text-layer",
        tests="A structurally valid PDF with no text layer, which is what a scan is to "
              "pdfplumber. Not malformed - it opens fine and yields an empty string.",
        lines=[],
        # Nothing is expected: `unsupported` below is the whole statement about this
        # document, and repeating the reason here would be a second place for it to
        # disagree with itself. The guard on `expected` keys caught the duplicate.
        expected={},
        unsupported="no text layer - needs OCR or a vision model, neither of which exists yet",
    ),
    Case(
        name="37-spreadsheet-columns-out-of-order",
        tests="A CSV with the columns in an order nothing expects. The pipeline ingests PDFs "
              "only, so this is refused at the door rather than misread.",
        lines=[],
        expected={},
        unsupported="spreadsheet ingestion is not built; the media check refuses it",
        raw=b"Amount,Description,Unit,Qty\n200.00,Widget assembly,100.00,2\n"
            b"25.00,Freight charge,25.00,1\n",
        suffix=".csv",
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
        pdf_path = directory / f"{case.name}{case.suffix}"
        labels_path = directory / f"{case.name}.labels.json"

        pdf_path.write_bytes(case.pdf())
        labels_path.write_text(
            json.dumps(
                {
                    "name": case.name,
                    "tests": case.tests,
                    "should_fail": case.should_fail,
                    "unsupported": case.unsupported,
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
