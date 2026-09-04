"""Choosing which extractor runs.

Three implementations of one protocol, selected by configuration:

  heuristic   regular expressions and layout rules. No key, no weights, no network, no
              cost. The default, the deployable one, and the baseline every other approach
              has to beat.
  hybrid      the heuristic, with buyer_name taken from the trained model when its weights
              are present. Rules for closed vocabularies and anything arithmetic depends on,
              the model for the one field no rule finds. Degrades to the heuristic exactly
              when there are no weights, so it is safe to deploy.
  trained     a token classifier trained locally and loaded from disk. Free to run, but the
              weights are too large for git and for a free hosting tier, so it is the local
              and showcase path rather than the deployed one.
  anthropic   the hosted model. Kept because comparing against it is informative, not
              because anything here depends on it. Needs a key and costs money per call.

That switching between them is one setting and nothing else is what the Extractor protocol
was for. Nothing in the pipeline, the rules, the review queue or the harness knows which one
produced a given extraction - they read `model_name` on the row and carry on.
"""

from __future__ import annotations

from mailman.config import settings
from mailman.extractor import Extractor


class UnknownExtractor(ValueError):
    pass


def build_extractor(name: str | None = None) -> Extractor:
    """Return the configured extractor. Imports are local so an unused path costs nothing."""
    choice = (name or settings.extractor).strip().lower()

    if choice == "heuristic":
        from mailman.heuristic import HeuristicExtractor

        return HeuristicExtractor()

    if choice == "hybrid":
        from mailman.hybrid import HybridExtractor

        return HybridExtractor(model_dir=settings.model_dir)

    if choice == "trained":
        from mailman.trained import TrainedExtractor

        return TrainedExtractor(model_dir=settings.model_dir)

    if choice == "anthropic":
        from mailman.extractor import AnthropicExtractor

        return AnthropicExtractor(
            api_key=settings.anthropic_api_key,
            model_name=settings.extraction_model,
            max_tokens=settings.extraction_max_tokens,
            timeout_seconds=settings.extraction_timeout_seconds,
            max_retries=settings.extraction_max_retries,
        )

    raise UnknownExtractor(
        f"unknown extractor {choice!r}; expected one of heuristic, hybrid, trained, anthropic"
    )
