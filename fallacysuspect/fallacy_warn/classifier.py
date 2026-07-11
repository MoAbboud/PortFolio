"""Local two-stage classifier backend.

Serves the trained DistilBERT models (detector -> typer) instead of the paid LLM
API — zero per-inference cost. The models classify a whole passage, so to
recreate the app's span highlighting we run *sentence by sentence*: each sentence
is checked for fallacy-vs-valid, and flagged sentences get a predicted type.

Model files live in ``models/two_stage/`` (override with ``FALLACY_MODEL_DIR``):
    pipeline.json, detector_distilbert/, typer_distilbert/

Returns the same ``AnalysisResult`` / ``Flag`` shape the rest of the app uses, so
the web UI and CLI work unchanged.
"""

from __future__ import annotations

import json
import os
import re
from functools import lru_cache
from pathlib import Path

from .config import bucket_warning
from .models import AnalysisResult, Flag

_DEFAULT_DIR = Path(__file__).resolve().parent.parent / "models" / "two_stage"
_REQUIRED = ("pipeline.json", "detector_distilbert", "typer_distilbert")

# One-line, static descriptions for the trained (LOGIC) taxonomy. The model gives
# the label; these give the "why" without another model call.
DESCRIPTIONS = {
    "ad hominem": "Attacks the person making the argument instead of the argument itself.",
    "ad populum": "Claims something is true or good because many people believe it.",
    "appeal to emotion": "Uses emotion in place of evidence to win the point.",
    "circular reasoning": "The conclusion is assumed in the premises — the argument loops back on itself.",
    "equivocation": "Leans on a key word that shifts meaning between parts of the argument.",
    "fallacy of credibility": "Appeals to an authority or source whose credibility is misplaced or irrelevant.",
    "fallacy of extension": "Attacks an exaggerated or distorted version of the opponent's position (straw man).",
    "fallacy of logic": "A flaw in the logical structure of the argument.",
    "fallacy of relevance": "Brings in points that have nothing to do with the actual issue (red herring).",
    "false causality": "Assumes that because one thing followed another, the first caused the second.",
    "false dilemma": "Presents only two options when more exist.",
    "faulty generalization": "Draws a broad conclusion from too few or unrepresentative examples.",
    "intentional": "Uses a deliberate rhetorical trick or deception to mislead.",
}


def model_dir() -> Path:
    return Path(os.environ.get("FALLACY_MODEL_DIR", str(_DEFAULT_DIR)))


def is_available() -> bool:
    """True if the trained models are present and the ML deps import."""
    d = model_dir()
    if not all((d / r).exists() for r in _REQUIRED):
        return False
    try:
        import torch  # noqa: F401
        import transformers  # noqa: F401
    except ImportError:
        return False
    return True


@lru_cache(maxsize=1)
def _load():
    """Load both stages once and cache them."""
    import torch
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    d = model_dir()
    meta = json.loads((d / "pipeline.json").read_text(encoding="utf-8"))
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    def load_one(sub):
        tok = AutoTokenizer.from_pretrained(str(d / sub))
        mdl = AutoModelForSequenceClassification.from_pretrained(str(d / sub)).to(device).eval()
        return tok, mdl

    det_tok, det_mdl = load_one("detector_distilbert")
    typ_tok, typ_mdl = load_one("typer_distilbert")
    return {
        "device": device,
        "max_len": int(meta.get("max_len", 80)),
        "det": (det_tok, det_mdl, list(meta["detector_classes"])),
        "typ": (typ_tok, typ_mdl, list(meta["typer_classes"])),
    }


def _predict(tok, mdl, classes, text, max_len, device):
    """Return (predicted_label, confidence) for one text."""
    import torch

    # DistilBERT has no token_type embeddings — don't emit token_type_ids.
    enc = tok(text, truncation=True, max_length=max_len,
              return_token_type_ids=False, return_tensors="pt").to(device)
    with torch.no_grad():
        logits = mdl(**enc).logits[0]
    probs = torch.softmax(logits, dim=-1)
    idx = int(probs.argmax())
    return classes[idx], float(probs[idx])


_SENTENCE = re.compile(r"[^.!?\n]+[.!?]*")


def split_sentences(text: str) -> list[str]:
    """Split into sentence-ish chunks that are verbatim substrings of ``text``."""
    out = []
    for m in _SENTENCE.finditer(text):
        s = m.group().strip()
        if len(s) >= 3:
            out.append(s)
    return out


def analyze(text: str) -> AnalysisResult:
    """Two-stage, sentence-level analysis using the local models."""
    if not text or not text.strip():
        return AnalysisResult(text=text, flags=[])

    state = _load()
    det_tok, det_mdl, det_classes = state["det"]
    typ_tok, typ_mdl, typ_classes = state["typ"]
    max_len, device = state["max_len"], state["device"]

    flags: list[Flag] = []
    for sentence in split_sentences(text):
        verdict, _ = _predict(det_tok, det_mdl, det_classes, sentence, max_len, device)
        if verdict != "fallacy":
            continue
        ftype, conf = _predict(typ_tok, typ_mdl, typ_classes, sentence, max_len, device)
        flags.append(
            Flag(
                fallacy_type=ftype,
                span=sentence,
                confidence=conf,
                warning_level=bucket_warning(conf),
                explanation=DESCRIPTIONS.get(ftype, "Possible logical fallacy."),
                charitable_read=None,
            )
        )
    return AnalysisResult(text=text, flags=flags)


def _main(argv=None):  # pragma: no cover - manual smoke test
    import argparse

    from .display import print_report

    p = argparse.ArgumentParser(prog="fallacy_warn.classifier", description="Local model smoke test")
    src = p.add_mutually_exclusive_group(required=True)
    src.add_argument("--text")
    src.add_argument("--file")
    args = p.parse_args(argv)
    text = args.text if args.text is not None else open(args.file, encoding="utf-8").read()
    print_report(analyze(text))


if __name__ == "__main__":  # pragma: no cover
    _main()
