"""Rules for what rules are good at, the model for what they are not.

The corpus comparison settled an argument that had been running since stage 3. Over eleven
documents:

    heuristic   11/11 clean, 82/82 fields, 0 arithmetic breaks, 14ms
    trained      1/11 clean, 64/82 fields, 4 arithmetic breaks, 920ms

and the obvious reading is that the model lost and should be dropped. That reading is wrong,
and the per-field numbers say why. The trained model failed because `currency` scored 1/11 -
it had only ever seen a currency on its own labelled line, which no real invoice has - and
`currency` is required, so every document was refused over one field. On the field the rules
*cannot* do it scored:

    buyer_name   trained 9/9      heuristic 0/9

The heuristic does not attempt a buyer and never will: no rule finds one reliably, and a guess
there is worse than a null because a guess goes into the database. The model gets it right on
every corpus document, including the two-page one and the credit note.

So neither extractor is better. They are good at different things, and the mistake was asking
one component to do the whole job:

- **Rules win** on closed vocabularies and anything load-bearing for arithmetic. A currency is
  one of about a dozen codes and three symbols; a total has to equal subtotal plus tax. These
  are things to *check*, not to predict, and a model that gets them slightly wrong produces a
  plausible record that does not add up - which is the failure mode this whole system exists
  to survive. Four of the trained model's eleven documents broke their own arithmetic. None of
  the heuristic's did.
- **The model wins** where the answer is a span of text with no reliable rule around it. That
  is `buyer_name` today, and it is the argument for the weights existing at all.

This extractor takes the heuristic's reading and overlays only the fields named in
`MODEL_FIELDS`. It satisfies the same `Extractor` protocol as the other three, so nothing in
the pipeline, the rules, the review queue or the harness knows the difference.

**It degrades to the heuristic when there are no weights.** They are 250MB, gitignored, and
will not fit a free hosting tier, so the deployed path has to work without them. A checkout
with no model gets exactly the heuristic's behaviour and says so on the row.
"""

from __future__ import annotations

import time

from mailman.invoice import REQUIRED_FIELDS, InvoiceFields, InvoiceRead

PROMPT_VERSION = "hybrid-v1"

# What the model is allowed to override.
#
# Deliberately short, and it is a whitelist rather than a blacklist. Every field the heuristic
# gets right on the corpus stays with the heuristic, because a model that is right 90% of the
# time is worse than a rule that is right 100% of the time - and worse in the specific way this
# project cares about, which is that its mistakes look plausible. A field joins this set when
# the corpus comparison shows the model beating the rules on it, and not before.
MODEL_FIELDS = ("buyer_name",)


class HybridExtractor:
    """The heuristic, with named fields taken from the trained model when it is available."""

    prompt_version = PROMPT_VERSION

    def __init__(self, model_dir: str = "./models/extractor",
                 model_fields: tuple[str, ...] = MODEL_FIELDS) -> None:
        from mailman.heuristic import HeuristicExtractor

        self.model_fields = model_fields
        self.heuristic = HeuristicExtractor()
        self.trained = None
        self.model_note = "unavailable"

        try:
            from mailman.trained import TrainedExtractor

            trained = TrainedExtractor(model_dir=model_dir)
            trained._load()
            self.trained = trained
            self.model_note = trained.model_name
        except Exception as exc:                  # noqa: BLE001 - recorded, never fatal
            # No weights is the normal case for a fresh checkout and for the deployed
            # container. It is recorded on the row rather than raised, because the pipeline
            # must still extract.
            self.model_note = f"unavailable ({type(exc).__name__})"

        self.model_name = (
            f"hybrid:{self.model_note}" if self.trained else "hybrid:heuristic-only"
        )

    def _model_read(self, document_text: str) -> dict | None:
        """The trained model's assembled fields, whether or not it was willing to return them.

        A refusal still carries its `read`, and that is the point: the model refuses these
        documents over `currency`, and its buyer is perfectly good on the same page. Throwing
        the reading away because one required field was missing would discard the only thing
        this class exists to collect.
        """
        from mailman.extractor import ExtractionError

        if self.trained is None:
            return None
        try:
            return self.trained.extract(document_text).raw_response.get("read")
        except ExtractionError as exc:
            raw = exc.raw if isinstance(exc.raw, dict) else {}
            return raw.get("read")
        except Exception:                          # noqa: BLE001 - never fail the pipeline
            return None

    def extract(self, document_text: str):
        from mailman.extractor import ExtractionError, ExtractionResult

        started = time.monotonic()

        # The heuristic runs first and its refusal is authoritative: it is the reading that
        # decides whether this is an invoice at all. `10-not-an-invoice` must still be refused.
        try:
            base = self.heuristic.extract(document_text)
            read_dict = dict(base.raw_response["read"])
            heuristic_refused = None
        except ExtractionError as exc:
            raw = exc.raw if isinstance(exc.raw, dict) else {}
            read_dict = dict(raw.get("read") or {})
            heuristic_refused = exc

        overlaid: dict[str, str] = {}
        model_read = self._model_read(document_text)
        if model_read and read_dict:
            for name in self.model_fields:
                value = model_read.get(name)
                if value and not read_dict.get(name):
                    read_dict[name] = value
                    overlaid[name] = value

        if not read_dict:
            raise heuristic_refused or ExtractionError(
                "missing_fields", "nothing could be read from this document"
            )

        read = InvoiceRead(**read_dict)
        found = [n for n in REQUIRED_FIELDS if getattr(read, n, None)]
        read.confidence = round(len(found) / len(REQUIRED_FIELDS), 4)
        read.unreadable = [n for n in REQUIRED_FIELDS if not getattr(read, n, None)]

        fields = InvoiceFields(read)
        latency_ms = int((time.monotonic() - started) * 1000)

        raw = {
            "extractor": "hybrid",
            "heuristic_refused": str(heuristic_refused) if heuristic_refused else None,
            # Which fields the model contributed, so a row can be read back and the model's
            # contribution audited without rerunning anything. If this is empty on every
            # document, the weights are not earning their 250MB.
            "model_fields": self.model_fields,
            "model_overlaid": overlaid,
            "model": self.model_note,
            "read": read.model_dump(),
        }

        # A hybrid cannot rescue a document the heuristic refused unless the model supplied
        # the missing field. Re-checking rather than re-raising is what lets it do that.
        if fields.missing_required:
            raise ExtractionError(
                "missing_fields",
                "required field(s) not found: " + ", ".join(fields.missing_required),
                raw=raw,
            )

        return ExtractionResult(
            fields=fields,
            raw_response=raw,
            model_name=self.model_name,
            prompt_version=self.prompt_version,
            latency_ms=latency_ms,
            token_count=0,
        )
