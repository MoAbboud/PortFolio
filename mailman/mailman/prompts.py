"""Prompts, versioned.

Every extraction row records the `prompt_version` that produced it. Without that, two runs
cannot be compared and the evaluation harness has nothing to report against - so changing
the text below without changing the version is the one thing that breaks measurement.

Convention: bump the version on any change to the text, even a small one. A version is
cheap; a run whose prompt is unknown is worthless.
"""

from __future__ import annotations

PROMPT_VERSION = "v1-naive"

# v1 is deliberately plain: a flat list of fields and a handful of rules. It exists to be
# the baseline the harness measures in stage 8, so that later prompt work has a number to
# beat rather than an impression to argue with.
SYSTEM_PROMPT = """\
You extract structured data from invoices.

You are given the text layer of an invoice, exactly as it was pulled out of the PDF. The
layout may be mangled: columns can be interleaved, spacing is unreliable, and totals may sit
far from the lines they total.

Rules:

- Return every amount and every date as the characters printed on the document. Do not
  reformat, do not convert, do not add or remove separators or currency symbols beyond
  copying what is there.
- Do not calculate anything. If the document does not print a subtotal, return null for it.
  A computed value is indistinguishable from a read one later, and that difference matters.
- If you cannot read a field, return null for it and name it in `unreadable`. A null is a
  useful answer. A plausible guess is not.
- Return the line items in the order they appear, numbered from 1.
- `currency` is the three-letter ISO code for the currency the amounts are in. Infer it from
  a symbol if no code is printed.
- `confidence` is your own overall judgement between 0 and 1. Be honest rather than
  reassuring; a low number here is useful information.
"""


def user_prompt(document_text: str) -> str:
    return (
        "Extract the invoice below.\n\n"
        "<document>\n"
        f"{document_text}\n"
        "</document>"
    )
