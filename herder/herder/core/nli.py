"""Natural language inference, for the adjudication half of the merge step.

A cross-encoder rather than a generative model, and that is a design choice rather than a
compromise - see the reasoning in `herder/domain/merge.py`. Entailment, contradiction and
neutral are almost exactly the distinctions the four merge verdicts need, and entailment is
a measurement where a generative model's chosen label and confidence are not.

Runs in-process through `sentence-transformers` on CPU. Unlike the extractor, this is small
enough that a second inference stack is worth it: adjudication happens only for candidates
that clear the similarity threshold, and a cross-encoder answers in tens of milliseconds
where a round trip to a 3B generative model is seconds.

**The label order is read from the model's own config, never assumed.** Different NLI
checkpoints order their labels differently, and hardcoding `[contradiction, entailment,
neutral]` would silently invert the merge verdicts on a model that used another order -
producing a system that confidently merged contradictions and superseded duplicates, with
no error anywhere.
"""

from __future__ import annotations

import logging
import time

from herder.core.config import get_settings
from herder.domain.merge import CONTRADICTION, ENTAILMENT, NEUTRAL, Label

log = logging.getLogger("herder.nli")

EXPECTED_LABELS = {CONTRADICTION, ENTAILMENT, NEUTRAL}

# Fact-verification checkpoints (the FEVER and VitaminC line) use the same three distinctions under
# different names. The mapping is written out rather than guessed at, and anything not in this table
# is still refused: "supports" means the evidence entails the claim, "refutes" means it contradicts
# it, and "not enough info" is neutral. Added at stage 10 while comparing checkpoints, because the
# revision-trained models - the ones built on claims that change, which is this project's hardest
# merge case - all ship these names.
LABEL_ALIASES = {
    "supports": ENTAILMENT,
    "support": ENTAILMENT,
    "refutes": CONTRADICTION,
    "refute": CONTRADICTION,
    "not enough info": NEUTRAL,
    "not_enough_info": NEUTRAL,
    "nei": NEUTRAL,
}


class NliUnavailable(RuntimeError):
    """The model cannot be loaded or does not look like an NLI model."""


class CrossEncoderNli:
    name = "cross-encoder"

    def __init__(self, model=None) -> None:
        settings = get_settings()
        self.model_name = settings.nli_model
        self._model = model
        self._labels: dict[int, str] | None = None
        self.last_latency_ms = 0
        if model is not None:
            self._labels = self._read_labels(model)

    # ------------------------------------------------------------------ loading

    def _load(self):
        if self._model is not None:
            return self._model
        try:
            from sentence_transformers import CrossEncoder
        except ImportError as exc:
            raise NliUnavailable(
                "sentence-transformers is not installed; pip install -r requirements.txt"
            ) from exc

        try:
            model = CrossEncoder(self.model_name)
        except Exception as exc:
            raise NliUnavailable(
                f"could not load the NLI model {self.model_name!r}. It is downloaded once "
                "and cached under the HuggingFace cache; check the name and that there is "
                f"disk space and a network for the first load. ({type(exc).__name__}: {exc})"
            ) from exc

        self._labels = self._read_labels(model)
        self._model = model
        return model

    @staticmethod
    def _read_labels(model) -> dict[int, str]:
        raw = getattr(getattr(model, "config", None), "id2label", None)
        if not raw:
            raise NliUnavailable(
                "the model exposes no id2label mapping, so its output columns cannot be "
                "interpreted. Refusing rather than assuming an order - a wrong guess would "
                "invert every merge verdict silently."
            )

        labels = {int(k): str(v).strip().lower() for k, v in raw.items()}
        labels = {index: LABEL_ALIASES.get(name, name) for index, name in labels.items()}
        if set(labels.values()) != EXPECTED_LABELS:
            raise NliUnavailable(
                f"{sorted(labels.values())} does not look like an NLI head. Expected exactly "
                f"{sorted(EXPECTED_LABELS)}, or the fact-verification names "
                f"{sorted(LABEL_ALIASES)}."
            )
        return labels

    def check_ready(self) -> None:
        self._load()

    # ------------------------------------------------------------------ inference

    def classify(self, pairs: list[tuple[str, str]]) -> list[Label]:
        """Classify (premise, hypothesis) pairs into a label and a probability each."""
        if not pairs:
            return []

        model = self._load()
        assert self._labels is not None

        started = time.perf_counter()
        raw = model.predict(pairs)
        self.last_latency_ms = int((time.perf_counter() - started) * 1000)

        results: list[Label] = []
        for row in raw:
            scores = list(row)
            probabilities = _softmax(scores)
            best = max(range(len(probabilities)), key=probabilities.__getitem__)
            results.append(Label(self._labels[best], float(probabilities[best])))
        return results

    def both_ways(self, candidate: str, existing: str) -> tuple[Label, Label]:
        """The two directions the merge verdicts need.

        Forward is candidate-entails-existing, backward is existing-entails-candidate. The
        asymmetry is the point: it separates "adds detail" from "adds nothing".
        """
        forward, backward = self.classify([(candidate, existing), (existing, candidate)])
        return forward, backward


def _softmax(scores: list[float]) -> list[float]:
    """Logits to probabilities, shifted for numerical stability."""
    import math

    if not scores:
        return []
    top = max(scores)
    exponentials = [math.exp(s - top) for s in scores]
    total = sum(exponentials)
    return [e / total for e in exponentials]
