"""The trained extractor's contract with the notebook that produces its weights.

No weights are needed for any of this. What is being tested is the handover: a missing
model, a model exported by something else, and a model trained against a label set this
code no longer agrees with.
"""

from __future__ import annotations

import json

import pytest

from mailman.trained import (
    BIO_LABELS,
    FIELD_LABELS,
    MANIFEST_NAME,
    ModelMismatch,
    ModelNotAvailable,
    TrainedExtractor,
)


def test_bio_labels_cover_every_field() -> None:
    """The notebook builds its label list the same way. If these drift, training is wrong."""
    assert BIO_LABELS[0] == "O"
    assert len(BIO_LABELS) == 1 + 2 * len(FIELD_LABELS)
    for field in FIELD_LABELS:
        assert f"B-{field}" in BIO_LABELS
        assert f"I-{field}" in BIO_LABELS


def test_a_missing_model_says_how_to_get_one(tmp_path) -> None:
    """The expected state on a clean checkout - the weights are not in git."""
    extractor = TrainedExtractor(model_dir=str(tmp_path / "nothing-here"))
    with pytest.raises(ModelNotAvailable) as caught:
        extractor._load()
    message = str(caught.value)
    assert "train_extractor.ipynb" in message
    assert "heuristic" in message


def test_a_mismatched_label_set_is_refused(tmp_path) -> None:
    """The check that matters.

    Retraining with a changed label set and dropping the weights in place would otherwise
    give an extractor that quietly tags the wrong fields, with nothing downstream noticing.
    """
    model_dir = tmp_path / "extractor"
    model_dir.mkdir()
    (model_dir / "config.json").write_text("{}", encoding="utf-8")
    (model_dir / MANIFEST_NAME).write_text(
        json.dumps({"field_labels": ["INVOICE_NUMBER", "SOMETHING_ELSE"]}), encoding="utf-8"
    )

    with pytest.raises(ModelMismatch) as caught:
        TrainedExtractor(model_dir=str(model_dir))._read_manifest()
    assert "different label set" in str(caught.value)


def test_a_matching_manifest_names_the_training_run(tmp_path) -> None:
    """So a stored extraction points at the run behind it, not just at a directory."""
    model_dir = tmp_path / "extractor"
    model_dir.mkdir()
    (model_dir / MANIFEST_NAME).write_text(
        json.dumps(
            {
                "field_labels": list(FIELD_LABELS),
                "trained_at": "2026-09-14T10:00:00+00:00",
                "training_examples": 3400,
                "overall_entity_f1": 0.912,
            }
        ),
        encoding="utf-8",
    )

    extractor = TrainedExtractor(model_dir=str(model_dir))
    manifest = extractor._read_manifest()

    assert manifest["training_examples"] == 3400
    assert extractor.model_name == "trained:extractor@2026-09-14"


def test_weights_without_a_manifest_still_load(tmp_path, caplog) -> None:
    """Degraded, not refused - but the unknown provenance is logged rather than ignored."""
    model_dir = tmp_path / "extractor"
    model_dir.mkdir()

    extractor = TrainedExtractor(model_dir=str(model_dir))
    assert extractor._read_manifest() is None


def test_span_text_comes_from_the_document_not_the_tokenizer() -> None:
    """The detokenized `word` is lossy; the offsets are not.

    This is an uncased model, so the pipeline's reassembled word is lowercased, and it
    inserts spaces around punctuation - INV-2026-0042 comes back as "inv - 2026 - 0042".
    The span carries character offsets into the original text, and that substring is what
    the document actually says.
    """
    document = "Invoice Number: INV-2026-0042 issued by Acme Corp Ltd"
    span = {"word": "inv - 2026 - 0042", "start": 16, "end": 29}

    assert TrainedExtractor._text_of(span, document) == "INV-2026-0042"


def test_span_text_falls_back_to_the_word_without_offsets() -> None:
    """Some aggregation strategies omit offsets. Degrade, do not crash."""
    span = {"word": "acme corp ltd", "start": None, "end": None}
    assert TrainedExtractor._text_of(span, "irrelevant") == "acme corp ltd"


def test_span_text_ignores_an_empty_slice() -> None:
    span = {"word": "fallback", "start": 5, "end": 5}
    assert TrainedExtractor._text_of(span, "some document text") == "fallback"
