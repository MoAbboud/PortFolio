"""Local two-stage classifier backend.

Serves trained models (detector -> typer) instead of the paid LLM API — zero
per-inference cost. Two model *kinds* are supported per stage:

  * ``tfidf`` — a scikit-learn TF-IDF + LogisticRegression pipeline (a few MB,
    no torch, tiny RAM). Small enough to commit to git and deploy free.
  * ``bert``  — a fine-tuned DistilBERT (much stronger, but ~250 MB + ~2 GB RAM).

By default each stage auto-picks the strongest kind actually available:
DistilBERT when the model files *and* torch are present, otherwise TF-IDF. Force
one with ``FALLACY_MODEL_KIND=tfidf|bert``.

The models classify a whole passage, so to recreate the app's span highlighting we
run *sentence by sentence*: each sentence is checked fallacy-vs-valid, and flagged
sentences get a predicted type. Returns the app's ``AnalysisResult`` / ``Flag`` shape.

Model files live in ``models/two_stage/`` (override with ``FALLACY_MODEL_DIR``):
    pipeline.json
    detector_tfidf.joblib   / detector_distilbert/
    typer_tfidf.joblib      / typer_distilbert/
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

# One-line, static descriptions for the trained (LOGIC) taxonomy.
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


def _sklearn_ok() -> bool:
    try:
        import joblib  # noqa: F401
        import sklearn  # noqa: F401
    except ImportError:
        return False
    return True


def _torch_ok() -> bool:
    try:
        import torch  # noqa: F401
        import transformers  # noqa: F401
    except ImportError:
        return False
    return True


def _stage_files(prefix: str) -> dict[str, Path]:
    d = model_dir()
    return {"tfidf": d / f"{prefix}_tfidf.joblib", "bert": d / f"{prefix}_distilbert"}


def _stage_kind(prefix: str) -> str | None:
    """Which model kind to use for a stage ('bert'/'tfidf'), or None if unavailable."""
    override = os.environ.get("FALLACY_MODEL_KIND", "").lower()
    f = _stage_files(prefix)
    has_tfidf = f["tfidf"].exists() and _sklearn_ok()
    has_bert = f["bert"].exists() and _torch_ok()
    if override == "tfidf":
        return "tfidf" if has_tfidf else None
    if override == "bert":
        return "bert" if has_bert else None
    # auto: prefer the stronger model when fully available
    if has_bert:
        return "bert"
    if has_tfidf:
        return "tfidf"
    return None


def is_available() -> bool:
    """True if a usable model exists for both stages."""
    if not (model_dir() / "pipeline.json").exists():
        return False
    return _stage_kind("detector") is not None and _stage_kind("typer") is not None


def _load_stage(prefix: str, classes: list[str]) -> dict:
    kind = _stage_kind(prefix)
    f = _stage_files(prefix)
    if kind == "bert":
        import torch
        from transformers import AutoModelForSequenceClassification, AutoTokenizer

        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        tok = AutoTokenizer.from_pretrained(str(f["bert"]))
        mdl = AutoModelForSequenceClassification.from_pretrained(str(f["bert"])).to(device).eval()
        return {"kind": "bert", "classes": classes, "tok": tok, "mdl": mdl, "device": device}
    if kind == "tfidf":
        import joblib

        return {"kind": "tfidf", "classes": classes, "pipe": joblib.load(f["tfidf"])}
    raise RuntimeError(f"no model available for stage {prefix!r}")


@lru_cache(maxsize=1)
def _load() -> dict:
    d = model_dir()
    meta = json.loads((d / "pipeline.json").read_text(encoding="utf-8"))
    return {
        "max_len": int(meta.get("max_len", 80)),
        "det": _load_stage("detector", list(meta["detector_classes"])),
        "typ": _load_stage("typer", list(meta["typer_classes"])),
    }


def _predict(stage: dict, text: str, max_len: int) -> tuple[str, float]:
    """Return (predicted_label, confidence) for one text."""
    if stage["kind"] == "bert":
        import torch

        enc = stage["tok"](text, truncation=True, max_length=max_len,
                           return_token_type_ids=False, return_tensors="pt").to(stage["device"])
        with torch.no_grad():
            probs = torch.softmax(stage["mdl"](**enc).logits[0], dim=-1)
        idx = int(probs.argmax())
        conf = float(probs[idx])
    else:  # tfidf — pipeline predicts the encoded class index
        pipe = stage["pipe"]
        idx = int(pipe.predict([text])[0])
        try:
            conf = float(pipe.predict_proba([text])[0].max())
        except Exception:
            conf = 1.0
    return stage["classes"][idx], conf


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
    det, typ, max_len = state["det"], state["typ"], state["max_len"]

    flags: list[Flag] = []
    for sentence in split_sentences(text):
        verdict, _ = _predict(det, sentence, max_len)
        if verdict != "fallacy":
            continue
        ftype, conf = _predict(typ, sentence, max_len)
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


def active_kinds() -> dict[str, str | None]:
    """Which kind each stage would use right now (for diagnostics)."""
    return {"detector": _stage_kind("detector"), "typer": _stage_kind("typer")}


def _main(argv=None):  # pragma: no cover - manual smoke test
    import argparse

    from .display import print_report

    p = argparse.ArgumentParser(prog="fallacy_warn.classifier", description="Local model smoke test")
    src = p.add_mutually_exclusive_group(required=True)
    src.add_argument("--text")
    src.add_argument("--file")
    args = p.parse_args(argv)
    text = args.text if args.text is not None else open(args.file, encoding="utf-8").read()
    print("active model kinds:", active_kinds())
    print_report(analyze(text))


if __name__ == "__main__":  # pragma: no cover
    _main()
