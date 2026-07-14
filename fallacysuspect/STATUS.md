# Fallacy Detector — Status & Handoff

Snapshot of what this app is, how it works, exactly what state it's in, and the
**one thing that still needs doing**.

---

## 1. What the app is

Paste a debate transcript → it flags **possible logical fallacies as warnings**, with
confidence scores. It is *not* a judge and never says who is right.

Flow: enter a transcript → **Evaluate** → a live progress bar scans it sentence-by-sentence
(green → yellow → red as findings accumulate) → the page **morphs seamlessly** (no reload)
into two columns: the transcript with highlighted spans on the left, and a report on the
right ("We found N possible fallacies" + avg confidence, then each finding with its quote
and a definition). Hovering a highlight links it to its finding.

## 2. How it works

**Two-stage, sentence-level pipeline** (models we trained ourselves — zero API cost):

```
sentence ─▶ Stage 1 DETECTOR ── not_fallacy ─▶ (ignored)
                    └── fallacy ─▶ Stage 2 TYPER ─▶ which of 14 types
```

Three gates suppress noise (see `config.py`):
1. `MIN_WORDS` (8) — skip procedural lines ("Thanks.", "That's my close.")
2. `detect_threshold(kind)` — detector must be confident. **Per model kind**, because
   DistilBERT's softmax is peaky (0.9+) while TF-IDF's is flat (median 0.47). One shared
   threshold silently discarded 2/3 of real fallacies on TF-IDF.
3. `TYPE_THRESHOLD` (0.50) — the typer must know *which* fallacy. Strongest signal.

Reported confidence = **P(fallacy) × P(type)**.

## 3. Layout

```
fallacy_warn/
  classifier.py     ** THE LOCAL MODEL BACKEND (primary) ** — loads models, gates, streams
  config.py         taxonomy, thresholds, DB path, model settings
  models.py         Flag / AnalysisResult dataclasses
  db.py             SQLite — every evaluation is stored
  web.py            Flask: / (UI), /api/check, /api/check/stream (SSE, powers the bar)
  templates/index.html   the entire frontend (progress bar, morph, report)
  cli.py            check / serve / history
  llm.py prompts.py detector.py verifier.py pipeline.py
                    ^ the ORIGINAL Anthropic-API backend, kept as a fallback
scripts/
  build_datasets.py   builds improved training data -> data/built/
  export_tfidf.py     trains + exports the small TF-IDF models (deployable)
  train_bert.py       fine-tunes DistilBERT   <-- NEEDS TO BE RUN (see §6)
notebooks/            Colab benchmark notebook (TF-IDF vs BiLSTM vs DistilBERT)
models/two_stage/     the trained models
data/                 datasets (git-ignored)
```

**Backend selection** (automatic, override with env vars):
- `FALLACY_BACKEND=auto|local|api` — local models if present, else the Anthropic API.
- `FALLACY_MODEL_KIND=bert|tfidf` — force a model kind.
- Models are **self-describing**: each carries its own class list + data `version`
  (`classes.json` for DistilBERT, inside the joblib for TF-IDF), so the app auto-picks
  the better-trained one and models can't fall out of sync with the taxonomy.

## 4. Data (`data/`, git-ignored)

| Source | Used for |
|---|---|
| `contrastive_dataset.csv` (Kaggle) | detector: fallacy vs valid (1406, balanced) |
| `edu_*.csv` (LOGIC / causalNLP) | typer: 13 fallacy types (1849 train) |
| `climate_test.csv` | cross-domain test set |
| `gold_standard_dataset.jsonl` (**MAFALDA**) | **real-world** sentences, incl. 601 labelled *non*-fallacious |

`scripts/build_datasets.py` merges these into `data/built/`, splitting MAFALDA **by
document** (no leakage) to create a genuine real-world held-out test set. It also adds
**slippery slope** (LOGIC lacks it entirely) → **14 classes**.

## 5. Current model state — MEASURED, not guessed

Evaluated on held-out **real-world** prose (MAFALDA test documents):

| Model | Data ver | Result |
|---|---|---|
| detector **TF-IDF** | v2 | ✅ **24% false alarms**, macro-F1 **0.75** |
| typer **TF-IDF** | v2 | ❌ macro-F1 **0.137** — scores *zero* on false causality / false dilemma. Bag-of-words cannot see argument structure. |
| detector **DistilBERT** | **v1 (stale)** | ❌ **62% false alarms** — trained without real-world negatives |
| typer **DistilBERT** | v1 | ✅ decent — transformers handle real prose |

**Active combo right now:** detector = TF-IDF, typer = DistilBERT (auto-selected; it's the
best available pairing).

**Progress on the nuclear-debate sample:** 75 flags (original, garbage) → 14 (after gates)
→ **12** (after retrained detector + splitter fix + calibrated thresholds).

**Still wrong:** it *misses the flagship false dilemma* ("Either we build firm clean
capacity, or…") — the TF-IDF detector rates that textbook case only **0.41**. No threshold
fixes a weak model. A couple of false positives remain.

## 6. ⚠️ THE ONE THING THAT STILL NEEDS DOING

**Retrain DistilBERT on the improved (v2) data — on Colab (free GPU).** This is the actual
fix: a transformer trained *with* real-world negatives should get both precision *and*
recall (catching the false dilemma while staying quiet on "Thank you both").

### → Run `notebooks/retrain_bert.ipynb` on Colab

1. Open it in Colab → **Runtime → Change runtime type → T4 GPU**
2. Upload the **`data/`** folder into the Colab session (needs `contrastive_dataset.csv`,
   `edu_train.csv`, `gold_standard_dataset.jsonl`)
3. **Runtime → Run all** (a few minutes on GPU)
4. It builds the improved datasets inline, trains **both** stages, prints honest real-world
   metrics each epoch, runs a sanity check on real debate lines, then **zips + downloads**
   the models.
5. Unzip into `fallacysuspect/models/two_stage/`, replacing the old `*_distilbert/` folders
   and `pipeline.json`.

The app **auto-detects** the new `version: 2` models and switches to DistilBERT for both
stages; the thresholds then work as designed.

> `scripts/train_bert.py` does the same thing locally on CPU, but it's a 10–20 min grind and
> background runs kept getting killed. **Use Colab.**

**After downloading, verify:**
```powershell
python -m fallacy_warn serve     # paste the nuclear debate; the false dilemma should now be caught
```

## 7. Running the app

```powershell
cd C:\Users\Absol\OneDrive\Documents\GitHub\PortFol\fallacysuspect
python -m fallacy_warn serve          # -> http://127.0.0.1:8000
```
No API key needed. First request loads the models (~9 s), then it's cached.

Other commands:
```powershell
python -m fallacy_warn check --text "..."     # CLI
python -m fallacy_warn history                # past evaluations (SQLite)
$env:FALLACY_MODEL_KIND = "tfidf"             # force the light model (what Render will use)
```

Docker is **no longer used** — PowerShell is the run path.

## 8. Deployment plan (GitHub → Render, not paying yet)

- **DistilBERT weights are 255 MB each** → over GitHub's 100 MB per-file limit, and they'd
  need ~2 GB RAM (Render free tier = 512 MB). So they're **git-ignored**.
- **TF-IDF is the deployable model**: ~0.7 MB, commits to git, runs in tens of MB of RAM.
  `.gitignore` is already set up to commit the TF-IDF joblibs + `pipeline.json` while
  ignoring `*.safetensors`, `*_distilbert/`, and `data/`.
- **Still TODO for one-click Render:** `render.yaml` + `gunicorn` + a small `wsgi.py`.
  (Not needed for local testing.)
- Note the TF-IDF *typer* is weak (§5) — a known deployment trade-off. If the deployed
  quality matters, consider hosting DistilBERT on Hugging Face Hub + a paid Render instance.

## 9. Other open items / ideas

- Regenerate the TF-IDF joblibs on your own machine before committing (`python
  scripts\export_tfidf.py`) so the pickles match your scikit-learn version.
- Typer types are sometimes wrong even when the *location* is right (e.g. "Picture the
  families…" is appeal to emotion but gets labelled faulty generalization). More real-world
  training data (MAFALDA is only 339 fallacies) is the lever.
- Possible upgrades: classify per **speaker turn** rather than per sentence (closer to the
  training distribution); GloVe embeddings for the BiLSTM in the notebook.
- The app **never** collects IP/geolocation — this was explicitly declined earlier. Keep it
  that way.
