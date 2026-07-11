# Two-stage fallacy detection — model notebook

One system that uses **all** the datasets, each for the job it's labeled for:

```
        Stage 1: DETECT                  Stage 2: TYPE
text ─▶ fallacy? ─ valid ─▶ "no fallacy"
                └ fallacy ─▶ which of 13 types? ─▶ e.g. "ad hominem"
```

- **Stage 1 — Detector** (binary): `contrastive_dataset.csv` — the only set with *valid*
  (non-fallacy) negatives.
- **Stage 2 — Typer** (13 classes): LOGIC `edu_*.csv` (predefined splits), trained on `edu`
  only and tested **cross-domain** on real-world climate claims (`climate_test.csv`).

Each stage benchmarks three models — **TF-IDF+LogReg → from-scratch BiLSTM → fine-tuned
DistilBERT** — reported with **macro-F1**, plus a confusion matrix and an in-domain → OOD
generalization comparison. MAFALDA (span-level, different taxonomy) is a future benchmark.

## Data (`../data`)

| Used for | Files | text / label |
|---|---|---|
| Stage 1 detector | `contrastive_dataset.csv` | `text` / `label` (fallacy vs valid) |
| Stage 2 typer | `edu_train/dev/test.csv` | `source_article` / `updated_label` (13 types) |
| Cross-domain test | `climate_test.csv` | `source_article` / `logical_fallacies` |
| (future benchmark) | `gold_standard_dataset.jsonl` (MAFALDA) | span-level |

## Running on Google Colab (recommended)

1. Upload `fallacy_classifier.ipynb` and the `data/` folder to Google Drive.
2. Open in Colab → **Runtime → Change runtime type → T4 GPU**.
3. **Runtime → Run all.** The Environment cell mounts Drive (approve the popup) and finds the
   data automatically; the Save cell writes trained models back to Drive.

Locally instead: `pip install -r requirements.txt` then run top to bottom (set `RUN_BERT=False`
in Config to skip DistilBERT on CPU).

## What comes out

The **Assemble** cell builds `classify(text)` → `"valid — no fallacy detected"` or
`"fallacy → <type>"`. The **Save** cell persists both stages (models + label encoders +
`pipeline.json`) so you can later serve them behind the app's old interface — **zero API cost**.

> The "own-model" direction: a trained two-stage classifier benchmarked against standard
> models, replacing the LLM-API prototype.
