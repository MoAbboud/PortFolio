"""Fine-tune DistilBERT for both stages on the improved (v2) datasets.

TF-IDF is fine for the detector but hopeless at 14-way fallacy typing on real prose
(measured macro-F1 ~0.14) — bag-of-words can't see argumentative structure. That
job needs a pretrained transformer.

Trains on ``data/built/`` (contrastive + LOGIC + MAFALDA real-world negatives) and
evaluates on **held-out real MAFALDA documents**. Exports self-describing models:

    models/two_stage/detector_distilbert/{model, tokenizer, classes.json}
    models/two_stage/typer_distilbert/{model, tokenizer, classes.json}

Runs on CPU (slow but fine) or GPU if available.

    python scripts/build_datasets.py    # first
    python scripts/train_bert.py        # then
"""

from __future__ import annotations

import json
import os
import time

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from sklearn.metrics import classification_report, confusion_matrix, f1_score
from torch.utils.data import DataLoader, Dataset
from transformers import AutoModelForSequenceClassification, AutoTokenizer

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILT = os.path.join(HERE, "data", "built")
MDIR = os.path.join(HERE, "models", "two_stage")

SEED = 42
MODEL = "distilbert-base-uncased"
MAX_LEN = 96
BATCH = 16
LR = 3e-5
DATA_VERSION = 2

torch.manual_seed(SEED)
np.random.seed(SEED)
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")


class DS(Dataset):
    def __init__(self, texts, labels, tok):
        enc = tok(list(texts), truncation=True, max_length=MAX_LEN,
                  padding="max_length", return_token_type_ids=False, return_tensors="pt")
        self.ids, self.mask = enc["input_ids"], enc["attention_mask"]
        self.y = torch.tensor(list(labels), dtype=torch.long)

    def __len__(self):
        return len(self.y)

    def __getitem__(self, i):
        return {"input_ids": self.ids[i], "attention_mask": self.mask[i], "labels": self.y[i]}


def train_stage(name, train_csv, test_csv, out_dir, epochs):
    tr = pd.read_csv(os.path.join(BUILT, train_csv)).dropna()
    te = pd.read_csv(os.path.join(BUILT, test_csv)).dropna()
    classes = sorted(tr["label"].unique())
    cmap = {c: i for i, c in enumerate(classes)}
    te = te[te["label"].isin(cmap)]

    tok = AutoTokenizer.from_pretrained(MODEL)
    model = AutoModelForSequenceClassification.from_pretrained(
        MODEL, num_labels=len(classes)).to(DEVICE)

    train_loader = DataLoader(DS(tr["text"], tr["label"].map(cmap), tok), batch_size=BATCH, shuffle=True)
    test_loader = DataLoader(DS(te["text"], te["label"].map(cmap), tok), batch_size=BATCH)

    # class weights counter the imbalance (e.g. slippery slope has few examples)
    counts = tr["label"].map(cmap).value_counts().sort_index()
    w = torch.tensor([len(tr) / (len(classes) * counts.get(i, 1)) for i in range(len(classes))],
                     dtype=torch.float).to(DEVICE)
    crit = nn.CrossEntropyLoss(weight=w)
    opt = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=0.01)

    print(f"\n=== {name}: {len(tr)} train / {len(te)} real-world test | {len(classes)} classes | {DEVICE} ===",
          flush=True)
    for ep in range(1, epochs + 1):
        model.train()
        t0 = time.time()
        for step, b in enumerate(train_loader, 1):
            b = {k: v.to(DEVICE) for k, v in b.items()}
            loss = crit(model(input_ids=b["input_ids"], attention_mask=b["attention_mask"]).logits,
                        b["labels"])
            opt.zero_grad(); loss.backward(); opt.step()
            if step % 40 == 0:
                print(f"  ep{ep} step {step}/{len(train_loader)} loss={loss.item():.3f}", flush=True)
        # eval on real-world held-out
        model.eval(); preds, gold = [], []
        with torch.no_grad():
            for b in test_loader:
                b = {k: v.to(DEVICE) for k, v in b.items()}
                preds += model(input_ids=b["input_ids"], attention_mask=b["attention_mask"]).logits.argmax(1).cpu().tolist()
                gold += b["labels"].cpu().tolist()
        f1 = f1_score(gold, preds, average="macro", zero_division=0)
        print(f"  epoch {ep}: real-world macro-F1 = {f1:.3f}  ({time.time()-t0:.0f}s)", flush=True)

    print(classification_report(gold, preds, labels=range(len(classes)),
                                target_names=classes, zero_division=0, digits=2), flush=True)
    if "not_fallacy" in cmap:
        cm = confusion_matrix(gold, preds, labels=[cmap["not_fallacy"], cmap["fallacy"]])
        tn, fp = cm[0]
        print(f"  false-alarm rate on clean prose: {fp/max(tn+fp,1):.0%} ({fp}/{tn+fp})", flush=True)

    out = os.path.join(MDIR, out_dir)
    os.makedirs(out, exist_ok=True)
    model.save_pretrained(out)
    tok.save_pretrained(out)
    json.dump({"classes": classes, "version": DATA_VERSION},
              open(os.path.join(out, "classes.json"), "w"), indent=2)
    print(f"  -> saved {out_dir} (v{DATA_VERSION})", flush=True)
    return classes


def main():
    det = train_stage("DETECTOR", "detector_train.csv", "detector_test.csv", "detector_distilbert", epochs=3)
    typ = train_stage("TYPER", "typer_train.csv", "typer_test.csv", "typer_distilbert", epochs=4)

    p = os.path.join(MDIR, "pipeline.json")
    meta = json.load(open(p)) if os.path.exists(p) else {}
    meta.update({"detector_classes": det, "typer_classes": typ,
                 "max_len": MAX_LEN, "data_version": DATA_VERSION})
    json.dump(meta, open(p, "w"), indent=2)
    print("\nDONE — DistilBERT retrained on v2 data.", flush=True)


if __name__ == "__main__":
    main()
