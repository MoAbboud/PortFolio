"""Serving a locally trained extractor.

The model is a token classifier: it labels each word of the document text with the field it
belongs to (BIO tagging), and the labelled spans are assembled back into the same
`InvoiceRead` shape everything else reads. Training happens in
`notebooks/train_extractor.ipynb`, on Colab's free GPU, and produces a directory of weights.

Why this and not a generative model: the pipeline already has the text layer, the fields
wanted are spans that physically appear on the page, and a tagger returns *where* it found
each value rather than a value it may have invented. A span that came from the document
cannot be a hallucination, which removes an entire class of failure this system would
otherwise have to defend against.

The weights are not in git - they are too large - and they will not fit a free hosting
tier's memory. This is the local and showcase path. `heuristic` is what deploys.
"""

from __future__ import annotations

import time
from pathlib import Path

from mailman.invoice import REQUIRED_FIELDS, InvoiceFields, InvoiceRead, LineItemRead

# The label set the notebook trains against. Kept here, beside the code that consumes it, so
# a change in one is visible to the other.
FIELD_LABELS: tuple[str, ...] = (
    "INVOICE_NUMBER",
    "VENDOR_NAME",
    "BUYER_NAME",
    "ISSUE_DATE",
    "DUE_DATE",
    "CURRENCY",
    "SUBTOTAL",
    "TAX",
    "TOTAL",
    "LINE_DESCRIPTION",
    "LINE_QUANTITY",
    "LINE_UNIT_PRICE",
    "LINE_AMOUNT",
)

BIO_LABELS: tuple[str, ...] = ("O",) + tuple(
    f"{prefix}-{field}" for field in FIELD_LABELS for prefix in ("B", "I")
)

_HEADER_FIELDS = {
    "INVOICE_NUMBER": "invoice_number",
    "VENDOR_NAME": "vendor_name",
    "BUYER_NAME": "buyer_name",
    "ISSUE_DATE": "issue_date",
    "DUE_DATE": "due_date",
    "CURRENCY": "currency",
    "SUBTOTAL": "subtotal",
    "TAX": "tax",
    "TOTAL": "total",
}


class ModelNotAvailable(RuntimeError):
    """No weights on disk. Expected on a clean checkout - the weights are not in git."""


class TrainedExtractor:
    """Loads the trained tagger once and reuses it."""

    prompt_version = "trained-v1"

    def __init__(self, model_dir: str = "./models/extractor") -> None:
        self.model_dir = Path(model_dir)
        self.model_name = f"trained:{self.model_dir.name}"
        self._pipeline = None

    def _load(self):
        if self._pipeline is not None:
            return self._pipeline

        if not (self.model_dir / "config.json").exists():
            raise ModelNotAvailable(
                f"no trained model at {self.model_dir}. Train one with "
                "notebooks/train_extractor.ipynb on Colab and unzip the result there, "
                "or set MAILMAN_EXTRACTOR=heuristic."
            )

        # Imported lazily. transformers and torch are a large install and the default path
        # never touches them, so a checkout that only runs the heuristic never pays for it.
        from transformers import pipeline as hf_pipeline

        self._pipeline = hf_pipeline(
            "token-classification",
            model=str(self.model_dir),
            aggregation_strategy="simple",
        )
        return self._pipeline

    def extract(self, document_text: str):
        from mailman.extractor import ExtractionError, ExtractionResult

        started = time.monotonic()
        try:
            tagger = self._load()
        except ModelNotAvailable as exc:
            raise ExtractionError("unavailable", str(exc)) from exc

        spans = tagger(document_text)
        read = self._assemble(spans)
        fields = InvoiceFields(read)
        latency_ms = int((time.monotonic() - started) * 1000)

        raw = {
            "extractor": "trained",
            "model_dir": str(self.model_dir),
            "spans": [
                {
                    "label": span.get("entity_group"),
                    "text": span.get("word"),
                    "score": float(span.get("score", 0.0)),
                    "start": span.get("start"),
                    "end": span.get("end"),
                }
                for span in spans
            ],
        }

        if fields.missing_required:
            raise ExtractionError(
                "missing_fields",
                "required field(s) not tagged: " + ", ".join(fields.missing_required),
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

    def _assemble(self, spans: list[dict]) -> InvoiceRead:
        """Turn tagged spans back into the invoice shape.

        Header fields take the highest-scoring span for their label. Line item parts are
        grouped by the order they appear, which is the simplest assumption that works on a
        single-column table and the first thing the harness will show to be wrong on a
        complicated one.
        """
        best: dict[str, dict] = {}
        line_parts: dict[str, list[str]] = {
            "LINE_DESCRIPTION": [],
            "LINE_QUANTITY": [],
            "LINE_UNIT_PRICE": [],
            "LINE_AMOUNT": [],
        }
        model_scores: list[float] = []

        for span in spans:
            label = span.get("entity_group")
            text = (span.get("word") or "").strip()
            score = float(span.get("score", 0.0))
            if not label or not text:
                continue
            model_scores.append(score)

            if label in line_parts:
                line_parts[label].append(text)
            elif label in _HEADER_FIELDS:
                if label not in best or score > best[label]["score"]:
                    best[label] = {"text": text, "score": score}

        values = {
            attribute: best.get(label, {}).get("text")
            for label, attribute in _HEADER_FIELDS.items()
        }

        descriptions = line_parts["LINE_DESCRIPTION"]
        line_items = [
            LineItemRead(
                line_no=index + 1,
                description=description,
                quantity=_at(line_parts["LINE_QUANTITY"], index),
                unit_price=_at(line_parts["LINE_UNIT_PRICE"], index),
                amount=_at(line_parts["LINE_AMOUNT"], index),
            )
            for index, description in enumerate(descriptions)
        ]

        return InvoiceRead(
            **values,
            line_items=line_items,
            # The mean span score. A real number from the model, and still the weakest of
            # the confidence signals - it says the tagger was sure, not that it was right.
            confidence=round(sum(model_scores) / len(model_scores), 4) if model_scores else 0.0,
            unreadable=[name for name in REQUIRED_FIELDS if not values.get(name)],
        )


def _at(items: list[str], index: int) -> str | None:
    return items[index] if index < len(items) else None
