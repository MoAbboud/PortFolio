"""Build improved training sets for the two-stage model.

The original detector was trained only on the *contrastive* set, where every
example is an argument (fallacy vs valid). Real transcripts are mostly ordinary
prose — procedural lines, concessions, plain facts — which the detector had never
seen, so it flagged ~62% of clean real-world sentences as fallacies.

MAFALDA fixes that: it is real-world text annotated at sentence level, including
sentences explicitly labelled ``nothing`` (no fallacy). Those are the realistic
negatives the detector was missing.

Outputs (to ``data/built/``):

    detector_train.csv   text,label   fallacy | not_fallacy   (contrastive + MAFALDA)
    detector_test.csv    text,label   held-out MAFALDA docs — a REAL-WORLD test set
    typer_train.csv      text,label   fallacy type            (LOGIC + MAFALDA mapped)
    typer_test.csv       text,label   held-out MAFALDA docs, mapped

MAFALDA is split **by document** so no sentence from a test document leaks into
training. Run:  python scripts/build_datasets.py
"""

from __future__ import annotations

import json
import os

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(HERE, "data")
OUT = os.path.join(DATA, "built")
SEED = 42
MIN_WORDS = 5           # ignore ultra-short fragments
TEST_FRACTION = 0.2     # share of MAFALDA documents held out

# MAFALDA's 23 fine-grained types -> our taxonomy (LOGIC's 13 + slippery slope,
# which LOGIC lacks entirely despite being a staple of real debate).
MAFALDA_TO_OURS = {
    "hasty generalization": "faulty generalization",
    "appeal to ridicule": "appeal to emotion",
    "slippery slope": "slippery slope",
    "causal oversimplification": "false causality",
    "ad hominem": "ad hominem",
    "false dilemma": "false dilemma",
    "appeal to fear": "appeal to emotion",
    "appeal to nature": "fallacy of relevance",
    "false analogy": "fallacy of logic",
    "ad populum": "ad populum",
    "false causality": "false causality",
    "straw man": "fallacy of extension",
    "guilt by association": "ad hominem",
    "appeal to (false) authority": "fallacy of credibility",
    "equivocation": "equivocation",
    "circular reasoning": "circular reasoning",
    "appeal to anger": "appeal to emotion",
    "appeal to worse problems": "fallacy of relevance",
    "appeal to tradition": "fallacy of relevance",
    "fallacy of division": "fallacy of logic",
    "appeal to positive emotion": "appeal to emotion",
    "tu quoque": "ad hominem",
    "appeal to pity": "appeal to emotion",
}


def load_mafalda_docs():
    """[(sentence, [types...]) per doc] — types empty == no fallacy."""
    path = os.path.join(DATA, "gold_standard_dataset.jsonl")
    docs = []
    for line in open(path, encoding="utf-8"):
        if not line.strip():
            continue
        rec = json.loads(line)
        swl = rec["sentences_with_labels"]
        if isinstance(swl, str):
            swl = json.loads(swl)
        sents = []
        for sent, labels in swl.items():
            flat = [x for grp in labels for x in (grp if isinstance(grp, list) else [grp])]
            types = [MAFALDA_TO_OURS[t] for t in flat if t != "nothing" and t in MAFALDA_TO_OURS]
            sent = sent.strip()
            if len(sent.split()) >= MIN_WORDS:
                sents.append((sent, types))
        if sents:
            docs.append(sents)
    return docs


def main():
    os.makedirs(OUT, exist_ok=True)
    rng = np.random.RandomState(SEED)

    # ---- MAFALDA, split by document (no leakage) ----
    docs = load_mafalda_docs()
    order = rng.permutation(len(docs))
    cut = int((1 - TEST_FRACTION) * len(docs))
    train_docs = [docs[i] for i in order[:cut]]
    test_docs = [docs[i] for i in order[cut:]]
    maf_train = [s for d in train_docs for s in d]
    maf_test = [s for d in test_docs for s in d]
    print(f"MAFALDA: {len(docs)} docs -> {len(maf_train)} train / {len(maf_test)} test sentences")

    # ---- Stage 1: detector (fallacy vs not_fallacy) ----
    con = pd.read_csv(os.path.join(DATA, "contrastive_dataset.csv"))
    det_rows = [
        (str(t).strip(), "fallacy" if l == "fallacy" else "not_fallacy")
        for t, l in zip(con["text"], con["label"])
    ]
    det_rows += [(s, "fallacy" if types else "not_fallacy") for s, types in maf_train]
    det_train = pd.DataFrame(det_rows, columns=["text", "label"]).drop_duplicates()
    det_test = pd.DataFrame(
        [(s, "fallacy" if types else "not_fallacy") for s, types in maf_test],
        columns=["text", "label"],
    )

    # ---- Stage 2: typer (which fallacy) ----
    edu = pd.read_csv(os.path.join(DATA, "edu_train.csv"))[["source_article", "updated_label"]]
    edu.columns = ["text", "label"]
    typ_rows = [(str(t).strip(), str(l).strip()) for t, l in zip(edu["text"], edu["label"])]
    typ_rows += [(s, types[0]) for s, types in maf_train if types]     # real-world fallacies
    typ_train = pd.DataFrame(typ_rows, columns=["text", "label"]).drop_duplicates()
    typ_test = pd.DataFrame(
        [(s, types[0]) for s, types in maf_test if types], columns=["text", "label"]
    )

    for name, df in [
        ("detector_train.csv", det_train), ("detector_test.csv", det_test),
        ("typer_train.csv", typ_train), ("typer_test.csv", typ_test),
    ]:
        df.to_csv(os.path.join(OUT, name), index=False)
        print(f"  {name:20s} {len(df):5d} rows")

    print("\ndetector_train label mix:\n", det_train["label"].value_counts().to_string())
    print("\ntyper_train classes:", typ_train["label"].nunique())
    print(typ_train["label"].value_counts().to_string())
    print(f"\nwrote -> {OUT}")


if __name__ == "__main__":
    main()
