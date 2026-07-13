"""Train and export the lightweight TF-IDF models, and report honest metrics.

Trains on the improved datasets from ``scripts/build_datasets.py`` (contrastive +
LOGIC + MAFALDA's real-world negatives) and evaluates on a **held-out set of real
MAFALDA documents** — the only honest test of "does this work on real prose?".

Writes self-describing bundles into ``models/two_stage/``:

    detector_tfidf.joblib   {pipe, classes, version}
    typer_tfidf.joblib      {pipe, classes, version}

They carry their own class lists, so they can't fall out of sync with a model
trained on a different taxonomy.

    python scripts/build_datasets.py     # first — builds data/built/
    python scripts/export_tfidf.py       # then — trains + exports
"""

from __future__ import annotations

import json
import os

import joblib
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report, confusion_matrix, f1_score
from sklearn.pipeline import Pipeline

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILT = os.path.join(HERE, "data", "built")
MDIR = os.path.join(HERE, "models", "two_stage")
DATA_VERSION = 2   # v2 = trained with MAFALDA real-world negatives


def make_pipe():
    return Pipeline([
        ("tfidf", TfidfVectorizer(ngram_range=(1, 2), min_df=2, sublinear_tf=True, stop_words="english")),
        ("clf", LogisticRegression(max_iter=2000, C=5.0, class_weight="balanced")),
    ])


def train_stage(name, train_csv, test_csv, out_name):
    tr = pd.read_csv(os.path.join(BUILT, train_csv)).dropna()
    te = pd.read_csv(os.path.join(BUILT, test_csv)).dropna()

    classes = sorted(tr["label"].unique())
    cmap = {c: i for i, c in enumerate(classes)}
    ytr = tr["label"].map(cmap)

    pipe = make_pipe()
    pipe.fit(tr["text"], ytr)

    # Evaluate only on rows whose label the model knows
    te = te[te["label"].isin(cmap)]
    yte = te["label"].map(cmap)
    pred = pipe.predict(te["text"])

    print(f"\n=== {name} — held-out REAL-WORLD test ({len(te)} sentences) ===")
    print(classification_report(yte, pred, labels=range(len(classes)),
                                target_names=classes, zero_division=0, digits=2))
    if "not_fallacy" in cmap and "fallacy" in cmap:
        cm = confusion_matrix(yte, pred, labels=[cmap["not_fallacy"], cmap["fallacy"]])
        tn, fp = cm[0]
        print(f"  false-alarm rate on clean prose: {fp / max(tn + fp, 1):.0%}  ({fp}/{tn + fp})")
    print(f"  macro-F1: {f1_score(yte, pred, average='macro'):.3f}")

    out = os.path.join(MDIR, out_name)
    joblib.dump({"pipe": pipe, "classes": classes, "version": DATA_VERSION}, out)
    print(f"  -> {out_name}  ({os.path.getsize(out) / 1e6:.2f} MB, {len(classes)} classes)")
    return classes


def main():
    os.makedirs(MDIR, exist_ok=True)
    det_classes = train_stage("DETECTOR", "detector_train.csv", "detector_test.csv", "detector_tfidf.joblib")
    typ_classes = train_stage("TYPER", "typer_train.csv", "typer_test.csv", "typer_tfidf.joblib")

    meta_path = os.path.join(MDIR, "pipeline.json")
    meta = json.load(open(meta_path)) if os.path.exists(meta_path) else {}
    meta.update({
        "detector_classes": det_classes,
        "typer_classes": typ_classes,
        "max_len": meta.get("max_len", 80),
        "data_version": DATA_VERSION,
    })
    json.dump(meta, open(meta_path, "w"), indent=2)

    import sklearn
    print(f"\ndone (scikit-learn {sklearn.__version__}) — commit the two .joblib files + pipeline.json")


if __name__ == "__main__":
    main()
