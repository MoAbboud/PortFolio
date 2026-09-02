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

import json
import logging
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


log = logging.getLogger(__name__)

MANIFEST_NAME = "mailman_model.json"


class ModelNotAvailable(RuntimeError):
    """No weights on disk. Expected on a clean checkout - the weights are not in git."""


class ModelMismatch(RuntimeError):
    """The weights were trained against a different label set than this code expects."""


class TrainedExtractor:
    """Loads the trained tagger once and reuses it."""

    prompt_version = "trained-v1"

    def __init__(self, model_dir: str = "./models/extractor") -> None:
        self.model_dir = Path(model_dir)
        self.model_name = f"trained:{self.model_dir.name}"
        self.manifest: dict | None = None
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

        self.manifest = self._read_manifest()

        # Imported lazily. transformers and torch are a large install and the default path
        # never touches them, so a checkout that only runs the heuristic never pays for it.
        from transformers import pipeline as hf_pipeline

        self._pipeline = hf_pipeline(
            "token-classification",
            model=str(self.model_dir),
            # "first", not "simple". Training labels only the FIRST word-piece of each word
            # and masks the rest with -100, so the model never learns to label a
            # continuation piece. "simple" trusts every piece's own prediction and so breaks
            # a span at the first continuation it meets - which returned "in" for
            # INV-2026-0042 and "##dget assembly" for a description. "first" takes the
            # leading piece's label for the whole word, which is the labelling scheme the
            # model was actually trained under.
            aggregation_strategy="first",
            # CPU. There is no GPU in the container, and saying so explicitly beats
            # discovering it through a slow first request.
            device=-1,
        )
        return self._pipeline

    def _read_manifest(self) -> dict | None:
        """Read what the notebook recorded about these weights, and check they fit.

        The manifest carries the label set, the base model, the training set size and the
        scores. It exists so a set of weights is self-describing: numbers that live only in
        a notebook output someone closed are numbers nobody can cite.

        The label check is the load-bearing part. Retraining with a changed label set and
        dropping the weights in place would otherwise produce an extractor that quietly
        tags the wrong fields, and nothing downstream would notice.
        """
        path = self.model_dir / MANIFEST_NAME
        if not path.exists():
            log.warning(
                "%s has no %s - it was not exported by notebooks/train_extractor.ipynb, "
                "so its label set and its scores are unknown",
                self.model_dir,
                MANIFEST_NAME,
            )
            return None

        manifest = json.loads(path.read_text(encoding="utf-8"))

        trained_fields = tuple(manifest.get("field_labels") or ())
        if trained_fields and trained_fields != FIELD_LABELS:
            missing = sorted(set(FIELD_LABELS) - set(trained_fields))
            extra = sorted(set(trained_fields) - set(FIELD_LABELS))
            raise ModelMismatch(
                f"the weights in {self.model_dir} were trained on a different label set. "
                f"Missing here: {missing or 'none'}. Unexpected: {extra or 'none'}. "
                "Retrain with the current notebook, or update FIELD_LABELS to match."
            )

        # Recorded on the extraction row, so a stored extraction says which training run
        # produced it rather than only which directory it was loaded from.
        trained_at = (manifest.get("trained_at") or "")[:10]
        if trained_at:
            self.model_name = f"trained:{self.model_dir.name}@{trained_at}"

        log.info(
            "loaded %s trained %s on %s examples, overall F1 %s",
            self.model_dir,
            trained_at or "at an unknown date",
            manifest.get("training_examples", "?"),
            manifest.get("overall_entity_f1", "?"),
        )
        return manifest

    def extract(self, document_text: str):
        from mailman.extractor import ExtractionError, ExtractionResult

        try:
            tagger = self._load()
        except (ModelNotAvailable, ModelMismatch) as exc:
            raise ExtractionError("unavailable", str(exc)) from exc

        # The load is not part of the measurement. It happens once per process and would
        # otherwise report seventeen seconds for every first document and milliseconds after.
        started = time.monotonic()
        spans = tagger(document_text)
        read = self._assemble(spans, document_text)
        fields = InvoiceFields(read)
        latency_ms = int((time.monotonic() - started) * 1000)

        raw = {
            "extractor": "trained",
            "model_dir": str(self.model_dir),
            # Kept on the row so an extraction can be traced to the training run behind it,
            # not just to a directory whose contents may since have been replaced.
            "trained_at": (self.manifest or {}).get("trained_at"),
            "training_examples": (self.manifest or {}).get("training_examples"),
            "overall_entity_f1": (self.manifest or {}).get("overall_entity_f1"),
            "spans": [
                {
                    "label": span.get("entity_group"),
                    "text": self._text_of(span, document_text),
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

    @staticmethod
    def _text_of(span: dict, document_text: str) -> str:
        """Return what the document actually says at this span.

        The pipeline's `word` is detokenized from word-pieces, which lowercases (this is an
        uncased model) and inserts spaces around punctuation - INV-2026-0042 comes back as
        "inv - 2026 - 0042". The span also carries character offsets into the original text,
        so the source substring is available and is what the document really said. Use that.
        """
        start, end = span.get("start"), span.get("end")
        if start is not None and end is not None:
            surface = document_text[start:end].strip()
            if surface:
                return surface
        return (span.get("word") or "").strip()

    def _assemble(self, spans: list[dict], document_text: str = "") -> InvoiceRead:
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
            text = self._text_of(span, document_text)
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
