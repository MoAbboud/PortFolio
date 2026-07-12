"""Train and export the lightweight TF-IDF models for deployment.

Reads the datasets from ``data/`` and writes two small joblib pipelines into
``models/two_stage/``:

    detector_tfidf.joblib   fallacy vs valid   (contrastive_dataset.csv)
    typer_tfidf.joblib      13 fallacy types   (edu_train.csv)

These are a few hundred KB, commit cleanly to git, and run with no torch — the
version the app serves on Render's free tier. Labels are encoded in the exact
order stored in ``models/two_stage/pipeline.json`` so predictions map correctly.

Run this on the machine whose scikit-learn version you'll deploy with, so the
committed pickles load without a version-mismatch warning:

    python scripts/export_tfidf.py
"""

from __future__ import annotations

import json
import os

import joblib
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(HERE, "data")
MDIR = os.path.join(HERE, "models", "two_stage")


def load(name, text_col, label_col):
    df = pd.read_csv(os.path.join(DATA, name))[[text_col, label_col]].copy()
    df.columns = ["text", "label"]
    df["text"] = df["text"].astype(str).str.strip()
    df["label"] = df["label"].astype(str).str.strip()
    return df[df["text"].str.len() > 0].dropna().reset_index(drop=True)


def make_pipe():
    return Pipeline([
        ("tfidf", TfidfVectorizer(ngram_range=(1, 2), min_df=2, sublinear_tf=True, stop_words="english")),
        ("clf", LogisticRegression(max_iter=2000, C=5.0, class_weight="balanced")),
    ])


def export(df, class_map, out_name):
    df = df.copy()
    df["y"] = df["label"].map(class_map)
    df = df.dropna(subset=["y"])
    df["y"] = df["y"].astype(int)
    pipe = make_pipe()
    pipe.fit(df["text"], df["y"])
    out = os.path.join(MDIR, out_name)
    joblib.dump(pipe, out)
    print(f"  wrote {out_name:24s} ({os.path.getsize(out) / 1e6:.2f} MB, {len(df)} rows)")


def main():
    meta = json.load(open(os.path.join(MDIR, "pipeline.json")))
    det_map = {c: i for i, c in enumerate(meta["detector_classes"])}
    typ_map = {c: i for i, c in enumerate(meta["typer_classes"])}

    print("Exporting TF-IDF models to", MDIR)
    export(load("contrastive_dataset.csv", "text", "label"), det_map, "detector_tfidf.joblib")
    export(load("edu_train.csv", "source_article", "updated_label"), typ_map, "typer_tfidf.joblib")
    import sklearn
    print("done (scikit-learn", sklearn.__version__ + ") — commit the two .joblib files.")


if __name__ == "__main__":
    main()
